/**
 * modules/requestManager.js
 * 
 * Description: Business logic manager for parallel request processing system with Google Gemini integration
 * 
 * Role in the system: Manages the lifecycle of image processing requests, coordinates between OpenAI tools and Google Gemini API
 * 
 * Node.js Context: Module - Business logic layer for request management
 * 
 * Dependencies:
 * - models/Request.js (MongoDB request model)
 * - services/googleGeminiService.js (Google Gemini API integration)
 * - utils/fileStorageUtils.js (File storage utilities)
 * 
 * Dependants:
 * - modules/openaiIntegration.js (OpenAI tool execution)
 */

const Request = require('../models/Request');
const googleGeminiService = require('../services/googleGeminiService');
const Conversation = require('../models/Conversation');
const { hasMediaContent, createDownloadUrl } = require('../utils/fileStorageUtils');

class RequestManager {
  constructor() {
    this.processingTimeouts = new Map(); // Track processing timeouts
    this.maxConcurrentRequests = 5;      // Limit concurrent processing
    this.activeProcessingCount = 0;
  }

  /**
   * Determine which images are for the CURRENT turn vs historical images
   * @param {Object} request - MongoDB Request document
   * @returns {Array} Array of file IDs for current turn only
   */
  determineCurrentTurnImages(request) {
    try {
      console.log(`🔍 [${request._id}] Determining current turn images`);

      // Get all image file IDs that are already in conversation history
      const historicalImageIds = new Set();
      
      if (request.conversationHistory && request.conversationHistory.length > 0) {
        for (const historyEntry of request.conversationHistory) {
          for (const part of historyEntry.parts) {
            if (part.type === 'image') {
              historicalImageIds.add(part.content); // part.content is the fileId for images
            }
          }
        }
      }

      // Find images in inputImages that are NOT in conversation history
      const currentTurnImageIds = [];
      for (const inputImage of request.inputImages) {
        if (!historicalImageIds.has(inputImage.fileId)) {
          currentTurnImageIds.push(inputImage.fileId);
        }
      }

      console.log(`✅ [${request._id}] Image analysis:`, {
        totalInputImages: request.inputImages.length,
        historicalImages: historicalImageIds.size,
        currentTurnImages: currentTurnImageIds.length,
        currentTurnList: currentTurnImageIds
      });

      return currentTurnImageIds;

    } catch (error) {
      console.error(`❌ [${request._id}] Error determining current turn images:`, error.message);
      // Fallback: assume all inputImages are current turn (old behavior)
      return request.inputImages.map(img => img.fileId);
    }
  }

  // REMOVED: autoDiscoverRecentImages() function - was causing audio/video to be treated as images
  // Image tools now only use explicitly provided images to prevent media type confusion

  /**
   * Create a new parallel request for image processing
   * @param {string} conversationId - Main conversation ID
   * @param {number} participantId - Participant ID from PostgreSQL
   * @param {string} participantName - Participant name
   * @param {string} systemPrompt - Custom system instruction for Gemini
   * @param {Array} initialImages - Array of file IDs for initial images (optional)
   * @param {string} requestType - Type of request (image_processing, photo_product, etc.)
   * @returns {Object} New request result
   */
  async createNewRequest(conversationId, participantId, participantName, systemPrompt, initialImages = [], requestType = 'image_processing') {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`📋 [${requestId}] Creating new request`, {
        conversationId,
        participantId,
        participantName,
        requestType,
        initialImageCount: initialImages.length,
        systemPromptLength: systemPrompt.length
      });

      // Validate inputs
      if (!conversationId || !participantId || !systemPrompt) {
        throw new Error('Missing required parameters: conversationId, participantId, or systemPrompt');
      }

      // Verify conversation exists
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        throw new Error(`Conversation not found: ${conversationId}`);
      }

      // Create new request document
      const newRequest = new Request({
        conversationId,
        participantId,
        participantName: participantName || 'Unknown',
        systemPrompt,
        type: requestType,
        status: 'active',
        currentIteration: 0
      });

      // Add initial images if provided - NO auto-discovery to prevent audio/video confusion
      let imagesToAdd = initialImages || [];
      
      console.log(`🖼️ [${requestId}] Using provided images only - no auto-discovery to prevent media type confusion:`, {
        providedImages: imagesToAdd.length,
        allowEmptyArray: true
      });
      
      if (imagesToAdd && imagesToAdd.length > 0) {
        console.log(`🖼️ [${requestId}] Adding ${imagesToAdd.length} explicit images`);
        for (const imageIdentifier of imagesToAdd) {
          // 🔧 CRITICAL FIX: Resolve file ID correctly
          const resolvedFileId = await this.resolveFileId(imageIdentifier, conversationId, requestId);
          if (resolvedFileId) {
            await newRequest.addInputImage(resolvedFileId, `initial_image_${resolvedFileId}`, 'Initial image for processing');
          } else {
            console.error(`❌ [${requestId}] Could not resolve file ID for: ${imageIdentifier}`);
          }
        }
      } else {
        console.log(`📝 [${requestId}] No images provided - creating text-only request (empty image array accepted)`);
      }

      // Save request to database
      const savedRequest = await newRequest.save();
      
      console.log(`✅ [${requestId}] Request created successfully`, {
        requestId: savedRequest._id,
        status: savedRequest.status,
        imageCount: savedRequest.inputImages.length
      });

      return {
        success: true,
        requestId: savedRequest._id.toString(),
        status: savedRequest.status,
        type: savedRequest.type,
        imageCount: savedRequest.inputImages.length,
        message: `New ${requestType} request created with ID: ${savedRequest._id}`
      };

    } catch (error) {
      console.error(`❌ [${requestId}] Failed to create request:`, error.message);
      return {
        success: false,
        error: error.message,
        errorCode: 'REQUEST_CREATION_FAILED'
      };
    }
  }

  /**
   * Update an existing request with new images or instructions
   * @param {string} requestId - Request ID to update
   * @param {Array} newImages - Array of new file IDs to add (optional)
   * @param {string} instructions - New instructions to add (optional)
   * @returns {Object} Update result
   */
  async updateRequest(requestId, newImages = [], instructions = '') {
    try {
      console.log(`🔄 [${requestId}] Updating request`, {
        newImageCount: newImages.length,
        hasInstructions: !!instructions,
        instructionsLength: instructions.length
      });

      // Find existing request
      const request = await Request.findById(requestId);
      if (!request) {
        throw new Error(`Request not found: ${requestId}`);
      }

      // Check if request is in a valid state for updates
      if (request.status === 'processing') {
        throw new Error('Cannot update request while processing is in progress');
      }

      if (request.status === 'completed') {
        // Allow updates to completed requests for iterations
        console.log(`🔄 [${requestId}] Updating completed request for new iteration`);
        request.status = 'active';
      }

      let updatedCount = 0;

      // Add new images if provided
      if (newImages && newImages.length > 0) {
        console.log(`🖼️ [${requestId}] Adding ${newImages.length} new images`);
        for (const imageIdentifier of newImages) {
          // 🔧 CRITICAL FIX: Resolve file ID correctly
          const resolvedFileId = await this.resolveFileId(imageIdentifier, request.conversationId, requestId);
          if (resolvedFileId) {
            await request.addInputImage(resolvedFileId, `updated_image_${resolvedFileId}`, instructions || 'Updated image');
            updatedCount++;
          } else {
            console.error(`❌ [${requestId}] Could not resolve file ID for: ${imageIdentifier}`);
          }
        }
      }

      // Add instructions if provided
      if (instructions && instructions.trim()) {
        console.log(`📝 [${requestId}] Adding new instructions (${instructions.length} chars)`);
        await request.addInstruction(instructions.trim());
        updatedCount++;
      }

      if (updatedCount === 0) {
        return {
          success: false,
          error: 'No updates provided (no images or instructions)',
          errorCode: 'NO_UPDATES_PROVIDED'
        };
      }

      // Save updated request
      await request.save();

      console.log(`✅ [${requestId}] Request updated successfully`, {
        totalImages: request.inputImages.length,
        totalInstructions: request.instructions.length,
        updatedItems: updatedCount
      });

      return {
        success: true,
        requestId: request._id.toString(),
        status: request.status,
        imageCount: request.inputImages.length,
        instructionCount: request.instructions.length,
        message: `Request updated with ${updatedCount} new items`
      };

    } catch (error) {
      console.error(`❌ [${requestId}] Failed to update request:`, error.message);
      return {
        success: false,
        error: error.message,
        errorCode: 'REQUEST_UPDATE_FAILED'
      };
    }
  }

  /**
   * Process a request using Google Gemini
   * @param {string} requestId - Request ID to process
   * @param {string} finalPrompt - Final prompt for processing (optional)
   * @returns {Object} Processing result
   */
  async processRequest(requestId, finalPrompt = '') {
    try {
      console.log(`⚡ [${requestId}] Starting request processing`, {
        hasFinalPrompt: !!finalPrompt,
        activeProcessing: this.activeProcessingCount
      });

      // Check concurrent processing limit
      if (this.activeProcessingCount >= this.maxConcurrentRequests) {
        throw new Error('Maximum concurrent processing limit reached. Please try again later.');
      }

      // Find and validate request
      const request = await Request.findById(requestId);
      if (!request) {
        throw new Error(`Request not found: ${requestId}`);
      }

      if (request.status === 'processing') {
        throw new Error('Request is already being processed');
      }

      if (request.inputImages.length === 0) {
        throw new Error('No images available for processing');
      }

      // Check iteration limits
      if (request.currentIteration >= request.maxIterations) {
        throw new Error(`Maximum iterations (${request.maxIterations}) reached for this request`);
      }

      // Set request to processing status
      this.activeProcessingCount++;
      await request.setProcessing();

      try {
        // Prepare processing data
        const allImageFileIds = request.inputImages.map(img => img.fileId);
        const allInstructions = request.instructions.concat(finalPrompt ? [finalPrompt] : []);
        const combinedPrompt = allInstructions.join('\n\n');

        // CRITICAL FIX: Determine which images are for CURRENT turn (not all images)
        const currentTurnImageIds = this.determineCurrentTurnImages(request);

        console.log(`🎨 [${requestId}] Sending to Gemini with proper image context`, {
          totalImages: allImageFileIds.length,
          currentTurnImages: currentTurnImageIds.length,
          promptLength: combinedPrompt.length,
          iteration: request.currentIteration + 1
        });

        // Process with Google Gemini
        const processingStart = Date.now();
        let geminiResult;

        if (allImageFileIds.length > 0) {
          // Image processing with conversation context - ENHANCED AND FIXED
          geminiResult = await googleGeminiService.processImages(
            request, // Pass entire request for conversation context
            combinedPrompt,
            currentTurnImageIds, // Pass ONLY current turn images, not all images
            requestId
          );
        } else {
          // Text-to-image generation
          geminiResult = await googleGeminiService.generateImages(
            combinedPrompt,
            request.systemPrompt,
            requestId
          );
        }

        const processingTime = Date.now() - processingStart;

        if (!geminiResult.success) {
          throw new Error(`Gemini processing failed: ${geminiResult.error}`);
        }

        // Save generated images to request - ENHANCED with multiple outputs
        if (geminiResult.generatedImages && geminiResult.generatedImages.length > 0) {
          console.log(`💾 [${requestId}] Saving ${geminiResult.generatedImages.length} generated images with metadata`);
          
          // Use new addMultipleOutputs method for enhanced metadata
          const outputsForSave = geminiResult.generatedImages.map(img => ({
            fileId: img.fileId,
            filename: img.filename,
            geminiResponse: img.associatedText || geminiResult.textResponse || 'Generated image',
            responseOrder: img.responseOrder || 0,
            responseType: img.responseType || 'image',
            associatedText: img.associatedText || '',
            isMultipleResponse: img.isMultipleResponse || false
          }));
          
          await request.addMultipleOutputs(outputsForSave);
          
          console.log(`✅ [${requestId}] Saved multiple outputs with enhanced metadata`, {
            outputCount: outputsForSave.length,
            hasMultipleResponse: outputsForSave.some(o => o.isMultipleResponse),
            responseTypes: [...new Set(outputsForSave.map(o => o.responseType))]
          });
        }

        // Add to processing history
        await request.addProcessingHistory(
          combinedPrompt,
          geminiResult.textResponse || 'Processing completed',
          processingTime
        );

        // Set request as completed
        await request.setCompleted();

        console.log(`✅ [${requestId}] Processing completed successfully`, {
          processingTime: `${processingTime}ms`,
          generatedImages: geminiResult.generatedImages.length,
          textResponseLength: geminiResult.textResponse?.length || 0
        });

        return {
          success: true,
          requestId: request._id.toString(),
          status: 'completed',
          iteration: request.currentIteration,
          processingTime,
          result: {
            type: geminiResult.type,
            textResponse: geminiResult.textResponse,
            generatedImages: geminiResult.generatedImages,
            downloadUrls: geminiResult.generatedImages.map(img => img.downloadUrl)
          },
          message: `Processing completed in ${processingTime}ms with ${geminiResult.generatedImages.length} generated images`
        };

      } finally {
        this.activeProcessingCount--;
      }

    } catch (error) {
      console.error(`❌ [${requestId}] Processing failed:`, error.message);
      
      // Update request with error status
      try {
        const request = await Request.findById(requestId);
        if (request) {
          await request.setError('PROCESSING_FAILED', error.message);
        }
      } catch (dbError) {
        console.error(`❌ [${requestId}] Failed to update request error status:`, dbError.message);
      }
      
      this.activeProcessingCount = Math.max(0, this.activeProcessingCount - 1);

      return {
        success: false,
        error: error.message,
        errorCode: 'REQUEST_PROCESSING_FAILED',
        requestId
      };
    }
  }

  /**
   * Get request status and details
   * @param {string} requestId - Request ID to get status for
   * @returns {Object} Request status and details
   */
  async getRequestStatus(requestId) {
    try {
      const request = await Request.findById(requestId);
      if (!request) {
        return {
          success: false,
          error: 'Request not found',
          errorCode: 'REQUEST_NOT_FOUND'
        };
      }

      return {
        success: true,
        requestId: request._id.toString(),
        status: request.status,
        type: request.type,
        currentIteration: request.currentIteration,
        maxIterations: request.maxIterations,
        inputImageCount: request.inputImages.length,
        outputImageCount: request.outputImages.length,
        instructionCount: request.instructions.length,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
        lastError: request.lastError
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: 'STATUS_QUERY_FAILED'
      };
    }
  }

  /**
   * List active requests for a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Object} List of active requests
   */
  async listActiveRequests(conversationId) {
    try {
      const activeRequests = await Request.findActiveByConversation(conversationId);
      
      return {
        success: true,
        requestCount: activeRequests.length,
        requests: activeRequests.map(req => ({
          requestId: req._id.toString(),
          type: req.type,
          status: req.status,
          imageCount: req.inputImages.length,
          currentIteration: req.currentIteration,
          createdAt: req.createdAt,
          updatedAt: req.updatedAt
        }))
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: 'REQUEST_LIST_FAILED'
      };
    }
  }

  /**
   * Cancel an active request
   * @param {string} requestId - Request ID to cancel
   * @returns {Object} Cancellation result
   */
  async cancelRequest(requestId) {
    try {
      const request = await Request.findById(requestId);
      if (!request) {
        return {
          success: false,
          error: 'Request not found',
          errorCode: 'REQUEST_NOT_FOUND'
        };
      }

      if (request.status === 'processing') {
        return {
          success: false,
          error: 'Cannot cancel request while processing is in progress',
          errorCode: 'REQUEST_PROCESSING'
        };
      }

      request.status = 'cancelled';
      await request.save();

      return {
        success: true,
        requestId: request._id.toString(),
        status: 'cancelled',
        message: 'Request cancelled successfully'
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        errorCode: 'REQUEST_CANCELLATION_FAILED'
      };
    }
  }

  /**
   * Resolve file ID from various input formats (message ID, actual file ID)
   * @param {string} imageIdentifier - Could be message ID or actual file ID
   * @param {string} conversationId - Conversation ID to search in
   * @param {string} requestId - Request ID for logging
   * @returns {string|null} Resolved file ID or null if not found
   */
  async resolveFileId(imageIdentifier, conversationId, requestId) {
    try {
      console.log(`🔍 [${requestId}] Resolving file ID for: ${imageIdentifier}`);

      // Check if it's already a valid file ID format (32-character hex)
      if (/^[a-f0-9]{32}$/.test(imageIdentifier)) {
        console.log(`✅ [${requestId}] Already valid file ID: ${imageIdentifier}`);
        return imageIdentifier;
      }

      // If it looks like a message ID, search for it in the conversation
      if (imageIdentifier.includes('@c.us') || imageIdentifier.includes('false_')) {
        console.log(`🔍 [${requestId}] Searching conversation for message ID: ${imageIdentifier}`);
        
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
          console.error(`❌ [${requestId}] Conversation not found: ${conversationId}`);
          return null;
        }

        // Find message with matching message ID
        const message = conversation.messages.find(msg => 
          msg.msg_foreign_id === imageIdentifier || 
          msg.ultraMsgData?.id === imageIdentifier
        );

        if (message && message.fileStorage && message.fileStorage.status === 'success') {
          console.log(`✅ [${requestId}] Found file ID via message lookup: ${message.fileStorage.fileId}`);
          return message.fileStorage.fileId;
        } else {
          console.error(`❌ [${requestId}] Message found but no successful file storage:`, {
            messageFound: !!message,
            fileStorageStatus: message?.fileStorage?.status || 'none'
          });
          return null;
        }
      }

      // Unknown format
      console.error(`❌ [${requestId}] Unknown identifier format: ${imageIdentifier}`);
      return null;

    } catch (error) {
      console.error(`❌ [${requestId}] Error resolving file ID:`, error.message);
      return null;
    }
  }

  /**
   * Health check for request manager
   */
  async healthCheck() {
    try {
      const activeRequests = await Request.countDocuments({ status: 'active' });
      const processingRequests = await Request.countDocuments({ status: 'processing' });
      
      return {
        status: 'healthy',
        activeRequests,
        processingRequests,
        activeProcessingCount: this.activeProcessingCount,
        maxConcurrentRequests: this.maxConcurrentRequests,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

// Export singleton instance
const requestManager = new RequestManager();

module.exports = requestManager;
