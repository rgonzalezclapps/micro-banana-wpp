/**
 * services/googleGeminiService.js
 * 
 * Description: Google Gemini API integration service for image processing and generation using gemini-2.5-flash-image-preview model
 * 
 * Role in the system: Handles all interactions with Google Gemini API for image understanding, generation, and editing
 * 
 * Node.js Context: Service - External API integration for AI image processing
 * 
 * Dependencies:
 * - @google/genai (Google Gemini SDK)
 * - axios (HTTP client for file downloads)
 * - fs/promises (File system operations)
 * - utils/fileStorageUtils.js (File storage integration)
 * 
 * Dependants:
 * - modules/requestManager.js (business logic for requests)
 * - modules/openaiIntegration.js (tool execution)
 */

const { GoogleGenAI, Modality } = require('@google/genai');
const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const Request = require('../models/Request');
const { createDownloadUrl, createExternalDownloadUrl } = require('../utils/fileStorageUtils');

class GoogleGeminiService {
  constructor() {
    // Initialize Google Gemini client
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });
    
    // Model configuration for image processing
    this.MODEL_NAME = 'gemini-2.5-flash-image-preview';
    this.DEFAULT_CONFIG = {
      responseModalities: ['IMAGE'],
      systemInstruction: []
    };
    
    // Request timeout and limits
    this.REQUEST_TIMEOUT = 60000; // 60 seconds
    this.MAX_INPUT_IMAGES = 15;    // Gemini works best with up to 3 images
    this.MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit for inline data
  }

  /**
   * Build Gemini conversation context from request history
   * @param {Object} request - MongoDB Request document
   * @param {string} currentPrompt - Current user prompt to add
   * @param {Array} currentTurnImages - Images for CURRENT turn only (not all inputImages)
   * @param {string} requestId - Request ID for logging
   * @returns {Array} Gemini conversation contents array
   */
  async buildGeminiConversation(request, currentPrompt, currentTurnImages = [], requestId) {
    console.log(`🔄 [${requestId}] Building Gemini conversation context`, {
      historyEntries: request.conversationHistory?.length || 0,
      currentPromptLength: currentPrompt.length,
      currentTurnImages: currentTurnImages.length
    });

    const contents = [];

    try {
      // Add conversation history with proper role/parts structure
      if (request.conversationHistory && request.conversationHistory.length > 0) {
        console.log(`📚 [${requestId}] Adding ${request.conversationHistory.length} history entries to context`);
        
        for (const historyEntry of request.conversationHistory) {
          const parts = [];
          
          for (const part of historyEntry.parts) {
            if (part.type === 'text') {
              parts.push({ text: part.content });
            } else if (part.type === 'image') {
              try {
                const imageData = await this.loadImageForConversation(part.content, requestId);
                if (imageData) {
                  parts.push({ inlineData: imageData });
                }
              } catch (imageError) {
                console.warn(`⚠️ [${requestId}] Failed to load conversation image ${part.content}:`, imageError.message);
                // Continue without this image rather than failing entire conversation
              }
            }
          }
          
          if (parts.length > 0) {
            contents.push({
              role: historyEntry.role,
              parts: parts
            });
          }
        }
      }

      // Add current user turn
      const currentParts = [{ text: currentPrompt }];
      
      // Add ONLY current turn images (not all inputImages from history)
      console.log(`🖼️ [${requestId}] Adding ${currentTurnImages.length} images to current turn (NOT ${request.inputImages.length} total images)`);
      for (const imageFileId of currentTurnImages) {
        try {
          const imageData = await this.loadImageForConversation(imageFileId, requestId);
          if (imageData) {
            currentParts.push({ inlineData: imageData });
          }
        } catch (imageError) {
          console.warn(`⚠️ [${requestId}] Failed to load current turn image ${imageFileId}:`, imageError.message);
          // Continue without this image
        }
      }
      
      contents.push({
        role: 'user',
        parts: currentParts
      });

      console.log(`✅ [${requestId}] Built conversation with ${contents.length} turns`, {
        totalParts: contents.reduce((sum, turn) => sum + turn.parts.length, 0),
        userTurns: contents.filter(c => c.role === 'user').length,
        modelTurns: contents.filter(c => c.role === 'model').length
      });

      return contents;

    } catch (error) {
      console.error(`❌ [${requestId}] Failed to build conversation context:`, error.message);
      // Fallback to simple prompt + current turn images (old behavior)
      console.log(`🔄 [${requestId}] Falling back to simple conversation structure`);
      
      const imageContents = await this.prepareImagesForGemini(
        currentTurnImages, 
        requestId
      );
      
      return [
        { text: currentPrompt },
        ...imageContents
      ];
    }
  }

  /**
   * Load image from storage for conversation context
   * @param {string} fileId - File ID from our storage system
   * @param {string} requestId - Request ID for logging
   * @returns {Object|null} Image data for Gemini or null if failed
   */
  async loadImageForConversation(fileId, requestId) {
    try {
      // Create download URL for the image
      const downloadUrl = createDownloadUrl(fileId);
      
      console.log(`📥 [${requestId}] Loading conversation image: ${fileId}`);
      
      // Download image data
      const response = await axios.get(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: this.REQUEST_TIMEOUT,
        headers: {
          'Accept': 'image/*'
        }
      });

      // Convert to base64
      const base64Image = Buffer.from(response.data).toString('base64');
      
      // Get MIME type from response headers or guess from file
      const mimeType = response.headers['content-type'] || 'image/jpeg';
      
      return {
        mimeType,
        data: base64Image
      };
      
    } catch (error) {
      console.error(`❌ [${requestId}] Failed to load conversation image ${fileId}:`, error.message);
      return null;
    }
  }

  /**
   * Process images with conversation context using Gemini - ENHANCED
   * @param {Object} request - MongoDB Request document with full context
   * @param {string} textPrompt - Current user's text prompt for processing
   * @param {Array} currentTurnImageIds - File IDs for CURRENT turn only (not all request images)
   * @param {string} requestId - Request ID for tracking
   * @returns {Object} Processing result with generated images and text
   */
  async processImages(request, textPrompt, currentTurnImageIds = [], requestId) {
    const processingStart = Date.now();
    console.log(`🎨 [${requestId}] Starting Gemini image processing with conversation context`, {
      totalImages: request.inputImages.length,
      currentTurnImages: currentTurnImageIds.length,
      textPromptLength: textPrompt.length,
      systemPromptLength: request.systemPrompt.length,
      conversationTurns: request.conversationHistory?.length || 0
    });

    try {
      // Validate inputs - check current turn images
      if (!currentTurnImageIds || currentTurnImageIds.length === 0) {
        // Allow processing without images for text-only iterations
        console.log(`📝 [${requestId}] Processing text-only turn (no current images)`);
      }
      
      if (currentTurnImageIds.length > this.MAX_INPUT_IMAGES) {
        console.warn(`⚠️ [${requestId}] Too many images in current turn (${currentTurnImageIds.length}), using first ${this.MAX_INPUT_IMAGES}`);
        currentTurnImageIds = currentTurnImageIds.slice(0, this.MAX_INPUT_IMAGES);
      }

      // Build conversation context with history - FIXED: pass current turn images only
      const contents = await this.buildGeminiConversation(request, textPrompt, currentTurnImageIds, requestId);
      
      // Configure request with intelligent modality selection
      const isTextToImage = currentTurnImageIds.length === 0;
      const config = {
        ...this.DEFAULT_CONFIG,
        responseModalities: ['IMAGE', 'TEXT'], // Allow both for all scenarios
        systemInstruction: [{
          text: isTextToImage 
            ? (request.systemPrompt || this.getDefaultGenerationPrompt())  // Use generation prompt for text-to-image
            : (request.systemPrompt || this.getDefaultSystemPrompt())     // Use system prompt for image processing
        }]
      };
      
      console.log(`🎨 [${requestId}] Configuration mode:`, {
        processingMode: isTextToImage ? 'text-to-image' : 'image-processing',
        currentTurnImages: currentTurnImageIds.length,
        systemInstructionType: isTextToImage ? 'text-to-image prompt' : 'image processing prompt'
      });

      // Log the request object without blobs for readability
      const requestForLogging = {
        model: this.MODEL_NAME,
        config,
        contents: contents.map(turn => {
          if (turn.role) {
            // New conversation format
            return {
              role: turn.role,
              parts: turn.parts.map(part => {
                if (part.inlineData) {
                  return {
              inlineData: {
                      mimeType: part.inlineData.mimeType,
                      data: `[BLOB_DATA_${part.inlineData.data?.length || 'unknown'}_BYTES]`
                    }
                  };
                } else if (part.text) {
                  return { text: part.text };
                }
                return part;
              })
            };
          } else {
            // Fallback format
            if (turn.inlineData) {
              return {
                ...turn,
                inlineData: {
                  mimeType: turn.inlineData.mimeType,
                  data: `[BLOB_DATA_${turn.inlineData.data?.length || 'unknown'}_BYTES]`
                }
              };
            }
            return turn;
          }
        })
      };
      
      console.log(`📤 [${requestId}] Full conversation request:`, JSON.stringify(requestForLogging, null, 2));

      console.log(`🚀 [${requestId}] Sending conversational request to Gemini`, {
        model: this.MODEL_NAME,
        conversationTurns: contents.length,
        totalParts: contents.reduce((sum, turn) => sum + (turn.parts?.length || 1), 0),
        hasSystemInstruction: !!config.systemInstruction[0].text
      });

      // Make request to Gemini
      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        config,
        contents
      });

      // Process response (enhanced for multiple outputs)
      const result = await this.processGeminiResponse(response, requestId);
      
      // UPDATE CONVERSATION HISTORY: Add current user turn and model response
      try {
        console.log(`📝 [${requestId}] Updating conversation history with current exchange`);
        
        // Add user turn (current prompt + CURRENT TURN images only)
        await request.addUserTurnToHistory(
          textPrompt,
          currentTurnImageIds // Use current turn images, not all inputImages
        );
        
        // Add model turn (text response + generated images)
        const generatedImageFileIds = result.generatedImages.map(img => img.fileId);
        await request.addModelTurnToHistory(
          result.textResponse || '',
          generatedImageFileIds
        );
        
        console.log(`✅ [${requestId}] Conversation history updated`, {
          totalHistoryEntries: request.conversationHistory.length + 2 // +2 for the turns we just added
        });
        
      } catch (historyError) {
        console.warn(`⚠️ [${requestId}] Failed to update conversation history (non-blocking):`, historyError.message);
        // Don't fail the entire processing for history update errors
      }
      
      const processingTime = Date.now() - processingStart;
      console.log(`✅ [${requestId}] Gemini processing completed with conversation context`, {
        processingTime: `${processingTime}ms`,
        resultType: result.type,
        hasGeneratedImages: result.generatedImages.length > 0,
        textResponseLength: result.textResponse?.length || 0,
        conversationTurns: request.conversationHistory?.length || 0
      });

      return {
        success: true,
        ...result,
        processingTime,
        conversationContext: {
          totalTurns: request.conversationHistory?.length || 0,
          currentIteration: request.currentIteration
        }
      };

    } catch (error) {
      const processingTime = Date.now() - processingStart;
      console.error(`❌ [${requestId}] Gemini processing failed`, {
        error: error.message,
        processingTime: `${processingTime}ms`
      });

      return {
        success: false,
        error: error.message,
        errorCode: this.categorizeError(error),
        processingTime
      };
    }
  }

  /**
   * Generate images from text prompt only (text-to-image)
   * @param {string} textPrompt - Text description for image generation
   * @param {string} systemPrompt - System instruction for generation style
   * @param {string} requestId - Request ID for tracking
   * @returns {Object} Generation result with images and text
   */
  async generateImages(textPrompt, systemPrompt, requestId) {
    const processingStart = Date.now();
    console.log(`🎨 [${requestId}] Starting Gemini image generation`, {
      textPromptLength: textPrompt.length,
      systemPromptLength: systemPrompt.length
    });

    try {
      // Configure request for image generation
      const config = {
        ...this.DEFAULT_CONFIG,
        systemInstruction: [{
          text: systemPrompt || this.getDefaultGenerationPrompt()
        }]
      };

      console.log(`🚀 [${requestId}] Sending generation request to Gemini`);

      // Make generation request
      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        config,
        contents: [{ text: textPrompt }]
      });

      // Process response
      const result = await this.processGeminiResponse(response, requestId);
      
      const processingTime = Date.now() - processingStart;
      console.log(`✅ [${requestId}] Gemini generation completed`, {
        processingTime: `${processingTime}ms`,
        generatedImageCount: result.generatedImages.length
      });

      return {
        success: true,
        ...result,
        processingTime
      };

    } catch (error) {
      const processingTime = Date.now() - processingStart;
      console.error(`❌ [${requestId}] Gemini generation failed`, {
        error: error.message,
        processingTime: `${processingTime}ms`
      });

      return {
        success: false,
        error: error.message,
        errorCode: this.categorizeError(error),
        processingTime
      };
    }
  }

  /**
   * Prepare images from our file storage for Gemini processing
   */
  async prepareImagesForGemini(fileIds, requestId) {
    const imageContents = [];
    
    for (let i = 0; i < fileIds.length; i++) {
      const fileId = fileIds[i];
      console.log(`📥 [${requestId}] Preparing image ${i + 1}/${fileIds.length}: ${fileId}`);
      
      try {
        // Get download URL from our file storage
        const downloadUrl = createDownloadUrl(fileId);
        
        // Download image from our storage
        const imageResponse = await axios({
          method: 'get',
          url: downloadUrl,
          responseType: 'arraybuffer',
          timeout: 30000
        });

        if (imageResponse.status !== 200) {
          throw new Error(`Failed to download image: HTTP ${imageResponse.status}`);
        }

        // Convert to base64 for Gemini
        const base64Image = Buffer.from(imageResponse.data).toString('base64');
        
        // 🎉 SERVER FIXED: Now we get correct MIME types directly
        const mimeType = imageResponse.headers['content-type'] || 'image/jpeg';
        
        console.log(`✅ [${requestId}] Correct MIME type from server for ${fileId}:`, {
          mimeType: mimeType,
          fileSize: `${Math.round(imageResponse.data.length / 1024)}KB`
        });

        // Check file size limit for inline data
        if (imageResponse.data.length > this.MAX_FILE_SIZE) {
          console.warn(`⚠️ [${requestId}] Image ${fileId} exceeds size limit, may cause issues`);
        }

        imageContents.push({
          inlineData: {
            mimeType: mimeType,
            data: base64Image
          }
        });

        console.log(`✅ [${requestId}] Image prepared: ${fileId}`, {
          mimeType,
          sizeKB: Math.round(imageResponse.data.length / 1024)
        });

      } catch (error) {
        console.error(`❌ [${requestId}] Failed to prepare image ${fileId}:`, error.message);
        // Continue with other images instead of failing completely
      }
    }

    // Allow text-only processing for text-to-image scenarios
    console.log(`🔍 [${requestId}] Image preparation result:`, {
      imageContentsLength: imageContents.length,
      processingMode: imageContents.length === 0 ? 'text-only' : 'image-processing'
    });

    return imageContents;
  }

  /**
   * Process Gemini API response and extract images/text - ENHANCED for multiple outputs
   */
  async processGeminiResponse(response, requestId) {
    const result = {
      type: 'unknown',
      textResponse: '',
      generatedImages: [],
      conversationParts: [] // NEW: Track order and type of each part
      // 🧹 REMOVED: rawResponse to prevent blob logging
    };

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No candidates returned from Gemini');
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error('Invalid response structure from Gemini');
    }

    console.log(`📊 [${requestId}] Processing Gemini response with multiple outputs support`, {
      candidateCount: response.candidates.length,
      partCount: candidate.content.parts.length
    });

    let accumulatedText = ''; // Track text for associating with images
    let responseOrder = 0; // Track order of responses for proper sequencing

    // Process each part of the response in order
    for (let i = 0; i < candidate.content.parts.length; i++) {
      const part = candidate.content.parts[i];

      if (part.text) {
        accumulatedText += part.text;
        result.textResponse += part.text;
        result.type = result.type === 'unknown' ? 'text' : 'mixed';
        
        // Track this text part for conversation context
        result.conversationParts.push({
          type: 'text',
          content: part.text,
          order: responseOrder++
        });
        
        console.log(`📝 [${requestId}] Text response received (${part.text.length} chars, order: ${responseOrder - 1})`);
      }

      if (part.inlineData) {
        try {
          const generatedImage = await this.saveGeneratedImageWithMetadata(
            part.inlineData, 
            requestId, 
            i, 
            responseOrder, 
            accumulatedText,
            candidate.content.parts.length > 1
          );
          
          result.generatedImages.push(generatedImage);
          result.type = result.type === 'unknown' ? 'image' : 'mixed';
          
          // Track this image part for conversation context
          result.conversationParts.push({
            type: 'image',
            content: generatedImage.fileId,
            order: responseOrder++
          });
          
          console.log(`🖼️ [${requestId}] Generated image saved with metadata:`, {
            fileId: generatedImage.fileId,
            order: generatedImage.responseOrder,
            hasAssociatedText: !!generatedImage.associatedText
          });
          
          // Clear accumulated text after associating with image
          accumulatedText = '';
          
        } catch (error) {
          console.error(`❌ [${requestId}] Failed to save generated image ${i}:`, error.message);
        }
      }
    }

    console.log(`✅ [${requestId}] Enhanced response processing completed`, {
      type: result.type,
      textLength: result.textResponse.length,
      imageCount: result.generatedImages.length,
      partsCount: result.conversationParts.length,
      isMultipleResponse: result.generatedImages.length > 1 || (result.generatedImages.length > 0 && result.textResponse.length > 0)
    });

    return result;
  }

  /**
   * Save generated image with enhanced metadata for multiple response support
   */
  async saveGeneratedImageWithMetadata(inlineData, requestId, imageIndex, responseOrder, associatedText = '', isMultipleResponse = false) {
    try {
      // Import here to avoid circular dependency
      const { downloadAndStoreMedia } = require('../utils/fileStorageUtils');
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(inlineData.data, 'base64');
      const mimeType = inlineData.mimeType || 'image/png';
      
      // Create a filename with order information
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const randomId = crypto.randomBytes(4).toString('hex');
      const extension = this.getExtensionFromMimeType(mimeType);
      const filename = `${timestamp}_${randomId}_gemini-generated_${timestamp}_${randomId}.${extension}`;

      console.log(`💾 [${requestId}] Saving generated image with metadata`, {
        filename,
        mimeType,
        sizeKB: Math.round(imageBuffer.length / 1024),
        responseOrder,
        hasAssociatedText: !!associatedText,
        isMultipleResponse
      });

      // Create a temporary data URL to use our existing storage system
      const dataUrl = `data:${mimeType};base64,${inlineData.data}`;
      
      // Use our existing storage utility
      const storageResult = await downloadAndStoreMedia(dataUrl, 'image', filename);
      
      if (storageResult.status === 'success') {
        return {
          fileId: storageResult.fileId,
          filename: storageResult.filename,
          downloadUrl: storageResult.downloadUrl,
          externalUrl: createExternalDownloadUrl(storageResult.fileId),
          // NEW: Enhanced metadata for multiple response support
          responseOrder: responseOrder,
          responseType: associatedText ? 'image_with_text' : 'image',
          associatedText: associatedText.trim(),
          isMultipleResponse: isMultipleResponse,
          mimeType: mimeType,
          sizeBytes: imageBuffer.length
        };
      } else {
        throw new Error(`Storage failed: ${storageResult.error}`);
      }
      
    } catch (error) {
      console.error(`❌ [${requestId}] Failed to save generated image with metadata:`, error.message);
      throw error;
    }
  }

  /**
   * Save generated image to our file storage system (legacy method for backward compatibility)
   */
  async saveGeneratedImage(inlineData, requestId, imageIndex) {
    try {
      // Import here to avoid circular dependency
      const { downloadAndStoreMedia } = require('../utils/fileStorageUtils');
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(inlineData.data, 'base64');
      const mimeType = inlineData.mimeType || 'image/png';
      
      // Create a filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const randomId = crypto.randomBytes(4).toString('hex');
      const extension = this.getExtensionFromMimeType(mimeType);
      const filename = `gemini-generated_${timestamp}_${randomId}_${imageIndex}.${extension}`;

      console.log(`💾 [${requestId}] Saving generated image`, {
        filename,
        mimeType,
        sizeKB: Math.round(imageBuffer.length / 1024)
      });

      // Create a temporary data URL to use our existing storage system
      const dataUrl = `data:${mimeType};base64,${inlineData.data}`;

      // 🔧 DIAGNOSTIC: Verify data URL format (no blob logging)
      console.log(`🔍 [${requestId}] Data URL validation:`, {
        isDataUrl: dataUrl.startsWith('data:'),
        mimeType: mimeType,
        imageSizeKB: Math.round(imageBuffer.length / 1024)
      });
      
      // Use our existing storage utility (this will handle the secure upload)
      const storageResult = await downloadAndStoreMedia(dataUrl, 'image', filename);
      
      if (storageResult.status === 'success') {
        return {
          fileId: storageResult.fileId,
          filename: storageResult.filename,
          downloadUrl: storageResult.downloadUrl,
          externalUrl: createExternalDownloadUrl(storageResult.fileId),
          fileSize: storageResult.fileSize,
          mimeType: mimeType
        };
      } else {
        throw new Error(`Storage failed: ${storageResult.errorMessage}`);
      }

    } catch (error) {
      console.error(`❌ [${requestId}] Failed to save generated image:`, error.message);
      throw error;
    }
  }

  /**
   * 🎉 DEPRECATED: MIME detection now handled by server
   * Server admin implemented professional MIME type detection
   * This method kept for reference but no longer needed
   */

  /**
   * Get file extension from MIME type
   */
  getExtensionFromMimeType(mimeType) {
    const mimeMap = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg', 
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/bmp': 'bmp',
      'image/tiff': 'tiff'
    };
    return mimeMap[mimeType.toLowerCase()] || 'png';
  }

  /**
   * Get default system prompt for photo product processing
   */
  getDefaultSystemPrompt() {
    return `You are a professional product photography AI assistant. When given one or multiple images, you MUST create and return a high-resolution, studio-lit product photograph by combining ALL input images into a single professional composition. 

CRITICAL: You MUST generate and return an IMAGE, do not include text descriptions. The response must include visual content.

Use three-point lighting to highlight key features. Combine all products into one cohesive scene with commercial-grade quality suitable for e-commerce or marketing use. Create ultra-realistic images with sharp focus on key details.

IMPORTANT: Always generate an image as the primary output.`;
  }

  /**
   * Get default system prompt for image generation
   */
  getDefaultGenerationPrompt() {
    return `You are a professional image generation AI. You MUST create and return high-quality, detailed images based on the text description provided. 

CRITICAL: Generate an IMAGE as the primary output, do not include text descriptions.

Focus on photorealistic rendering with professional lighting, composition, and attention to detail. The images should be suitable for commercial or professional use.

IMPORTANT: Always return visual content, not text-only responses.`;
  }

  /**
   * Categorize errors for better handling
   */
  categorizeError(error) {
    const message = error.message.toLowerCase();
    
    if (message.includes('api key') || message.includes('authentication')) {
      return 'AUTH_ERROR';
    } else if (message.includes('quota') || message.includes('limit')) {
      return 'QUOTA_ERROR';
    } else if (message.includes('timeout')) {
      return 'TIMEOUT_ERROR';
    } else if (message.includes('rate limit')) {
      return 'RATE_LIMIT_ERROR';
    } else if (message.includes('invalid') || message.includes('malformed')) {
      return 'INVALID_REQUEST_ERROR';
    } else {
      return 'UNKNOWN_ERROR';
    }
  }

  /**
   * Health check for Gemini service
   */
  async healthCheck() {
    try {
      // Simple health check - try to list available models
      const models = await this.ai.models.list();
      return {
        status: 'healthy',
        modelsAvailable: models.length > 0,
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
const googleGeminiService = new GoogleGeminiService();

module.exports = googleGeminiService;
