/**
 * vertexVideoService.js
 * 
 * Description: Google Vertex AI Video generation service integration for professional video creation from text and images
 * 
 * Role in the system: Provides video generation capabilities using Vertex AI Veo 3.0, handles text-to-video and image-to-video workflows
 * 
 * Node.js Context: Service - External API integration for video generation and processing
 * 
 * Dependencies:
 * - axios (HTTP client for API requests)
 * - File storage system integration
 * - Video API at video.api-ai-mvp.com
 * 
 * Dependants:
 * - modules/openaiIntegration.js (videoGenerator tool execution)
 * - services/ultramsgService.js (video delivery integration)
 * - File storage system for generated video hosting
 */

const axios = require('axios');

class VertexVideoService {
  constructor() {
    // Smart environment detection: Docker vs Local
    this.IS_DOCKER_ENV = process.env.NODE_ENV === 'docker' || 
                          process.env.DOCKER_ENV === 'true' || 
                          process.env.CONTAINER_ENV === 'true' ||
                          !!process.env.VIDEO_API_USE_INTERNAL;
                          
    // Choose URL based on environment
    this.VIDEO_API_URL = this.IS_DOCKER_ENV 
      ? (process.env.VIDEO_API_INTERNAL_URL || 'http://vertex_ai_api:5002')
      : (process.env.VIDEO_API_EXTERNAL_URL || 'https://video.api-ai-mvp.com');
      
    // Backup URL for failover
    this.VIDEO_API_FALLBACK_URL = process.env.VIDEO_API_EXTERNAL_URL || 'https://video.api-ai-mvp.com';
    
    this.VIDEO_API_KEY = process.env.VIDEO_API_KEY || process.env.API_KEY_WEBHOOK;
    this.FILE_STORAGE_EXTERNAL_URL = process.env.FILE_STORAGE_EXTERNAL_URL || 'https://files.api-ai-mvp.com';
    
    // Default configuration
    this.DEFAULT_MODEL = 'veo-3.0-generate-preview'; // As requested - always Veo 3
    this.DEFAULT_MODE = 'sync'; // As requested - always sync
    this.TIMEOUT_SYNC = 120000; // 2 minutes timeout for sync requests
    this.MAX_RETRIES = 2;
  }

  /**
   * Generate video using Vertex AI Veo 3.0 (Image-to-Video only)
   * @param {Object} options Video generation options
   * @param {string} options.prompt Video description and instructions
   * @param {string} options.imageFileId Required image file ID from storage (32-char hex)
   * @param {string} options.mode Processing mode ('sync' or 'async') - defaults to sync
   * @param {string} options.model AI model to use - defaults to veo-3.0-generate-preview  
   * @returns {Promise<Object>} Video generation result with downloadUrl and metadata
   */
  async generateVideo(options) {
    console.log('🎬 Starting Vertex AI video generation:', {
      prompt: options.prompt?.substring(0, 100) + (options.prompt?.length > 100 ? '...' : ''),
      hasImage: !!options.imageFileId,
      imageFileId: options.imageFileId || 'none',
      mode: options.mode || this.DEFAULT_MODE,
      model: options.model || this.DEFAULT_MODEL
    });

    try {
      // Build imageUrl from fileId (REQUIRED for image-to-video)
      if (!options.imageFileId || !options.imageFileId.trim()) {
        throw new Error('imageFileId is required for video generation');
      }
      
      const imageUrl = `${this.FILE_STORAGE_EXTERNAL_URL}/file/${options.imageFileId}`;
      console.log('🖼️ Using image for video generation (REQUIRED):', {
        fileId: options.imageFileId,
        imageUrl: imageUrl
      });

      // Prepare request payload
      const requestPayload = {
        prompt: options.prompt,
        mode: options.mode || this.DEFAULT_MODE,
        model: options.model || this.DEFAULT_MODEL,
        version: 3  // Required by video API - always use Veo 3 as requested
      };

      // Add imageUrl (REQUIRED for this tool)
      requestPayload.imageUrl = imageUrl;

      console.log('📤 Sending video generation request to Vertex AI:', {
        endpoint: this.VIDEO_API_URL,
        environment: this.IS_DOCKER_ENV ? 'DOCKER' : 'LOCAL',
        prompt: requestPayload.prompt?.substring(0, 100) + '...',
        hasImage: !!requestPayload.imageUrl,
        mode: requestPayload.mode,
        model: requestPayload.model,
        version: requestPayload.version
      });

      // Make API call to Vertex AI Video service
      const startTime = Date.now();
      let response;
      
      try {
        console.log(`🔗 Connecting to video API: ${this.VIDEO_API_URL}`);
        
        const headers = {
          'Content-Type': 'application/json'
        };
        
        // Add API key for external requests (local environment)
        if (!this.IS_DOCKER_ENV && this.VIDEO_API_KEY) {
          headers['X-API-Key'] = this.VIDEO_API_KEY;
          console.log('🔐 Using API key for external video API request');
        }
        
        response = await axios.post(`${this.VIDEO_API_URL}/generate-video`, requestPayload, {
          headers: headers,
          timeout: this.TIMEOUT_SYNC,
          validateStatus: (status) => status < 500 // Accept 4xx errors for proper handling
        });
        
      } catch (connectionError) {
        // Fallback to external URL if internal Docker connection fails
        if (this.IS_DOCKER_ENV && connectionError.code === 'ENOTFOUND') {
          console.warn(`⚠️ Docker internal connection failed, attempting external URL fallback...`);
          
          const fallbackHeaders = {
            'Content-Type': 'application/json'
          };
          
          if (this.VIDEO_API_KEY) {
            fallbackHeaders['X-API-Key'] = this.VIDEO_API_KEY;
          }
          
          response = await axios.post(`${this.VIDEO_API_FALLBACK_URL}/generate-video`, requestPayload, {
            headers: fallbackHeaders,
            timeout: this.TIMEOUT_SYNC,
            validateStatus: (status) => status < 500
          });
          
          console.log(`✅ Fallback to external URL successful: ${this.VIDEO_API_FALLBACK_URL}`);
        } else {
          throw connectionError;
        }
      }

      const processingTime = Date.now() - startTime;
      
      if (response.status !== 200) {
        console.error('❌ Video API returned error response:', {
          status: response.status,
          data: response.data,
          headers: response.headers
        });
        
        const errorMessage = response.data?.error || response.data?.message || response.data || 'Unknown error';
        throw new Error(`Vertex AI API error: ${response.status} - ${errorMessage}`);
      }

      const result = response.data;
      
      // Check for API error response (new structure)
      if (result.error || (result.status && result.status !== 'completed')) {
        throw new Error(`Video generation failed: ${result.error || result.message || 'Unknown error'}`);
      }

      console.log('✅ Video generation completed successfully:', {
        executionTime: result.details?.processingTime || `${(processingTime / 1000).toFixed(1)}s`,
        model: result.details?.model || requestPayload.model,
        hasVideoUrl: !!result.videoUrl,
        hasFileId: !!result.fileId,
        status: result.status
      });

      return {
        success: true,
        videoUrl: result.videoUrl,
        downloadUrl: result.videoUrl, // videoUrl already includes the key
        fileId: result.fileId,
        model: result.details?.model || requestPayload.model,
        executionTime: result.details?.processingTime || `${(processingTime / 1000).toFixed(1)}s`,
        prompt: options.prompt,
        imageUsed: !!options.imageFileId,
        processingMode: requestPayload.mode,
        jobId: result.jobId,
        aspectRatio: result.details?.aspectRatio,
        duration: result.details?.duration
      };

    } catch (error) {
      console.error('❌ Vertex AI video generation error:', {
        error: error.message,
        prompt: options.prompt?.substring(0, 100),
        imageFileId: options.imageFileId,
        isTimeout: error.code === 'ECONNABORTED',
        statusCode: error.response?.status,
        apiResponse: error.response?.data
      });

      // Enhance error information for better user feedback
      let errorMessage = error.message;
      let errorCode = 'UNKNOWN_ERROR';

      if (error.response) {
        const status = error.response.status;
        const apiError = error.response.data;
        
        switch (status) {
          case 400:
            errorCode = 'INVALID_REQUEST';
            errorMessage = `Invalid request: ${apiError?.message || 'Check prompt and image format'}`;
            break;
          case 401:
            errorCode = 'AUTHENTICATION_ERROR';
            errorMessage = 'Authentication failed - API key issue';
            break;
          case 413:
            errorCode = 'FILE_TOO_LARGE';
            errorMessage = 'Image file too large (max 25MB)';
            break;
          case 429:
            errorCode = 'RATE_LIMITED';
            errorMessage = 'Too many requests - please wait before trying again';
            break;
          case 503:
            errorCode = 'SERVICE_UNAVAILABLE';
            errorMessage = 'Video service temporarily unavailable';
            break;
          default:
            errorCode = 'API_ERROR';
            errorMessage = `API error (${status}): ${apiError?.message || 'Unknown error'}`;
        }
      } else if (error.code === 'ECONNABORTED') {
        errorCode = 'TIMEOUT';
        errorMessage = 'Video generation timeout (>2 minutes) - try again with simpler prompt';
      } else if (error.code === 'ECONNREFUSED') {
        errorCode = 'CONNECTION_ERROR';
        errorMessage = 'Cannot connect to video service';
      }

      return {
        success: false,
        error: errorMessage,
        errorCode: errorCode,
        originalError: error.message,
        prompt: options.prompt,
        imageFileId: options.imageFileId
      };
    }
  }

  /**
   * Generate video with retry logic for improved reliability
   * @param {Object} options Same as generateVideo
   * @returns {Promise<Object>} Video generation result with retry information
   */
  async generateVideoWithRetry(options) {
    console.log(`🔄 Starting video generation with retry logic (max ${this.MAX_RETRIES + 1} attempts)`);
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`🎬 Video generation attempt ${attempt}/${this.MAX_RETRIES + 1}`);
        
        const result = await this.generateVideo(options);
        
        if (result.success) {
          console.log(`✅ Video generation successful on attempt ${attempt}`);
          return {
            ...result,
            attemptNumber: attempt,
            retriesUsed: attempt - 1
          };
        } else {
          // API returned error response
          lastError = new Error(result.error);
          lastError.code = result.errorCode;
          
          // Don't retry on certain errors
          if (['INVALID_REQUEST', 'AUTHENTICATION_ERROR', 'FILE_TOO_LARGE'].includes(result.errorCode)) {
            console.log(`❌ Non-retryable error: ${result.errorCode}`);
            return result;
          }
        }
      } catch (error) {
        lastError = error;
        
        // Don't retry on non-retryable errors
        if (error.response?.status === 400 || error.response?.status === 401) {
          console.log(`❌ Non-retryable HTTP error: ${error.response.status}`);
          throw error;
        }
      }
      
      // Wait before next attempt (exponential backoff)
      if (attempt < this.MAX_RETRIES + 1) {
        const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s...
        console.log(`⏳ Waiting ${delay}ms before retry attempt ${attempt + 1}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // All attempts failed
    console.error(`❌ All ${this.MAX_RETRIES + 1} video generation attempts failed`);
    throw lastError || new Error('Video generation failed after all retry attempts');
  }

  /**
   * Health check for Video API service
   * @returns {Promise<Object>} Service health status
   */
  async healthCheck() {
    try {
      const headers = {};
      
      // Add API key for external requests
      if (!this.IS_DOCKER_ENV && this.VIDEO_API_KEY) {
        headers['X-API-Key'] = this.VIDEO_API_KEY;
      }
      
      const response = await axios.get(`${this.VIDEO_API_URL}/health`, {
        headers: headers,
        timeout: 5000
      });
      
      return {
        healthy: true,
        status: response.data,
        responseTime: response.headers['x-response-time'] || 'unknown'
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        lastChecked: new Date()
      };
    }
  }

  /**
   * Validate video generation options before processing
   * @param {Object} options Video generation options
   * @returns {Object} Validation result with any errors
   */
  validateOptions(options) {
    const errors = [];
    
    if (!options.prompt || typeof options.prompt !== 'string') {
      errors.push('Prompt is required and must be a string');
    } else if (options.prompt.length < 10) {
      errors.push('Prompt must be at least 10 characters long');
    } else if (options.prompt.length > 500) {
      errors.push('Prompt must be 500 characters or less');
    }
    
    if (!options.imageFileId || typeof options.imageFileId !== 'string') {
      errors.push('Image file ID is required for video generation');
    } else if (!/^[a-f0-9]{32}$/.test(options.imageFileId)) {
      errors.push('Image file ID must be 32 character hexadecimal string');
    }
    
    if (options.mode && !['sync', 'async'].includes(options.mode)) {
      errors.push('Mode must be "sync" or "async"');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }
}

module.exports = {
  VertexVideoService,
  // Export singleton instance
  vertexVideoService: new VertexVideoService()
};
