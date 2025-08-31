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
const { createDownloadUrl } = require('../utils/fileStorageUtils');

class GoogleGeminiService {
  constructor() {
    // Initialize Google Gemini client
    this.ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY
    });
    
    // Model configuration for image processing
    this.MODEL_NAME = 'gemini-2.5-flash-image-preview';
    this.DEFAULT_CONFIG = {
      responseModalities: ['IMAGE', 'TEXT'],
      systemInstruction: []
    };
    
    // Request timeout and limits
    this.REQUEST_TIMEOUT = 60000; // 60 seconds
    this.MAX_INPUT_IMAGES = 3;    // Gemini works best with up to 3 images
    this.MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB limit for inline data
  }

  /**
   * Process images with text prompt using Gemini
   * @param {Array} imageFileIds - Array of file IDs from our storage system
   * @param {string} textPrompt - User's text prompt for processing
   * @param {string} systemPrompt - System instruction for processing style
   * @param {string} requestId - Request ID for tracking
   * @returns {Object} Processing result with generated images and text
   */
  async processImages(imageFileIds, textPrompt, systemPrompt, requestId) {
    const processingStart = Date.now();
    console.log(`🎨 [${requestId}] Starting Gemini image processing`, {
      imageCount: imageFileIds.length,
      textPromptLength: textPrompt.length,
      systemPromptLength: systemPrompt.length
    });

    try {
      // Validate inputs
      if (!imageFileIds || imageFileIds.length === 0) {
        throw new Error('At least one image is required for processing');
      }
      
      if (imageFileIds.length > this.MAX_INPUT_IMAGES) {
        console.warn(`⚠️ [${requestId}] Too many images provided (${imageFileIds.length}), using first ${this.MAX_INPUT_IMAGES}`);
        imageFileIds = imageFileIds.slice(0, this.MAX_INPUT_IMAGES);
      }

      // Prepare images for Gemini
      const imageContents = await this.prepareImagesForGemini(imageFileIds, requestId);
      
      // Configure request - FORCE image generation
      const config = {
        ...this.DEFAULT_CONFIG,
        systemInstruction: [{
          text: (systemPrompt || this.getDefaultSystemPrompt()) + "\n\nCRITICAL: You MUST generate and return an IMAGE. Do not return text-only responses."
        }]
      };

      // Prepare content array
      const contents = [
        { text: textPrompt },
        ...imageContents
      ];

      console.log(`🚀 [${requestId}] Sending request to Gemini`, {
        model: this.MODEL_NAME,
        contentCount: contents.length,
        hasSystemInstruction: !!config.systemInstruction[0].text
      });

      // Make request to Gemini
      const response = await this.ai.models.generateContent({
        model: this.MODEL_NAME,
        config,
        contents
      });

      // Process response
      const result = await this.processGeminiResponse(response, requestId);
      
      const processingTime = Date.now() - processingStart;
      console.log(`✅ [${requestId}] Gemini processing completed`, {
        processingTime: `${processingTime}ms`,
        resultType: result.type,
        hasGeneratedImages: result.generatedImages.length > 0,
        textResponse: !!result.textResponse
      });

      return {
        success: true,
        ...result,
        processingTime
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

    if (imageContents.length === 0) {
      throw new Error('No images could be prepared for processing');
    }

    return imageContents;
  }

  /**
   * Process Gemini API response and extract images/text
   */
  async processGeminiResponse(response, requestId) {
    const result = {
      type: 'unknown',
      textResponse: '',
      generatedImages: []
      // 🧹 REMOVED: rawResponse to prevent blob logging
    };

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No candidates returned from Gemini');
    }

    const candidate = response.candidates[0];
    if (!candidate.content || !candidate.content.parts) {
      throw new Error('Invalid response structure from Gemini');
    }

    console.log(`📊 [${requestId}] Processing Gemini response`, {
      candidateCount: response.candidates.length,
      partCount: candidate.content.parts.length
    });

    // Process each part of the response
    for (let i = 0; i < candidate.content.parts.length; i++) {
      const part = candidate.content.parts[i];

      if (part.text) {
        result.textResponse += part.text;
        result.type = result.type === 'unknown' ? 'text' : 'mixed';
        console.log(`📝 [${requestId}] Text response received (${part.text.length} chars)`);
      }

      if (part.inlineData) {
        try {
          const generatedImage = await this.saveGeneratedImage(part.inlineData, requestId, i);
          result.generatedImages.push(generatedImage);
          result.type = result.type === 'unknown' ? 'image' : 'mixed';
          console.log(`🖼️ [${requestId}] Generated image saved: ${generatedImage.fileId}`);
        } catch (error) {
          console.error(`❌ [${requestId}] Failed to save generated image ${i}:`, error.message);
        }
      }
    }

    console.log(`✅ [${requestId}] Response processing completed`, {
      type: result.type,
      textLength: result.textResponse.length,
      imageCount: result.generatedImages.length
    });

    return result;
  }

  /**
   * Save generated image to our file storage system
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

CRITICAL: You MUST generate and return an IMAGE, not just text descriptions. The response must include visual content.

Use three-point lighting to highlight key features. Combine all products into one cohesive scene with commercial-grade quality suitable for e-commerce or marketing use. Create ultra-realistic images with sharp focus on key details.

IMPORTANT: Always generate an image as the primary output.`;
  }

  /**
   * Get default system prompt for image generation
   */
  getDefaultGenerationPrompt() {
    return `You are a professional image generation AI. You MUST create and return high-quality, detailed images based on the text description provided. 

CRITICAL: Generate an IMAGE as the primary output, not just text descriptions.

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
