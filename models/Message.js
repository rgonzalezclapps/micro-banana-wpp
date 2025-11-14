/**
 * models/Message.js
 * 
 * Description: MongoDB model for storing individual messages (separated from Conversation)
 * 
 * Role in the system: Independent message storage enabling scalability and efficient queries
 * 
 * Node.js Context: Model - MongoDB message collection with full message metadata
 * 
 * Dependencies:
 * - mongoose (ODM for MongoDB operations)
 * - Conversation model (for conversationId reference)
 * 
 * Dependants:
 * - modules/conversationManager.js (message creation)
 * - modules/messageQueue.js (message updates and queries)
 * - modules/responsesClient.js (building OpenAI context)
 * - routes/externalApiRoutes.js (API message retrieval)
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ============================================================================
// Sub-Schemas for Message Structure
// ============================================================================

const MessageChunkSchema = new Schema({
  order: Number,
  content: String
}, { _id: false });

// OpenAI Tool Call Context Sub-schemas for perfect structure
const ToolCallSchema = new Schema({
  id: String,           // OpenAI tool call ID (e.g., "call_abc123")
  type: String,         // "function"
  function: {
    name: String,       // Tool function name  
    arguments: String   // JSON string of arguments
  }
}, { _id: false });

const ToolResultSchema = new Schema({
  tool_call_id: String,           // Matches tool_calls[].id
  role: { type: String, default: 'tool' },  // OpenAI role
  content: String                 // Tool execution result (JSON string)
}, { _id: false });

const ExecutionMetadataSchema = new Schema({
  timestamp: { type: Date, default: Date.now },
  total_tools: Number,
  success_count: Number,
  error_count: Number,
  processing_time_ms: Number
}, { _id: false });

// ============================================================================
// Main Message Schema
// ============================================================================

const MessageSchema = new Schema({
  // === CRITICAL: Conversation Reference ===
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true  // Critical for query performance
  },
  
  // === Core Message Fields ===
  sender: {
    type: String,
    enum: ['ai_agent', 'bot_agent', 'user', 'agent', 'specialist', 'system_trigger'],
    required: true
  },
  type: {
    type: String,
    enum: [
      // Original types
      'chat', 'text', 'buttons', 'button-click', 'audio', 'ptt', 'image', 'file',
      // WhatsApp Factory message types
      'video', 'document', 'sticker', 'location', 'contacts', 'interactive', 'reaction',
      // Business and system types
      'system', 'order', 'template', 'hsm', 'edited', 'deleted'
    ],
    required: false
  },
  msg_foreign_id: {
    type: String,
    required: false,
    index: true  // For webhook updates
  },
  msg_source: {
    type: String,
    enum: ['botmaker', 'ultramsg', 'whatsapp-factory'],
    required: false
  },
  content: [MessageChunkSchema],
  
  // === Audio Transcription ===
  audioTranscription: {
    text: [MessageChunkSchema],
    status: { 
      type: String, 
      enum: ['pending', 'processing', 'completed', 'failed']
    },
    status_reason: {
      type: String,
      required: function() {
        return this.audioTranscription && this.audioTranscription.status === 'failed';
      }
    }
  },
  
  // === Timestamps & Status ===
  timestamp: {
    type: Date,
    required: true,
    index: true  // For chronological sorting
  },
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'read', 'received', 'ultraMsg', 'cancelled', 'failed'],
    default: 'pending'
  },
  cancelReason: {
    type: String,
    enum: ['new_message_arrived', 'user_abort', 'timeout', 'error'],
    required: function() { return this.status === 'cancelled'; }
  },
  failureReason: {
    type: String,
    required: function() { return this.status === 'failed'; }
  },
  
  // === Platform Data ===
  ultraMsgData: {
    type: mongoose.Schema.Types.Mixed,
    required: false  
  },
  
  // === AI Response Fields ===
  thinking: String,
  aiSystemMessage: {
    type: String,
    get: function(data) {
      try {
        return JSON.parse(data);
      } catch (error) {
        return data;
      }
    },
    set: function(data) {
      return JSON.stringify(data);
    }
  },
  
  // === OpenAI Responses API - Complete tool call context storage ===
  openaiToolContext: {
    // Exact OpenAI tool_calls format from assistant response
    tool_calls: [ToolCallSchema],
    // Exact OpenAI tool results format for context reconstruction  
    tool_results: [ToolResultSchema],
    // Metadata for debugging and audit
    execution_metadata: ExecutionMetadataSchema
  },
  
  recipient: {
    type: String,
    enum: ['user', 'operator', 'specialist', 'system'],
    default: 'user'
  },
  
  // === File Storage Result for Media Messages ===
  fileStorage: {
    status: {
      type: String,
      enum: ['pending', 'success', 'error', 'not_applicable'],
      default: 'not_applicable'
    },
    fileId: {
      type: String,
      required: false // Crypto-secure file ID from our storage server
    },
    filename: {
      type: String,
      required: false // Generated secure filename
    },
    originalFilename: {
      type: String,
      required: false // Original filename if available
    },
    fileSize: {
      type: Number,
      required: false // File size in bytes
    },
    fileSizeHuman: {
      type: String,
      required: false // Human-readable file size
    },
    contentType: {
      type: String,
      required: false // MIME type
    },
    downloadUrl: {
      type: String,
      required: false // URL to access file from our storage
    },
    uploadDate: {
      type: Date,
      required: false // When file was successfully stored
    },
    errorCode: {
      type: String,
      required: false // Error code if storage failed
    },
    errorMessage: {
      type: String,
      required: false // Error message if storage failed
    },
    requestId: {
      type: String,
      required: false // Request tracking ID
    },
    
    // ========================================================================
    // ⭐ PERFORMANCE OPTIMIZATION: Blob Caching
    // ========================================================================
    // Cache base64 blob to avoid re-downloading images for OpenAI context
    // Saves 0.5-1s per image on subsequent requests + eliminates file system I/O
    
    base64Cache: {
      data: {
        type: String,
        select: false,  // Exclude from default queries (large field)
        description: 'Base64 encoded image data for OpenAI context reuse'
      },
      mimeType: {
        type: String,
        description: 'MIME type (e.g., image/jpeg, image/png)'
      },
      cachedAt: {
        type: Date,
        index: true,  // For cache expiration queries
        description: 'When blob was cached'
      },
      sizeBytes: {
        type: Number,
        description: 'Size of base64 data in bytes'
      },
      sizeKB: {
        type: Number,
        description: 'Human-readable size in KB'
      }
    },
    
    // ========================================================================
    // ⭐ AI OBSERVATION: Visual Description for Context
    // ========================================================================
    // AI generates description of image for future context without blob
    // Enables smart history with placeholders (saves ~1000 tokens per old image)
    
    aiObservation: {
      metadetails: {
        type: String,
        maxlength: 500,
        description: 'Technical metadata: filename, type, size, upload timestamp'
      },
      visualDescription: {
        type: String,
        maxlength: 2000,
        description: 'AI-generated comprehensive visual description of image content'
      },
      observedAt: {
        type: Date,
        description: 'When AI first observed and described this image'
      },
      modelUsed: {
        type: String,
        description: 'Which AI model generated the description'
      }
    }
  }
}, {
  timestamps: true,
  collection: 'messages'
});

// ============================================================================
// Indexes for Performance
// ============================================================================

// Primary query pattern: Get messages for a conversation, sorted chronologically
MessageSchema.index({ conversationId: 1, timestamp: -1 });

// Find last assistant message (for image history cutoff)
MessageSchema.index({ conversationId: 1, sender: 1, timestamp: -1 });

// Status-based queries for analytics and monitoring
MessageSchema.index({ status: 1, timestamp: -1 });

// Webhook updates: Find message by external platform ID
MessageSchema.index({ msg_foreign_id: 1 }, { sparse: true });

// Media queries: Find messages by file ID
MessageSchema.index({ 'fileStorage.fileId': 1 }, { sparse: true });

// Content search (for potential future full-text search)
MessageSchema.index({ 'content.content': 'text' }, { sparse: true });

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Get the message content as a single string
 * @returns {string} Concatenated message content
 */
MessageSchema.methods.getContentString = function() {
  if (!this.content || this.content.length === 0) {
    return '';
  }
  return this.content.map(chunk => chunk.content).join('');
};

/**
 * Get audio transcription as a single string
 * @returns {string} Concatenated transcription text
 */
MessageSchema.methods.getTranscriptionString = function() {
  if (!this.audioTranscription || !this.audioTranscription.text || this.audioTranscription.text.length === 0) {
    return '';
  }
  return this.audioTranscription.text.map(chunk => chunk.content).join('');
};

/**
 * Check if message has tool context
 * @returns {boolean} True if message has OpenAI tool calls
 */
MessageSchema.methods.hasToolContext = function() {
  return !!(this.openaiToolContext && 
           this.openaiToolContext.tool_calls && 
           this.openaiToolContext.tool_calls.length > 0);
};

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Find all messages for a conversation
 * @param {ObjectId} conversationId - Conversation ID
 * @param {Object} options - Query options (limit, sort, etc.)
 * @returns {Promise<Array>} Array of messages
 */
MessageSchema.statics.findByConversation = async function(conversationId, options = {}) {
  const {
    limit = null,
    skip = 0,
    sortOrder = 1  // 1 for ascending (chronological), -1 for descending
  } = options;
  
  let query = this.find({ conversationId }).sort({ timestamp: sortOrder });
  
  if (skip) query = query.skip(skip);
  if (limit) query = query.limit(limit);
  
  return await query.lean();
};

/**
 * Find message by external platform ID
 * @param {string} msg_foreign_id - External message ID
 * @returns {Promise<Object>} Message document
 */
MessageSchema.statics.findByForeignId = async function(msg_foreign_id) {
  return await this.findOne({ msg_foreign_id });
};

/**
 * Get message count for a conversation
 * @param {ObjectId} conversationId - Conversation ID
 * @returns {Promise<number>} Count of messages
 */
MessageSchema.statics.countByConversation = async function(conversationId) {
  return await this.countDocuments({ conversationId });
};

/**
 * Get recent messages for a conversation
 * @param {ObjectId} conversationId - Conversation ID
 * @param {number} limit - Number of recent messages to retrieve
 * @returns {Promise<Array>} Array of recent messages
 */
MessageSchema.statics.getRecentMessages = async function(conversationId, limit = 50) {
  return await this.find({ conversationId })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Delete all messages for a conversation
 * @param {ObjectId} conversationId - Conversation ID
 * @returns {Promise<Object>} Delete result
 */
MessageSchema.statics.deleteByConversation = async function(conversationId) {
  return await this.deleteMany({ conversationId });
};

// ============================================================================
// Export Model
// ============================================================================

const Message = mongoose.model('Message', MessageSchema);

module.exports = Message;

