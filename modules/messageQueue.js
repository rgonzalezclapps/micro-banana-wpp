/**
 * modules/messageQueue.js
 * 
 * Description: Message queue system with separated Message collection support
 * 
 * Role in the system: Async message processing with audio transcription and AI integration
 * 
 * Node.js Context: Module - Message queuing and batch processing
 * 
 * Dependencies:
 * - models/Conversation.js (conversation metadata)
 * - models/Message.js (separated message storage)
 * - models/Agent.js (MongoDB agent queries)
 * - modules/openaiIntegration.js (AI processing)
 * - services/* (message delivery services)
 * 
 * Dependants:
 * - routes/webhookRoutes.js (message queueing)
 * - modules/messageProcessor.js (message creation)
 */

const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Agent = require('../models/Agent');
const AIRequest = require('../models/AIRequest'); // ⭐ NEW: AI request tracking
const openAIIntegration = require('./openaiIntegration');
const audioTranscriber = require('./audioTranscriber');
const { chunkMessage } = require('../utils/messageUtils');
const moment = require('moment-timezone');
const { sendUltraMsg, sendUltraMsgSmart, sendUltraMsgVideo } = require('../services/ultramsgService');
const sequentialMessageService = require('../services/sequentialMessageService');
const { sendWhatsAppBusinessMessage } = require('../services/whatsappBusinessService');
const { transcribeAudioWithTimeout } = require('./audioTranscriber');
const { redisClient } = require('../database');
const { saveWithRetry } = require('../utils/dbUtils');
const { getAudioUrl } = require('../services/whatsappFactoryMediaService');
const { createTracker } = require('../utils/performanceTracker'); // ⭐ NEW: Performance tracking
const { cacheMessage } = require('../utils/redisConversationCache'); // ⭐ NEW: Redis message cache

class MessageQueue {
  constructor() {
    this.queues = new Map();
    this.queueTimers = new Map();              // DEPRECATED - will be replaced by accumulationTimers
    this.activeRuns = new Map();
    this.queueInterval = process.env.QUEUE_INTERVAL_MS ? parseInt(process.env.QUEUE_INTERVAL_MS) : 2000;
    this.maxQueueWaitTime = 30000; // 30 seconds
    this.processAudioMessage = false;
    this.retryInterval = 1000; // 1 second
    
    // Media completion tracking to prevent race conditions
    this.pendingMedia = new Map(); // conversationId -> Set of pending media requestIds
    this.mediaCompletionTimers = new Map(); // conversationId -> cleanup timer
    this.mediaTimeout = 15000; // 15 seconds timeout for media operations
    
    // ========================================================================
    // ⭐ NEW: Performance Optimization & Abort System
    // ========================================================================
    
    // Processing context tracking (for abort capability)
    this.processing = new Map(); // conversationId -> ProcessingContext
    
    // Smart accumulation timers (replaces queueTimers with intelligent logic)
    this.accumulationTimers = new Map(); // conversationId -> setTimeout reference
    this.ACCUMULATION_WINDOW = 300; // 300ms pure accumulation window
    
    // Performance trackers (high-precision timing)
    this.performanceTrackers = new Map(); // conversationId -> PerformanceTracker
    
    // ========================================================================
    // ⭐ NEW: Placeholder System for Async Operations (Audio/Image)
    // ========================================================================
    // Tracks messages that need async processing (transcription, blob download)
    // Queue processing waits until all placeholders are complete
    
    this.placeholders = new Map(); // conversationId -> Map<messageId, PlaceholderInfo>
    
    /*
    PlaceholderInfo = {
      type: 'audio' | 'image',
      messageId: string,
      startTime: Date,
      status: 'processing' | 'complete' | 'failed',
      originalTimestamp: Date  // For chronological ordering
    }
    */
    
    console.log(`🕐 MessageQueue initialized with smart accumulation: ${this.ACCUMULATION_WINDOW}ms window`);
  }

  async addMessage(conversation, messageData, agent = null) {
    const conversationId = conversation._id.toString();
    
    // ====================================================================
    // ⭐ INITIALIZE PERFORMANCE TRACKER
    // ====================================================================
    if (!this.performanceTrackers.has(conversationId)) {
      const tracker = createTracker(conversationId);
      this.performanceTrackers.set(conversationId, tracker);
      tracker.checkpoint('queue_start', { messageId: messageData.msg_foreign_id });
    }
    
    const perf = this.performanceTrackers.get(conversationId);
    
    perf.log('message_received', `[TRACE - addMessage] Received messageData`, {
      messageId: messageData.msg_foreign_id,
      hasFileStorage: !!messageData.fileStorage,
      fileStorageStatus: messageData.fileStorage?.status,
      fileId: messageData.fileStorage?.fileId
    });

    if (!this.queues.has(conversationId)) {
      this.queues.set(conversationId, []);
      console.log(`${perf.prefix()} Queue created for conversation: ${conversationId}`);
    }

    const queue = this.queues.get(conversationId);

    // Add message to queue
    queue.push(messageData);

    // Show media tracking status
    const pendingMediaCount = this.pendingMedia.get(conversationId)?.size || 0;
    perf.log('message_queued', `📦 Message added to queue`, {
      queueLength: queue.length,
      messageType: messageData.ultraMsgData.type,
      hasFileStorage: messageData.fileStorage?.status !== 'not_applicable',
      fileStorageStatus: messageData.fileStorage?.status,
      pendingMediaOperations: pendingMediaCount
    });

    // ====================================================================
    // ⭐ DETECT ASYNC OPERATIONS: Audio or Image (BEFORE smart decision)
    // ====================================================================
    const messageType = messageData.ultraMsgData.type;
    const isAudio = (messageType === 'ptt' || messageType === 'audio');
    const isImage = (messageType === 'image');
    
    if (isAudio) {
      // ================================================================
      // ⭐ AUDIO: Register placeholder FIRST, then handle async
      // ================================================================
      perf.log('audio_detected', `🎵 Audio message detected - registering placeholder`);
      this.processAudioMessage = true;
      
      // ⭐ CRITICAL: Use MongoDB _id (passed from webhookRoutes after save)
      if (!messageData._id) {
        console.error(`❌ messageData._id is missing - placeholder system will not work correctly`);
        console.error(`messageData:`, { msg_foreign_id: messageData.msg_foreign_id, hasFileStorage: !!messageData.fileStorage });
      }
      
      const audioMessageId = messageData._id ? messageData._id.toString() : messageData.msg_foreign_id;
      
      this.registerPlaceholder(
        conversationId,
        audioMessageId,
        'audio',
        messageData.timestamp
      );
      
      console.log(`🔑 [${conversationId}] Registered audio placeholder with ID: ${audioMessageId}`);
      
      // Start async audio handling (transcription)
      // Will call completePlaceholder when done
      setImmediate(() => this.handleAudioMessage(conversation, [...queue], agent, messageData));
      
    } else if (isImage) {
      // ================================================================
      // ⭐ IMAGE: Register placeholder FIRST, then handle async
      // ================================================================
      perf.log('image_detected', `🖼️ Image message detected - registering placeholder`);
      
      // ⭐ CRITICAL: Use MongoDB _id (passed from webhookRoutes after save)
      if (!messageData._id) {
        console.error(`❌ messageData._id is missing - placeholder system will not work correctly`);
      }
      
      const imageMessageId = messageData._id ? messageData._id.toString() : messageData.msg_foreign_id;
      
      this.registerPlaceholder(
        conversationId, 
        imageMessageId, 
        'image', 
        messageData.timestamp
      );
      
      console.log(`🔑 [${conversationId}] Registered image placeholder with ID: ${imageMessageId}`);
      
      // Start async image processing (blob + upload)
      // Will call completePlaceholder when done
      setImmediate(() => this.handleImageMessage(conversation, messageData));
      
    } else {
      // Text message - no placeholder needed
      const queueHasTranscriptionInProgress = queue.some(item => item.transcriptionInProgress === true);
      if (!queueHasTranscriptionInProgress) {
        this.processAudioMessage = false;
      }
    }

    // ====================================================================
    // ⭐ SMART DECISION TREE: Process immediately, abort, or accumulate
    // ====================================================================
    
    const isCurrentlyProcessing = this.processing.has(conversationId);
    
    if (isCurrentlyProcessing) {
      // SCENARIO A: New message during processing → ABORT IMMEDIATELY
      perf.log('abort_triggered', `🚫 New message during processing - ABORTING current request`);
      
      await this.abortCurrentProcessing(conversationId, 'new_message_arrived');
      
      // ====================================================================
      // ⭐ AFTER ABORT: Check if we should start accumulation
      // ====================================================================
      // If there are placeholders (audio/image processing), wait for them
      // Otherwise, start accumulation window
      
      if (!this.hasPendingPlaceholders(conversationId)) {
        this.startAccumulationWindow(conversationId);
      } else {
        perf.log('waiting_for_placeholders', `⏸️ Waiting for placeholders before accumulation`);
      }
      
    } else {
      // SCENARIO B: Not processing
      
      const hasAccumulationTimer = this.accumulationTimers.has(conversationId);
      const hasPendingPlaceholders = this.hasPendingPlaceholders(conversationId);
      
      if (hasPendingPlaceholders) {
        // SCENARIO B0: Placeholders active → Don't start timer yet
        perf.log('placeholder_wait', `⏸️ Placeholders active - queue will wait (count: ${this.placeholders.get(conversationId)?.size || 0})`);
        // Do nothing - completePlaceholder will trigger accumulation when ready
        
      } else if (hasAccumulationTimer) {
        // SCENARIO B1: Already accumulating → Reset timer (extend window)
        perf.log('accumulation_extended', `⏳ Extending accumulation window`);
        this.startAccumulationWindow(conversationId); // Resets timer
        
      } else {
        // SCENARIO B2: Fresh start, no placeholders
        
        if (queue.length === 1 && !isAudio && !isImage) {
          // SCENARIO B2a: FIRST message (text only) → Process IMMEDIATELY
          perf.log('immediate_processing', `⚡ FIRST message - processing IMMEDIATELY`);
          
          // Process on next tick (not blocking current execution)
          setImmediate(() => this.processQueue(conversationId));
          
        } else {
          // SCENARIO B2b: Multiple messages OR async operation → Start accumulation
          perf.log('accumulation_started', `📦 Starting accumulation window`);
          this.startAccumulationWindow(conversationId);
        }
      }
    }
  }

  /**
   * Register a pending media operation for a conversation
   */
  addPendingMedia(conversationId, mediaRequestId) {
    if (!this.pendingMedia.has(conversationId)) {
      this.pendingMedia.set(conversationId, new Set());
    }
    
    this.pendingMedia.get(conversationId).add(mediaRequestId);
    
    console.log(`📁 [${conversationId}] Registered pending media: ${mediaRequestId}`, {
      totalPending: this.pendingMedia.get(conversationId).size
    });
    
    this.setMediaCompletionTimer(conversationId);
  }

  /**
   * Mark a media operation as completed
   */
  completePendingMedia(conversationId, mediaRequestId) {
    if (!this.pendingMedia.has(conversationId)) {
      return;
    }
    
    const pendingSet = this.pendingMedia.get(conversationId);
    pendingSet.delete(mediaRequestId);
    
    console.log(`✅ [${conversationId}] Media completed: ${mediaRequestId}`, {
      remainingPending: pendingSet.size
    });
    
    if (pendingSet.size === 0) {
      console.log(`🎯 [${conversationId}] ALL media operations completed`);
      this.pendingMedia.delete(conversationId);
      this.clearMediaCompletionTimer(conversationId);
      
      // ================================================================
      // ⭐ CRITICAL: Check BOTH processing AND placeholders
      // ================================================================
      // Audio: Download completes BEFORE transcription
      // - completePendingMedia: Download done ✅
      // - BUT placeholder still active (transcription in progress)
      // - MUST NOT start accumulation until placeholder completes
      
      const isProcessing = this.processing.has(conversationId);
      const hasPendingPlaceholders = this.hasPendingPlaceholders(conversationId);
      
      if (isProcessing) {
        console.log(`⏸️ [${conversationId}] Currently processing - media completion will NOT trigger new processing`);
      } else if (hasPendingPlaceholders) {
        console.log(`⏸️ [${conversationId}] Placeholders still active (${this.placeholders.get(conversationId)?.size || 0}) - media completion will wait`);
      } else {
        console.log(`🚀 [${conversationId}] Not processing + no placeholders - starting accumulation window after media completion`);
        this.startAccumulationWindow(conversationId);
      }
    }
  }

  /**
   * Check if conversation has pending media operations
   */
  hasPendingMedia(conversationId) {
    const pendingSet = this.pendingMedia.get(conversationId);
    return pendingSet && pendingSet.size > 0;
  }

  /**
   * Set cleanup timer for media operations (timeout protection)
   */
  setMediaCompletionTimer(conversationId) {
    this.clearMediaCompletionTimer(conversationId);
    
    const timer = setTimeout(() => {
      console.log(`⚠️ [${conversationId}] Media completion timeout reached - forcing queue start`);
      this.pendingMedia.delete(conversationId);
      
      // ================================================================
      // ⭐ CRITICAL: Check BOTH processing AND placeholders
      // ================================================================
      const isProcessing = this.processing.has(conversationId);
      const hasPendingPlaceholders = this.hasPendingPlaceholders(conversationId);
      
      if (isProcessing) {
        console.log(`⏸️ [${conversationId}] Currently processing - timeout will NOT trigger new processing`);
      } else if (hasPendingPlaceholders) {
        console.log(`⏸️ [${conversationId}] Placeholders still active - timeout will wait for completion`);
      } else {
        console.log(`🚀 [${conversationId}] Not processing + no placeholders - starting accumulation after media timeout`);
        this.startAccumulationWindow(conversationId);
      }
    }, this.mediaTimeout);
    
    this.mediaCompletionTimers.set(conversationId, timer);
  }

  /**
   * Clear media completion timer
   */
  clearMediaCompletionTimer(conversationId) {
    if (this.mediaCompletionTimers.has(conversationId)) {
      clearTimeout(this.mediaCompletionTimers.get(conversationId));
      this.mediaCompletionTimers.delete(conversationId);
    }
  }

  // ========================================================================
  // ⭐ ABORT SYSTEM - Smart Cancellation
  // ========================================================================

  /**
   * Check if abort signal is set for conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<boolean>} True if should abort
   */
  async checkAbortSignal(conversationId) {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      
      const abortSignal = await redisClient.get(`abort_signal:${conversationId}`);
      return abortSignal === 'true';
    } catch (error) {
      console.error(`⚠️ Error checking abort signal:`, error.message);
      return false; // Default to not aborting if Redis fails
    }
  }

  /**
   * Set abort signal for conversation
   * @param {string} conversationId - Conversation ID
   * @param {string} reason - Reason for abort
   */
  async setAbortSignal(conversationId, reason = 'new_message_arrived') {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      
      await redisClient.setEx(`abort_signal:${conversationId}`, 60, 'true'); // 60s TTL
      console.log(`🚫 Abort signal set for ${conversationId}: ${reason}`);
    } catch (error) {
      console.error(`⚠️ Error setting abort signal:`, error.message);
    }
  }

  /**
   * Clear abort signal for conversation
   * @param {string} conversationId - Conversation ID
   */
  async clearAbortSignal(conversationId) {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      
      await redisClient.del(`abort_signal:${conversationId}`);
    } catch (error) {
      console.error(`⚠️ Error clearing abort signal:`, error.message);
    }
  }

  /**
   * Abort current processing completely (OpenAI + AI message cancellation)
   * @param {string} conversationId - Conversation ID
   * @param {string} reason - Reason for abort
   */
  async abortCurrentProcessing(conversationId, reason = 'new_message_arrived') {
    const perf = this.performanceTrackers.get(conversationId);
    const perfStart = perf ? perf.startTime : performance.now();
    
    console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🛑 Aborting processing for: ${conversationId}`);
    
    const processingContext = this.processing.get(conversationId);
    
    if (!processingContext) {
      console.warn(`⚠️ No processing context found for ${conversationId}`);
      return;
    }
    
    // ====================================================================
    // ⭐ Handle preliminary state (before OpenAI started)
    // ====================================================================
    if (processingContext.preliminary) {
      console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🔄 Aborting preliminary processing (before OpenAI)`);
      // No OpenAI to abort, just cleanup
    } else if (processingContext.abortController) {
      // Full processing - abort OpenAI request
      console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🚫 Sending abort signal to OpenAI request`);
      processingContext.abortController.abort();
      processingContext.aborted = true;
    }
    
    // 2. Set Redis abort signal (for checkpoints to detect)
    await this.setAbortSignal(conversationId, reason);
    
    // 3. Mark AIRequest as cancelled (if exists)
    if (processingContext.aiRequestId) {
      try {
        await AIRequest.findByIdAndUpdate(processingContext.aiRequestId, {
          status: 'cancelled',
          cancelReason: reason,
          cancelledAt: processingContext.stage || 'unknown',
          'timestamps.cancelled': new Date()
        });
        
        console.log(`[+${Math.round(performance.now() - perfStart)}ms] ✅ AIRequest marked as cancelled: ${processingContext.aiRequestId}`);
      } catch (error) {
        console.error(`❌ Failed to update AIRequest:`, error.message);
      }
    }
    
    // 4. Mark AI message as cancelled (if exists)
    if (processingContext.aiMessageId) {
      try {
        await Message.findByIdAndUpdate(processingContext.aiMessageId, {
          status: 'cancelled',
          cancelReason: reason
        });
        
        console.log(`[+${Math.round(performance.now() - perfStart)}ms] ✅ AI Message marked as cancelled: ${processingContext.aiMessageId}`);
      } catch (error) {
        console.error(`❌ Failed to update Message status:`, error.message);
      }
    }
    
    // ⭐ 5. Clear processing context FIRST
    this.processing.delete(conversationId);
    
    // ⭐ 6. Clear Redis activeRun lock LAST (prevents race condition)
    try {
      await redisClient.del(`activeRun:${conversationId}`);
      console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🧹 Redis lock cleared`);
    } catch (error) {
      console.error(`❌ Failed to clear Redis lock:`, error.message);
    }
    
    console.log(`[+${Math.round(performance.now() - perfStart)}ms] ✅ Abort complete`);
  }

  /**
   * Start pure accumulation window (300ms clean from NOW)
   * @param {string} conversationId - Conversation ID
   */
  startAccumulationWindow(conversationId) {
    const perf = this.performanceTrackers.get(conversationId);
    const perfStart = perf ? perf.startTime : performance.now();
    
    // ====================================================================
    // ⭐ CHECK: Don't start if there are pending placeholders
    // ====================================================================
    if (this.hasPendingPlaceholders(conversationId)) {
      console.log(`[+${Math.round(performance.now() - perfStart)}ms] ⏸️ Accumulation paused - waiting for placeholders`);
      return; // Don't start timer, wait for placeholder completion
    }
    
    // Clear existing timer
    if (this.accumulationTimers.has(conversationId)) {
      clearTimeout(this.accumulationTimers.get(conversationId));
      console.log(`[+${Math.round(performance.now() - perfStart)}ms] ⏹️ Cleared previous accumulation timer`);
    }
    
    // Create NEW timer starting NOW (pure 300ms from this moment)
    const windowStart = performance.now();
    
    const timer = setTimeout(() => {
      const windowEnd = performance.now();
      const actualWindow = windowEnd - windowStart;
      
      console.log(`[+${Math.round(performance.now() - perfStart)}ms] ⏰ Accumulation window closed (actual: ${Math.round(actualWindow)}ms)`);
      
      this.accumulationTimers.delete(conversationId);
      this.processQueue(conversationId);
    }, this.ACCUMULATION_WINDOW);
    
    this.accumulationTimers.set(conversationId, timer);
    console.log(`[+${Math.round(performance.now() - perfStart)}ms] ⏳ Accumulation window started (${this.ACCUMULATION_WINDOW}ms pure)`);
  }

  // ========================================================================
  // ⭐ PLACEHOLDER SYSTEM - For Async Operations (Audio/Image)
  // ========================================================================

  /**
   * Register a placeholder for async operation (audio transcription, image processing)
   * @param {string} conversationId - Conversation ID
   * @param {string} messageId - Message ID (MongoDB _id)
   * @param {string} type - 'audio' or 'image'
   * @param {Date} originalTimestamp - Original message timestamp for ordering
   */
  registerPlaceholder(conversationId, messageId, type, originalTimestamp) {
    if (!this.placeholders.has(conversationId)) {
      this.placeholders.set(conversationId, new Map());
    }
    
    const placeholder = {
      type: type,
      messageId: messageId,
      startTime: new Date(),
      status: 'processing',
      originalTimestamp: originalTimestamp
    };
    
    this.placeholders.get(conversationId).set(messageId, placeholder);
    
    console.log(`🔄 [${conversationId}] Placeholder registered: ${type} for message ${messageId}`, {
      totalPlaceholders: this.placeholders.get(conversationId).size
    });
  }

  /**
   * Complete a placeholder (async operation finished)
   * @param {string} conversationId - Conversation ID
   * @param {string} messageId - Message MongoDB _id (as string)
   */
  completePlaceholder(conversationId, messageId) {
    if (!this.placeholders.has(conversationId)) {
      console.warn(`⚠️ [${conversationId}] No placeholders found for conversation (none registered)`);
      return;
    }
    
    const placeholderMap = this.placeholders.get(conversationId);
    
    console.log(`🔍 [${conversationId}] Looking for placeholder ${messageId} in map with keys:`, Array.from(placeholderMap.keys()));
    
    const placeholder = placeholderMap.get(messageId);
    
    if (!placeholder) {
      console.warn(`⚠️ [${conversationId}] Placeholder not found for message: ${messageId}`);
      console.warn(`Available placeholders:`, Array.from(placeholderMap.keys()));
      return;
    }
    
    placeholderMap.delete(messageId);
    
    const duration = Date.now() - placeholder.startTime;
    console.log(`✅ [${conversationId}] Placeholder complete: ${placeholder.type} (${duration}ms)`, {
      remainingPlaceholders: placeholderMap.size
    });
    
    // ====================================================================
    // ⭐ If all placeholders complete, trigger accumulation window
    // ====================================================================
    if (placeholderMap.size === 0) {
      console.log(`🎯 [${conversationId}] ALL placeholders complete`);
      this.placeholders.delete(conversationId); // Cleanup
      
      // ================================================================
      // ⭐ CRITICAL FIX: Only start accumulation if NOT currently processing
      // ================================================================
      // If conversation is currently processing, DON'T trigger accumulation
      // This prevents aborting an already-running request
      
      const isProcessing = this.processing.has(conversationId);
      
      if (isProcessing) {
        console.log(`⏸️ [${conversationId}] Currently processing - placeholder completion will NOT trigger new processing`);
        // Do nothing - let current processing finish
      } else {
        console.log(`🚀 [${conversationId}] Not processing - starting accumulation window`);
        this.startAccumulationWindow(conversationId);
      }
    }
  }

  /**
   * Check if conversation has pending placeholders
   * @param {string} conversationId - Conversation ID
   * @returns {boolean} True if pending placeholders exist
   */
  hasPendingPlaceholders(conversationId) {
    const placeholderMap = this.placeholders.get(conversationId);
    return placeholderMap && placeholderMap.size > 0;
  }

  /**
   * Expose isProcessing for external checks (webhookRoutes)
   * @param {string} conversationId - Conversation ID
   * @returns {boolean} True if currently processing
   */
  isProcessing(conversationId) {
    return this.processing.has(conversationId);
  }

  async handleAudioMessage(conversation, queue, agent = null, messageData = null) {
    const conversationId = conversation._id.toString();
    
    // Find the most recent audio message from the Message collection
    const latestMessage = await Message.findOne({
      conversationId: conversation._id,
      msg_foreign_id: messageData.msg_foreign_id
    });

    if (!latestMessage) {
      console.error('❌ Audio message not found in Message collection');
      // Complete placeholder to prevent blocking
      const audioMessageId = messageData._id || messageData.msg_foreign_id;
      this.completePlaceholder(conversationId, audioMessageId);
      return;
    }

    console.log(`🎵 [${conversationId}] Starting audio transcription for message: ${latestMessage._id}`);

    // Update transcription status to processing
    latestMessage.audioTranscription = {
      status: 'processing',
      status_reason: 'handleAudioMessage received a new audio message. Processing started.',
      text: []
    };
    await latestMessage.save();

    // Find placeholder in queue
    const placeholderIndex = queue.findIndex(msg => 
      msg.msg_foreign_id === messageData.msg_foreign_id
    );
    
    const placeholder = placeholderIndex !== -1 ? queue[placeholderIndex] : messageData;
    placeholder.transcriptionInProgress = true;
    
    // Send immediate message to user when audio transcription begins
    try {
      const audioMessages = [
        "Estoy escuchando tu audio 🎧",
        "Recibido. Escuchando y te contesto 🔊",
        "Tu audio se escucha claro, procesando 📱",
        "Dale, escuchando tu mensaje 🎤",
        "Recibido tu audio, ya lo proceso 🎵",
        "Estoy procesando tu mensaje de voz 👂",
        "Tu audio llegó perfecto, escuchando ⚡",
        "Recibido y escuchando tu mensaje 🔄",
        "Estoy escuchando tu audio 🎯",
        "Procesando tu mensaje de voz 🎶",
        "Escuchando lo que me dijiste 🎧",
        "Procesando tu audio 📻",
        "Estoy escuchando tu mensaje 👂",
        "Recibido, estoy escuchando 🎵",
        "Escuchando tu audio 🔊",
        "Escuchando tu mensaje completo 🎤",
        "Estoy procesando lo que me contaste 💫",
        "Escuchando tu audio 🎨",
        "Recibido y procesando tu voz 🌟",
        "Estoy escuchando cada palabra 🎪"
      ];
      
      const randomMessage = audioMessages[Math.floor(Math.random() * audioMessages.length)];
      
      console.log(`📤 Sending immediate audio processing message: "${randomMessage}"`);
      
      const phoneNumber = conversation.phoneNumber || placeholder.ultraMsgData?.from || placeholder.from;
      
      if (!phoneNumber) {
        throw new Error('Phone number not available for audio notification');
      }
      
      // Get agent for sending message
      if (agent) {
        await sendUltraMsg(agent, phoneNumber, randomMessage);
      } else {
        const conversationAgent = await Agent.findById(conversation.agentId);
        if (conversationAgent) {
          await sendUltraMsg(conversationAgent, phoneNumber, randomMessage);
        }
      }
      
      console.log(`✅ Audio processing notification sent to user: ${phoneNumber}`);
      
    } catch (messageError) {
      console.error(`⚠️ Failed to send audio processing notification (non-blocking):`, {
        error: messageError.message,
        conversationId: conversation._id.toString(),
        phoneNumber: conversation.phoneNumber
      });
    }
    
    // Update the placeholder in the queue
    if (placeholderIndex !== -1) {
      queue[placeholderIndex] = placeholder;
    } else {
      console.warn('Message not found in queue. Adding placeholder.');
      queue.push(placeholder);
    }

    // Perform audio transcription
    try {
      const isWhatsAppFactory = placeholder.provider === 'whatsapp-factory' || 
                              placeholder.whatsappFactorySource === true ||
                              (placeholder.ultraMsgData.media && placeholder.ultraMsgData.media.needsDownload);
      
      let transcription;
      
      if (isWhatsAppFactory && agent && placeholder.ultraMsgData.media && placeholder.ultraMsgData.media.id) {
        console.log('Processing WhatsApp Factory audio with special handling');
        
        let audioUrl = placeholder.ultraMsgData.media.url;
        
        if ((!audioUrl || audioUrl === 'null') && placeholder.ultraMsgData.media.needsDownload) {
          console.log('WhatsApp Factory audio needs download, getting URL from service...');
          
          try {
            const phoneNumberId = agent.instanceId;
            
            audioUrl = await getAudioUrl(
              placeholder.ultraMsgData.id,
              phoneNumberId,
              agent._id.toString()
            );
            
            console.log('✅ WhatsApp Factory audio URL obtained:', audioUrl ? 'Success' : 'Failed');
          } catch (urlError) {
            console.error('Error getting WhatsApp Factory audio URL:', urlError);
            throw new Error(`Failed to get WhatsApp Factory audio URL: ${urlError.message}`);
          }
        }
        
        const messageDataForTranscription = {
          ...placeholder,
          media: audioUrl || placeholder.ultraMsgData.media
        };
        
        transcription = await transcribeAudioWithTimeout(
          messageDataForTranscription,
          agent,
          placeholder.ultraMsgData.media,
          placeholder.ultraMsgData.id
        );
      } else {
        transcription = await transcribeAudioWithTimeout(
          placeholder,
          null,
          null,
          placeholder.ultraMsgData.id
        );
      }

      // Update message in Message collection with transcription result
      if (transcription && transcription.status === 'completed') {
        latestMessage.audioTranscription = {
          status: 'completed',
          status_reason: 'Transcription Complete',
          text: [{ order: 0, content: transcription.text || "" }]
        };
        placeholder.audioTranscription = latestMessage.audioTranscription;
      } else {
        latestMessage.audioTranscription = {
          status: 'failed',
          status_reason: 'Transcription came null',
          text: [{ order: 0, content: "[Error: El audio no pudo ser procesado. Hazle saber al usuario, sin interrumpir la conversación, que no pudiste escuchar su audio ya que el equipo se encuentra aplicando mejoras en tu capacidad de escuchar. Dile que vuelva a intentarlo en un momento, o que te lo escriba si vuelve a fallar por favor, y le pides disculpas por el imprevisto. Contesta el resto de los mensajes normalmente.]" }]
        };
        placeholder.audioTranscription = latestMessage.audioTranscription;
      }
    } catch (error) {
      console.error('Error handling audio message:', error);
      latestMessage.audioTranscription = {
        status: 'failed',
        text: [{ order: 0, content: "[Error: El audio no pudo ser procesado. Hazle saber al usuario, sin interrumpir la conversación, que no pudiste escuchar su audio ya que el equipo se encuentra aplicando mejoras en tu capacidad de escuchar. Dile que vuelva a intentarlo en un momento, o que te lo escriba si vuelve a fallar por favor, y le pides disculpas por el imprevisto. Contesta el resto de los mensajes normalmente.]" }],
        status_reason: "Error: Audio transcription failed. " + error.message  
      };
      placeholder.audioTranscription = latestMessage.audioTranscription;
    } finally {
      delete placeholder.transcriptionInProgress;
    }

    // Save updated message to Message collection
    try {
      await latestMessage.save();
      console.log(`✅ Audio transcription saved to Message collection: ${latestMessage._id}`);
    } catch (error) {
      console.error('❌ Error saving audio transcription:', error);
      // Continue - we'll complete placeholder anyway
    }

    // ====================================================================
    // ⭐ UPDATE REDIS CACHE with transcription (critical for correctness)
    // ====================================================================
    cacheMessage(conversationId, latestMessage).catch(err => {
      console.warn(`⚠️ Failed to update Redis cache with transcription (non-blocking):`, err.message);
    });
    console.log(`♻️ [${conversationId}] Redis cache updated with audio transcription`);

    // Update the message in the queue
    const conversationQueue = this.queues.get(conversationId);
    if (conversationQueue && placeholderIndex !== -1) {
      conversationQueue[placeholderIndex] = placeholder;
    }

    const otherActiveTranscriptions = queue.some(item => item.transcriptionInProgress === true);

    if (!otherActiveTranscriptions) {
      this.processAudioMessage = false;
    }

    // ====================================================================
    // ⭐ COMPLETE PLACEHOLDER - Triggers accumulation if all done
    // ====================================================================
    const messageIdForPlaceholder = latestMessage._id.toString();
    console.log(`🔑 [${conversationId}] Completing placeholder for audio message ID: ${messageIdForPlaceholder}`);
    
    this.completePlaceholder(conversationId, messageIdForPlaceholder);

    console.log('✅ Audio message handling completed');
  }

  /**
   * Handle image message (blob processing + upload)
   * @param {Object} conversation - Conversation document
   * @param {Object} messageData - Message data
   */
  async handleImageMessage(conversation, messageData) {
    const conversationId = conversation._id.toString();
    
    try {
      console.log(`🖼️ [${conversationId}] Starting image message handling`);
      
      // Find message in MongoDB
      const imageMessage = await Message.findOne({
        conversationId: conversation._id,
        msg_foreign_id: messageData.msg_foreign_id
      });
      
      if (!imageMessage) {
        console.error(`❌ Image message not found: ${messageData.msg_foreign_id}`);
        this.completePlaceholder(conversationId, messageData.msg_foreign_id);
      return;
    }
    
      // ================================================================
      // ⭐ BLOB PROCESSING (if needed)
      // ================================================================
      // Note: If image already has blob cached, skip
      // If not, download and cache (will be done in buildMessages later)
      
      console.log(`✅ [${conversationId}] Image message ready`, {
        fileId: imageMessage.fileStorage?.fileId,
        hasCachedBlob: !!imageMessage.fileStorage?.base64Cache?.data
      });
      
      // ================================================================
      // ⭐ COMPLETE PLACEHOLDER - Image is ready
      // ================================================================
      this.completePlaceholder(conversationId, imageMessage._id.toString());
      
    } catch (error) {
      console.error(`❌ Error handling image message:`, error);
      // Complete placeholder anyway to prevent blocking
      this.completePlaceholder(conversationId, messageData.msg_foreign_id);
    }
  }

  /**
   * DEPRECATED - Use completePlaceholder instead
   * Old queue timer system - being phased out
   * Kept for backward compatibility with media operations
   */
  resetQueueTimer(conversationId) {
    console.warn(`⚠️ DEPRECATED: resetQueueTimer called for ${conversationId} - use completePlaceholder instead`);
    
    // For backward compatibility during transition, start accumulation window
    this.startAccumulationWindow(conversationId);
  }

  async processQueue(conversationId) {
    if (await this.shouldProcessQueue(conversationId)) {
      await this.executeQueueProcessing(conversationId);
    } else {
      this.scheduleRetry(conversationId);
    }
  }

  async shouldProcessQueue(conversationId) {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    const isActiveRun = await redisClient.get(`activeRun:${conversationId}`);
    const activeTimer = this.queueTimers.get(conversationId);
    
    let isTimerActive = false;
    if (activeTimer) {
      isTimerActive = !this.isTimerExpired(activeTimer);
    }

    return !isActiveRun && !this.processAudioMessage && !isTimerActive;
  }

  isTimerExpired(timer) {
    const now = Date.now();
    const expirationTime = timer._idleStart + timer._idleTimeout;
    const isExpired = now >= expirationTime;
    return isExpired;
  }

  async executeQueueProcessing(conversationId) {
    // ====================================================================
    // ⭐ PERFORMANCE TRACKING START (outside try block for scope)
    // ====================================================================
    let perf = this.performanceTrackers.get(conversationId);
    if (!perf) {
      perf = createTracker(conversationId);
      this.performanceTrackers.set(conversationId, perf);
    }
    
    perf.checkpoint('processing_start', { timestamp: new Date() });
    
    try {
      // ================================================================
      // ⭐ ABORT CHECKPOINT 1: Before any expensive operations
      // ================================================================
      if (await this.checkAbortSignal(conversationId)) {
        perf.log('abort_before_processing', `🚫 Abort signal detected - exiting early`);
        return;
      }
      
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      const isSet = await redisClient.set(`activeRun:${conversationId}`, 'true', { NX: true, EX: 300 });
      
      if (!isSet) {
        perf.log('processing_locked', `Active run already in progress for conversation`);
        return;
      }

      // ====================================================================
      // ⭐ ATOMIC: Set processing state IMMEDIATELY after Redis lock
      // ====================================================================
      // Prevents race condition where webhook arrives during setup phase
      // Will be updated with full context later (line ~1089)
      this.processing.set(conversationId, { 
        preliminary: true,
        startTime: performance.now(),
        stage: 'initializing'
      });

      const queue = this.queues.get(conversationId) || [];
      if (queue.length === 0) {
        perf.log('queue_empty', `Queue is empty for conversation`);
        
        // Clean up preliminary processing state
        this.processing.delete(conversationId);
        await redisClient.del(`activeRun:${conversationId}`);
        return;
      }

      // Clear the queue and timers immediately after starting processing
      const processedQueue = [...queue];
      
      // ====================================================================
      // ⭐ CRITICAL: Sort by ORIGINAL timestamp for chronological order
      // ====================================================================
      // This ensures messages maintain their original order even if they
      // arrive at different times due to async operations (audio transcription, etc.)
      
      processedQueue.sort((a, b) => {
        // Use originalTimestamp if available (for placeholder-tracked messages)
        // Otherwise use regular timestamp
        const timestampA = a.originalTimestamp || a.timestamp;
        const timestampB = b.originalTimestamp || b.timestamp;
        return new Date(timestampA) - new Date(timestampB);
      });
      
      this.queues.delete(conversationId);
      this.queueTimers.delete(conversationId); // Legacy
      this.accumulationTimers.delete(conversationId); // New
      
      perf.log('queue_cleared', `Queue and timers cleared (chronologically ordered)`, { 
        messageCount: processedQueue.length 
      });

      let conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        console.error(`Conversation not found: ${conversationId}`);
        
        // Clean up preliminary processing state
        this.processing.delete(conversationId);
        await redisClient.del(`activeRun:${conversationId}`);
        return;
      }

      // Check for recent agent messages (interrupt logic)
      const shouldSkipAI = await this.checkAgentMessageInterrupt(conversationId);
      if (shouldSkipAI) {
        console.log('🚫 AI processing skipped: Recent agent message detected (within 10 minutes)');
        
        // ⭐ Delete processing state FIRST, lock LAST
        this.processing.delete(conversationId);
        await this.clearAbortSignal(conversationId);
        
        // Delete lock LAST
        await redisClient.del(`activeRun:${conversationId}`);
        return;
      }

      // Get agent from MongoDB
      let agent;
      try {
        agent = await Agent.findById(conversation.agentId);
      } catch (dbError) {
        console.error(`❌ [${conversationId}] Error finding agent:`, dbError.message);
        
        // Clean up preliminary processing state
        this.processing.delete(conversationId);
        await redisClient.del(`activeRun:${conversationId}`);
        throw dbError;
      }

      if (!agent) {
        console.error(`Agent not found for conversation: ${conversationId}`);
        
        // Clean up preliminary processing state
        this.processing.delete(conversationId);
        await redisClient.del(`activeRun:${conversationId}`);
        return;
      }

      perf.log('agent_found', `✅ Agent found: ${agent.name}`, { agentId: agent._id.toString() });

      // ====================================================================
      // ⭐ CREATE AI REQUEST TRACKING DOCUMENT
      // ====================================================================
      
      const userMessageIds = processedQueue.map(msg => msg._id).filter(id => id);
      
      const aiRequest = new AIRequest({
        conversationId: conversation._id,
        agentId: agent._id,
        userMessageIds: userMessageIds,
        model: agent.modelConfig?.model || 'unknown',
        streaming: agent.modelConfig?.streaming || false,
        maxCompletionTokens: agent.modelConfig?.maxCompletionTokens,
        temperature: agent.modelConfig?.temperature,
        messageCount: processedQueue.length,
        status: 'queued',
        timestamps: {
          queueStart: perf.checkpoints.find(c => c.name === 'queue_start')?.timestamp 
                      ? new Date(Date.now() - (performance.now() - perf.checkpoints.find(c => c.name === 'queue_start').timestamp)) 
                      : new Date(),
          processingStart: new Date()
        }
      });
      
      await aiRequest.save();
      
      perf.log('ai_request_created', `📊 AIRequest created`, { 
        aiRequestId: aiRequest._id.toString(),
        messageCount: processedQueue.length 
      });
      
      // ====================================================================
      // ⭐ CREATE ABORT CONTROLLER & PROCESSING CONTEXT
      // ====================================================================
      
      const abortController = new AbortController();
      
      // ====================================================================
      // ⭐ UPDATE preliminary processing state with full context
      // ====================================================================
      // Preliminary state was set immediately after Redis lock (line ~980)
      // Now update with complete context including AbortController
      
      const processingContext = {
        abortController: abortController,
        aiRequestId: aiRequest._id,
        userMessageIds: userMessageIds,
        startTime: performance.now(),
        stage: 'preparing',
        aborted: false,
        aiMessageId: null,
        preliminary: false  // Mark as fully initialized
      };
      
      this.processing.set(conversationId, processingContext);
      
      perf.log('processing_context_created', `🎯 Processing context initialized with AbortController`);
      
      // Clear any previous abort signals
      await this.clearAbortSignal(conversationId);

      // Prepare messages for OpenAI
      const openAiMessages = processedQueue.map(msg => {
        let audioTranscription = "";
        if ((msg.ultraMsgData.type === 'ptt' || msg.ultraMsgData.type === 'audio') && msg.audioTranscription) {
          if (typeof msg.audioTranscription.text === 'string') {
            audioTranscription = msg.audioTranscription.text;
          } else if (Array.isArray(msg.audioTranscription.text)) {
            audioTranscription = msg.audioTranscription.text.map(chunk => chunk.content).join('');
          } else if (msg.audioTranscription.text && msg.audioTranscription.text.content) {
            audioTranscription = msg.audioTranscription.text.content;
          }
        }

        console.log('🔍 DIAGNOSTIC - Message processing for OpenAI:', {
          messageId: msg.ultraMsgData.id,
          hasFileStorage: !!msg.fileStorage,
          fileStorageStatus: msg.fileStorage?.status || 'none',
          fileStorageFileId: msg.fileStorage?.fileId || 'none',
          mediaType: msg.ultraMsgData.type
        });

        return {
          timestamp: moment(msg.timestamp).tz('America/Argentina/Buenos_Aires').format(),
          type: msg.ultraMsgData.type,
          content: msg.ultraMsgData.type === 'ptt' || msg.ultraMsgData.type === 'audio' ? "" : msg.content.map(chunk => chunk.content).join(''),
          audio_transcription: audioTranscription,
          quoted_message: msg.ultraMsgData.quotedMsg ? msg.ultraMsgData.quotedMsg : null,
          media_name: msg.media?.filename || null,
          sender: msg.sender,
          message_id: msg.ultraMsgData.id,
          fileStorage: msg.fileStorage || { status: 'not_applicable' }
        };
      });

      const openAiObject = {
        messages: openAiMessages,
        system_message: JSON.stringify({
          conversation_context: {
            participantName: conversation.participantName || "Unknown"
          }
        })
      };

      perf.log('openai_object_prepared', `📤 OpenAI object prepared`, {
        messageCount: openAiMessages.length,
        participantName: conversation.participantName,
        hasSystemMessage: !!openAiObject.system_message
      });

      // ====================================================================
      // ⭐ ABORT CHECKPOINT 2: Before OpenAI request (prevent cost)
      // ====================================================================
      if (await this.checkAbortSignal(conversationId)) {
        perf.log('abort_before_openai', `🚫 Abort signal detected before OpenAI - exiting`);
        
        await AIRequest.findByIdAndUpdate(aiRequest._id, {
          status: 'cancelled',
          cancelReason: 'new_message_arrived',
          cancelledAt: 'before_openai',
          'timestamps.cancelled': new Date()
        });
        
        // ⭐ Delete processing state FIRST, lock LAST (prevents race condition)
        this.processing.delete(conversationId);
        await this.clearAbortSignal(conversationId);
        
        // Delete lock LAST
        await redisClient.del(`activeRun:${conversationId}`);
        return;
      }
      
      // Update AI request status and stage
      processingContext.stage = 'calling_openai';
      await AIRequest.findByIdAndUpdate(aiRequest._id, {
        status: 'processing',
        'timestamps.openaiRequestStart': new Date()
      });
      
      perf.checkpoint('openai_request_start', { timestamp: new Date() });

      // Process with Responses API (with AbortController)
      const result = await openAIIntegration.processConversationMessage(
        conversationId, 
        JSON.stringify(openAiObject),
        abortController  // ⭐ Pass abort controller
      );
      
      perf.checkpoint('openai_response_received', { 
        timestamp: new Date(),
        aborted: processingContext.aborted 
      });
      
      // ====================================================================
      // ⭐ HANDLE ABORTED REQUEST
      // ====================================================================
      if (result.aborted || processingContext.aborted) {
        perf.log('openai_request_aborted', `🚫 OpenAI request was aborted`);
        
        await AIRequest.findByIdAndUpdate(aiRequest._id, {
          status: 'cancelled',
          cancelReason: 'new_message_arrived',
          cancelledAt: 'during_openai',
          'timestamps.cancelled': new Date(),
          'timestamps.openaiResponseReceived': new Date()
        });
        
        // ================================================================
        // ⭐ CRITICAL: Delete processing state FIRST, lock LAST
        // ================================================================
        // Ensures complete cleanup before allowing new processing
        this.processing.delete(conversationId);
        await this.clearAbortSignal(conversationId);
        
        perf.log('cleanup_after_abort', `✅ Cleanup complete after abort`);
        
        // Delete Redis lock LAST (after all cleanup complete)
        await redisClient.del(`activeRun:${conversationId}`);
        
        return;
      }

      // Process the AI response
      if (result.type === 'message') {
        let aiResponse;
        try {
          aiResponse = JSON.parse(result.content);
        } catch (jsonError) {
          console.error(`❌ [${conversationId}] Invalid JSON in AI response:`, {
            error: jsonError.message,
            contentLength: result.content?.length || 0,
            contentPreview: result.content?.substring(0, 200) || 'empty'
          });
          
          // DEFENSIVE PARSING: Handle multiple JSON objects concatenated by newlines
          // This can happen when AI generates multiple response objects in one turn
          console.log(`🔄 [${conversationId}] Attempting defensive JSON parsing (multiple objects detected)`);
          
          try {
            // Split by newlines and try to parse each line as separate JSON
            const lines = result.content.trim().split('\n').filter(line => line.trim().length > 0);
            
            if (lines.length > 1) {
              console.log(`📦 [${conversationId}] Found ${lines.length} JSON objects, using the LAST one (most recent)`);
              
              // Parse all valid JSON objects
              const parsedObjects = [];
              for (const line of lines) {
                try {
                  const parsed = JSON.parse(line);
                  parsedObjects.push(parsed);
                } catch (lineError) {
                  console.warn(`⚠️ [${conversationId}] Skipping invalid JSON line:`, line.substring(0, 100));
                }
              }
              
              if (parsedObjects.length > 0) {
                // Use the last valid JSON object (most recent state)
                aiResponse = parsedObjects[parsedObjects.length - 1];
                console.log(`✅ [${conversationId}] Successfully recovered using last JSON object (timestamp: ${aiResponse.timestamp})`);
              } else {
                throw new Error('No valid JSON objects found after line-by-line parsing');
              }
            } else {
              // Single line but still invalid JSON
          throw jsonError;
        }
          } catch (recoveryError) {
            console.error(`❌ [${conversationId}] Defensive parsing failed:`, recoveryError.message);
            throw jsonError; // Re-throw original error
          }
        }
        
        const { timestamp, thinking, ai_system_message, response, images_observed } = aiResponse;

        // ====================================================================
        // ⭐ EXTRACT AND SAVE AI IMAGE OBSERVATIONS (Performance Optimization)
        // ====================================================================
        // AI provides visual descriptions of images to enable future context without blobs
        // Saves 3-5s per request and ~1000 tokens per image on subsequent requests
        
        if (images_observed && Array.isArray(images_observed) && images_observed.length > 0) {
          console.log(`🎨 [${conversationId}] AI observed ${images_observed.length} images - saving observations`);
          
          for (const observation of images_observed) {
            try {
              // Find the message by message_id
              const userMessage = await Message.findOne({
                conversationId: conversation._id,
                msg_foreign_id: observation.message_id
              });
              
              if (userMessage && userMessage.fileStorage?.fileId) {
                // Save AI's observation to message
                await Message.findByIdAndUpdate(userMessage._id, {
                  'fileStorage.aiObservation': {
                    metadetails: observation.metadetails,
                    visualDescription: observation.visual_description,
                    observedAt: new Date(),
                    modelUsed: agent.modelConfig?.model || 'unknown'
                  }
                });
                
                console.log(`💾 [${conversationId}] Saved AI observation for message: ${observation.message_id}`);
              } else {
                console.warn(`⚠️ [${conversationId}] Message not found for observation: ${observation.message_id}`);
              }
            } catch (obsError) {
              console.error(`⚠️ Failed to save AI observation (non-blocking):`, obsError.message);
              // Continue - observation saving is optimization, not critical path
            }
          }
        }

        // Create a new message object for the AI response
        const newMessageData = {
          conversationId: conversation._id,
          sender: 'ai_agent',
          content: chunkMessage(response.message).map((chunk, index) => ({ order: index, content: chunk })),
          timestamp: moment.tz(timestamp, 'America/Argentina/Buenos_Aires').utc().toDate(),
          status: 'pending',
          thinking: thinking,
          aiSystemMessage: ai_system_message,
          recipient: response.recipient,
          type: 'chat'
        };

        // Add tool context to AI message if tools were used
        if (result.hasTools && result.toolCalls && result.toolCalls.length > 0) {
          console.log(`💾 [${conversationId}] Adding tool context to AI message: ${result.toolCalls.length} tools used`);
          
          const successCount = (result.toolResults || []).filter(r => !r.error).length;
          const errorCount = (result.toolResults || []).filter(r => r.error).length;
          
          newMessageData.openaiToolContext = {
            tool_calls: result.toolCalls.map(call => ({
              id: call.id,
              type: call.type || 'function',
              function: {
                name: call.function.name,
                arguments: call.function.arguments
              }
            })),
            tool_results: (result.toolResults || []).map(toolResult => ({
              tool_call_id: toolResult.tool_call_id,
              role: 'tool',
              content: toolResult.output
            })),
            execution_metadata: {
              timestamp: new Date(),
              total_tools: result.toolCalls.length,
              success_count: successCount,
              error_count: errorCount,
              processing_time_ms: 0
            }
          };
          
          console.log(`✅ [${conversationId}] Tool context added to AI message`, {
            toolCount: result.toolCalls.length,
            successCount,
            errorCount
          });
        }

        // === CRITICAL CHANGE: Save AI message to Message collection ===
        const aiMessage = new Message(newMessageData);
        await aiMessage.save();
        
        perf.log('ai_message_saved', `✅ AI message saved to Message collection`, { 
          aiMessageId: aiMessage._id.toString() 
        });
        
        // ====================================================================
        // ⭐ CACHE AI MESSAGE IN REDIS (for sub-ms access)
        // ====================================================================
        cacheMessage(conversationId, aiMessage).catch(err => {
          console.warn(`⚠️ Failed to cache AI message in Redis (non-blocking):`, err.message);
        });
        
        // Store AI message ID in processing context
        processingContext.aiMessageId = aiMessage._id;
        processingContext.stage = 'message_saved';
        
        // ====================================================================
        // ⭐ ABORT CHECKPOINT 3: After OpenAI, BEFORE sending to user (CRITICAL)
        // ====================================================================
        // This is the "perfeccionista" checkpoint - prevents sending stale messages
        
        if (await this.checkAbortSignal(conversationId)) {
          perf.log('abort_after_openai_before_send', `🚫 CRITICAL ABORT: Message generated but NOT sending (new message arrived)`);
          
          // Mark AI message as cancelled (not sent)
          aiMessage.status = 'cancelled';
          aiMessage.cancelReason = 'new_message_arrived';
          await aiMessage.save();
          
          // Update AIRequest
          await AIRequest.findByIdAndUpdate(aiRequest._id, {
            status: 'cancelled',
            cancelReason: 'new_message_arrived',
            cancelledAt: 'after_openai_before_send',
            aiMessageId: aiMessage._id,
            'timestamps.cancelled': new Date(),
            'timestamps.openaiResponseReceived': new Date()
          });
          
          // ⭐ Delete processing state FIRST, lock LAST (prevents race condition)
          this.processing.delete(conversationId);
          await this.clearAbortSignal(conversationId);
          
          perf.log('perfeccionista_abort_complete', `✅ Message cancelled before send - cleanup complete`);
          
          // Delete lock LAST
          await redisClient.del(`activeRun:${conversationId}`);
          return;
        }
        
        perf.log('abort_check_passed', `✅ No abort signal - proceeding to send message`);

        // Update conversation metadata
        conversation.messageCount = (conversation.messageCount || 0) + 1;
        conversation.lastMessage = response.message;
        conversation.lastMessageTime = newMessageData.timestamp;
        conversation.lastMessageSender = {
          role: 'ai_agent',
          name: conversation.agentName
        };

        try {
          conversation = await saveWithRetry(conversation, 3);
          perf.log('conversation_updated', `✅ Conversation metadata updated`);
        } catch (error) {
          console.error('❌ Error saving conversation:', error);
        }

        perf.log('ai_processing_completed', `✅ AI processing completed`, {
          type: result.type,
          hasContent: !!result.content,
          contentLength: result.content?.length || 0,
          hasToolResults: !!(result.toolResults && result.toolResults.length > 0),
          toolResultCount: result.toolResults?.length || 0,
          messagesToQuoteCount: result.messagesToQuote?.length || 0
        });

        // Send the message via appropriate service based on agent type
        if (response.recipient === 'user') {
          perf.checkpoint('message_send_start', { timestamp: new Date() });
          processingContext.stage = 'sending_message';
          
          try {
            let messageResponse;
            
            // Determinar qué servicio usar basado en el tipo de agente
            if (agent.type === 'wpp-bsp') {
              // Usar WhatsApp Factory API
              
              if (result.messagesToQuote && result.messagesToQuote.length > 0) {
                const uniqueMessagesToQuote = [...new Set(result.messagesToQuote)];
                for (let i = 0; i < uniqueMessagesToQuote.length; i++) {
                  const messageToQuote = uniqueMessagesToQuote[i];
                  if (messageToQuote !== undefined) {
                    const isLastMessage = i === uniqueMessagesToQuote.length - 1;
                    const messageContent = isLastMessage ? response.message : "☝🏽";
                    
                    messageResponse = await sendWhatsAppBusinessMessage(agent, conversation.phoneNumber, messageContent, messageToQuote);
                    
                    if (!isLastMessage) {
                      await new Promise(resolve => setTimeout(resolve, 500));
                    }
                  }
                }
              } else {
                messageResponse = await sendWhatsAppBusinessMessage(agent, conversation.phoneNumber, response.message);
              }

              if (messageResponse && messageResponse.success) {
                aiMessage.status = 'sent';
                aiMessage.whatsappBusinessData = messageResponse.data;
                await aiMessage.save();
              } else {
                throw new Error('Invalid response from WhatsApp Factory API');
              }
              
            } else {
              // Usar UltraMessage
              
              if (result.messagesToQuote && result.messagesToQuote.length > 0) {
                // Handle images in quoted responses
                const hasGeneratedImages = result.toolResults && result.toolResults.some(tool => 
                  tool.result && tool.result.generatedImages && tool.result.generatedImages.length > 0
                );

                const uniqueMessagesToQuote = [...new Set(result.messagesToQuote)];
                for (let i = 0; i < uniqueMessagesToQuote.length; i++) {
                  const messageToQuote = uniqueMessagesToQuote[i];
                  if (messageToQuote !== undefined) {
                    const isLastMessage = i === uniqueMessagesToQuote.length - 1;
                    
                    if (isLastMessage && hasGeneratedImages) {
                      const imageToolResult = result.toolResults.find(tool => {
                        try {
                          const parsedOutput = JSON.parse(tool.output);
                          return parsedOutput.result && parsedOutput.result.generatedImages && parsedOutput.result.generatedImages.length > 0;
                        } catch (parseError) {
                          return false;
                        }
                      });
                      
                      if (imageToolResult) {
                        try {
                          const parsedOutput = JSON.parse(imageToolResult.output);
                          const smartContent = {
                            textResponse: response.message,
                            generatedImages: parsedOutput.result.generatedImages
                          };
                        
                        console.log(`📤 [SEQUENTIAL] Using sequential delivery for quoted message with images`);
                        const sequentialResult = await sequentialMessageService.sendMultipleGeminiResults(
                          agent, 
                          conversation.phoneNumber, 
                          smartContent, 
                          `queue-${conversation._id}`
                        );
                        
                          const firstDelivery = sequentialResult[0];
                          messageResponse = firstDelivery?.result || { sent: 'false', message: 'Sequential delivery failed' };
                          
                        } catch (quotedImageParseError) {
                          console.error(`❌ [${conversationId}] Failed to parse quoted image tool result:`, quotedImageParseError.message);
                          messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message, messageToQuote);
                        }
                      } else {
                        messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message, messageToQuote);
                      }
                    } else {
                      const messageContent = isLastMessage ? response.message : "☝🏽";
                      messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, messageContent, messageToQuote);
                    }
                    
                    if (!isLastMessage) {
                      await new Promise(resolve => setTimeout(resolve, 500));
                    }
                  }
                }
              } else {
                // Check if response contains generated content (images or videos)
                const hasGeneratedImages = result.toolResults && result.toolResults.some(tool => {
                  try {
                    const parsedOutput = JSON.parse(tool.output);
                    return parsedOutput.result && parsedOutput.result.generatedImages && parsedOutput.result.generatedImages.length > 0;
                  } catch (parseError) {
                    console.error(`❌ Failed to parse tool output for image detection:`, parseError.message);
                    return false;
                  }
                });
                
                console.log(`🔍 [${conversationId}] Image detection analysis:`, {
                  hasGeneratedImages,
                  toolResultsCount: result.toolResults?.length || 0
                });
                
                const hasGeneratedVideo = result.toolResults && result.toolResults.some(tool => {
                  return tool.video_url || tool.download_url;
                });

                console.log('🔍 [VIDEO-TRACE] Video detection result:', {
                  hasGeneratedVideo: hasGeneratedVideo,
                  toolResultsCount: result.toolResults?.length || 0
                });

                if (hasGeneratedVideo) {
                  console.log(`🎥 [ULTRAMSG] Response contains generated video, using video delivery`);
                  
                  const videoToolResult = result.toolResults.find(tool => {
                    return tool.video_url || tool.download_url;
                  });
                  
                  if (videoToolResult) {
                    try {
                      const videoUrl = videoToolResult.download_url || videoToolResult.video_url;
                      const videoCaption = response.message || videoToolResult.message || '';
                      
                      console.log(`🎥 [ULTRAMSG] Sending generated video`);
                      
                      messageResponse = await sendUltraMsgVideo(
                        agent, 
                        conversation.phoneNumber, 
                        videoUrl,
                        videoCaption,
                        {
                          priority: 3,
                          referenceId: `generated_video_${Date.now()}`
                        }
                      );
                      
                      console.log('✅ [VIDEO-TRACE] Generated video sent successfully');
                      
                    } catch (videoError) {
                      console.error('❌ Failed to send generated video, falling back to text:', videoError.message);
                      messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
                    }
                  }
                  
                } else if (hasGeneratedImages) {
                  console.log(`🖼️ [ULTRAMSG] Response contains generated images, using smart sending`);
                  
                  const imageToolResult = result.toolResults.find(tool => {
                    try {
                      const parsedOutput = JSON.parse(tool.output);
                      return parsedOutput.result && parsedOutput.result.generatedImages && parsedOutput.result.generatedImages.length > 0;
                    } catch (parseError) {
                      console.error(`❌ Failed to parse tool output for image extraction:`, parseError.message);
                      return false;
                    }
                  });
                  
                  if (imageToolResult) {
                    try {
                      const parsedOutput = JSON.parse(imageToolResult.output);
                      const smartContent = {
                        textResponse: response.message,
                        generatedImages: parsedOutput.result.generatedImages
                      };
                      
                      console.log(`📤 [SEQUENTIAL] Using sequential delivery for multiple outputs`);
                      const sequentialResult = await sequentialMessageService.sendMultipleGeminiResults(
                        agent, 
                        conversation.phoneNumber, 
                        smartContent, 
                        `queue-${conversation._id}`
                      );
                      
                      const successfulDeliveries = sequentialResult.filter(d => d.result.sent === 'true');
                      if (successfulDeliveries.length > 0) {
                        messageResponse = successfulDeliveries[0].result;
                      } else {
                        messageResponse = { sent: 'false', message: 'All sequential deliveries failed' };
                      }
                      
                    } catch (imageParseError) {
                      console.error(`❌ [${conversationId}] Failed to parse image tool result:`, imageParseError.message);
                      messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
                    }
                  } else {
                    messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
                  }
                } else {
                  // No images or videos, send text normally
                console.log(`📝 [ULTRAMSG] Text-only response, using regular sending`);
                messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
                }
              }
              }

              if (messageResponse && messageResponse.data) {
              aiMessage.status = 'sent';
              aiMessage.ultraMsgData = messageResponse.data;
              await aiMessage.save();
              
              perf.checkpoint('message_send_complete', { timestamp: new Date() });
              perf.log('message_sent', `✅ AI message status updated to sent`);
              
              // ============================================================
              // ⭐ UPDATE AI REQUEST WITH TOKEN DATA & COMPLETION
              // ============================================================
              
              // Extract token data from result if available
              const tokenData = result.tokens || {};
              
              await AIRequest.findByIdAndUpdate(aiRequest._id, {
                status: 'completed',
                aiMessageId: aiMessage._id,
                'timestamps.messageSendComplete': new Date(),
                'timestamps.completed': new Date(),
                'tokens': tokenData,
                finishReason: result.finishReason || 'stop',
                openaiResponseId: result.openaiResponseId
              });
              
              // Calculate durations
              const updatedRequest = await AIRequest.findById(aiRequest._id);
              if (updatedRequest) {
                updatedRequest.calculateDurations();
                await updatedRequest.save();
              }
              
              perf.log('ai_request_completed', `📊 AIRequest updated with completion data`);
              
              } else {
              throw new Error('Invalid response from message service');
            }
          } catch (error) {
            console.error(`❌ Failed to send message via ${agent.type === 'wpp-bsp' ? 'WhatsApp Factory API' : 'UltraMessage'}:`, error);
            aiMessage.status = 'failed';
            aiMessage.errorData = error.message;
            await aiMessage.save();
          }
        }
      }

      // Log completion (perf already declared at function start)
      if (perf) {
        perf.log('queue_processing_complete', `✅ Queue processed successfully`);
        perf.logTimeline(); // Log complete timeline
      } else {
      console.log(`✅ Queue processed successfully for conversation: ${conversationId}`);
      }
      
      // ⭐ Clear performance tracker (other cleanup in finally block)
      this.performanceTrackers.delete(conversationId);
      
    } catch (error) {
      console.error(`❌ Error processing queue for conversation ${conversationId}:`, error);
      
      // Mark AIRequest as failed if it exists
      const processingContext = this.processing.get(conversationId);
      if (processingContext?.aiRequestId) {
        try {
          await AIRequest.findByIdAndUpdate(processingContext.aiRequestId, {
            status: 'failed',
            'error.message': error.message,
            'error.code': error.code,
            'error.stack': error.stack,
            'error.timestamp': new Date()
          });
        } catch (updateError) {
          console.error(`❌ Failed to update AIRequest on error:`, updateError.message);
        }
      }
      
    } finally {
      // ====================================================================
      // ⭐ CRITICAL: Cleanup Order to Prevent Race Conditions
      // ====================================================================
      // 1. Delete processing state FIRST
      // 2. Clear abort signals
      // 3. Delete Redis lock LAST
      // This ensures no new processQueue can start while cleanup is in progress
      
      // 1. Cleanup processing context and signals FIRST
      this.processing.delete(conversationId);
      try {
        await this.clearAbortSignal(conversationId);
      } catch (signalError) {
        console.error(`❌ Error clearing abort signal:`, signalError.message);
      }

      // 2. Clear Redis lock LAST (prevents race condition)
      try {
        if (!redisClient.isOpen) {
          await redisClient.connect();
        }
        await redisClient.del(`activeRun:${conversationId}`);
        this.activeRuns.delete(conversationId);
        console.log(`🧹 Redis lock cleaned up for conversation: ${conversationId}`);
      } catch (cleanupError) {
        console.error(`❌ Error cleaning up Redis lock:`, cleanupError.message);
      }

      // 3. Schedule retry if queue has more messages
      if (this.queues.has(conversationId) && this.queues.get(conversationId).length > 0) {
        this.scheduleRetry(conversationId);
      }
    }
  }

  scheduleRetry(conversationId) {
    setTimeout(() => this.processQueue(conversationId), this.retryInterval);
  }

  /**
   * Checks if AI processing should be interrupted due to recent agent message.
   * Agent messages within 10 minutes interrupt AI to allow human agent control.
   * 
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<boolean>} True if AI should be skipped
   */
  async checkAgentMessageInterrupt(conversationId) {
    try {
      // Query Message collection for most recent agent message
      const mostRecentAgentMessage = await Message.findOne({
        conversationId: conversationId,
        sender: 'agent'
      }).sort({ timestamp: -1 }).limit(1);
      
      if (!mostRecentAgentMessage) {
        console.log('✅ TRACE: No agent messages found, AI processing allowed');
        return false;
      }
      
      console.log('🔍 TRACE: Checking most recent agent message for interrupt:', {
        messageId: mostRecentAgentMessage._id,
        sender: mostRecentAgentMessage.sender,
        timestamp: mostRecentAgentMessage.timestamp
      });
      
      // Check if most recent agent message is within 10 minutes
      const now = new Date();
      const messageTime = new Date(mostRecentAgentMessage.timestamp);
      const timeDifference = now - messageTime;
      const tenMinutesInMs = 10 * 60 * 1000;
      
      const isRecent = timeDifference < tenMinutesInMs;
      const minutesAgo = Math.floor(timeDifference / (60 * 1000));
      
      console.log('🔍 TRACE: Agent message timing analysis:', {
        messageTime: messageTime.toISOString(),
        currentTime: now.toISOString(),
        timeDifferenceMs: timeDifference,
        minutesAgo: minutesAgo,
        isWithin10Minutes: isRecent,
        shouldInterruptAI: isRecent
      });
      
      if (isRecent) {
        console.log(`🚫 AGENT INTERRUPT: Agent message is ${minutesAgo} minutes old (<10 min), skipping AI processing`);
        return true;
      } else {
        console.log(`✅ AGENT TIMEOUT: Agent message is ${minutesAgo} minutes old (>10 min), AI processing allowed`);
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error checking agent message interrupt:', error.message);
      return false; // On error, proceed with AI (safe default)
    }
  }
}

module.exports = new MessageQueue();
