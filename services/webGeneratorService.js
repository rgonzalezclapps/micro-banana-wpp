/**
 * webGeneratorService.js
 * 
 * Description: Website generation service with Redis-based long-duration job management for webs.clapps.io API integration
 * 
 * Role in the system: Manages website generation requests, polling, and notifications with Redis state tracking for 5-20 minute workflows
 * 
 * Node.js Context: Service - external API integration with Redis job queue for long-running processes
 * 
 * Dependencies:
 * - axios (HTTP client for webs.clapps.io API)
 * - ../database (Redis client for state management)
 * - ../models/Conversation (conversation resolution)
 * - ../services/ultramsgService, whatsappBusinessService (notifications)
 * 
 * Dependants:
 * - modules/openaiIntegration.js (generateWebsite tool execution)
 * - Background polling worker (continuous job processing)
 */

const axios = require('axios');
const { redisClient } = require('../database');
const Conversation = require('../models/Conversation');
const { Agent } = require('../models');
const ultramsgService = require('./ultramsgService');
const { sendWhatsAppBusinessMessage } = require('./whatsappBusinessService');

// ============================================================================
// Configuration & Constants - Long-duration job management
// ============================================================================

const WEB_GENERATOR_URL = process.env.WEB_GENERATOR_URL || 'https://webs.clapps.io';
const WEB_GENERATOR_API_KEY = process.env.WEB_GENERATOR_API_KEY;

// Long-duration Redis key patterns (25min TTL buffer for 20min max processing)
const REDIS_KEYS = {
    // Generation state tracking (25min TTL)
    generating: (requestId) => `website:generating:${requestId}`,
    
    // Polling job queue (persistent - no TTL)
    pollQueue: 'website:poll:queue',
    
    // Polling locks (2min TTL - prevent concurrent polling)
    pollLock: (requestId) => `website:lock:${requestId}`,
    
    // Completed jobs (6hrs TTL - debugging and audit)
    completed: (requestId) => `website:completed:${requestId}`,
    
    // Attempt counter (25min TTL)
    attempts: (requestId) => `website:attempts:${requestId}`
};

// Adaptive polling intervals for 5-20min processing times
const POLLING_STRATEGY = {
    initial: 30000,      // 30s - first attempts
    standard: 45000,     // 45s - normal processing (2-10min)
    late: 60000,         // 60s - late stage (10-18min)
    final: 90000,        // 90s - final attempts (18-20min)
    timeout: 1200000,    // 20min maximum timeout
    maxAttempts: 40      // Conservative maximum attempts
};

// TTL values for long-duration jobs
const TTL = {
    generating: 1500,    // 25min (20min + 5min buffer)
    pollLock: 120,       // 2min (prevent concurrent polling)
    completed: 21600,    // 6hrs (debugging and audit trail)
    attempts: 1500       // 25min (same as generation)
};

class WebGeneratorService {
    constructor() {
        this.baseURL = WEB_GENERATOR_URL;
        this.apiKey = WEB_GENERATOR_API_KEY;
        
        if (!this.apiKey) {
            console.error('❌ WEB_GENERATOR_API_KEY not configured');
        }
        
        console.log('🌐 WebGeneratorService initialized:', {
            baseURL: this.baseURL,
            hasApiKey: !!this.apiKey
        });
    }

    // ============================================================================
    // Website Generation Initiation - Start long-duration job
    // ============================================================================

    /**
     * Initiates website generation and sets up Redis state tracking for long-duration processing
     * @param {string} prompt - Website description prompt
     * @param {string} conversationId - MongoDB conversation ID for notifications
     * @returns {Promise<Object>} Generation result with tracking URL and job setup
     */
    async initiateGeneration(prompt, conversationId) {
        const requestId = `gen_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🚀 [${requestId}] Initiating website generation for conversation: ${conversationId}`);
        
        try {
            // Step 1: Call external API to start generation
            const apiResponse = await this.callGenerationAPI(prompt);
            console.log(`📡 [${requestId}] API response received:`, {
                status: apiResponse.status,
                projectId: apiResponse.projectId,
                hasUrl: !!apiResponse.url
            });
            
            // Step 2: Set up Redis state tracking for long-duration job
            await this.setupRedisState(requestId, apiResponse, conversationId, 'generate');
            
            // Step 3: Enqueue polling job for background processing
            await this.enqueuePollJob(requestId);
            
            // Step 4: Return immediate response with tracking URL and seed
            const trackingUrl = `${this.baseURL}/${apiResponse.projectId}`;
            
            console.log(`✅ [${requestId}] Generation setup complete:`, {
                trackingUrl,
                projectId: apiResponse.projectId,
                seed: apiResponse.seedUsed,
                conversationId
            });
            
            return {
                success: true,
                requestId: apiResponse.requestId || requestId,
                projectId: apiResponse.projectId,
                seed: apiResponse.seedUsed, // Include seed for future updates
                trackingUrl: trackingUrl,
                statusUrl: apiResponse.statusUrl,
                message: `Tu solicitud está siendo procesada. Puedes ver el progreso en: ${trackingUrl}`,
                estimatedTime: '5-15 minutos'
            };
            
        } catch (error) {
            console.error(`❌ [${requestId}] Generation initiation failed:`, error.message);
            
            // Clean up any partial Redis state
            await this.cleanupJobState(requestId).catch(() => {});
            
            return {
                success: false,
                error: error.message,
                message: 'Error al iniciar la generación del sitio web. Por favor intenta nuevamente.'
            };
        }
    }

    /**
     * Generates a random seed for website generation reproducibility
     * @returns {string} Random seed string for consistent generation
     */
    generateWebsiteSeed() {
        // Generate cryptographically secure random seed (32 chars)
        const seed = require('crypto').randomBytes(16).toString('hex');
        console.log(`🌱 Generated website seed: ${seed}`);
        return seed;
    }

    /**
     * Calls the external webs.clapps.io API to initiate website generation
     * @param {string} prompt - Website description
     * @param {string} seed - Optional seed for reproducibility (auto-generated if not provided)
     * @returns {Promise<Object>} API response with project details and seed used
     */
    async callGenerationAPI(prompt, seed = null) {
        if (!this.apiKey) {
            throw new Error('WEB_GENERATOR_API_KEY not configured');
        }
        
        const endpoint = `${this.baseURL}/api/generate-site`;
        const params = { key: this.apiKey };
        
        // Generate seed if not provided (for new sites)
        const websiteSeed = seed || this.generateWebsiteSeed();
        
        const requestBody = { 
            prompt,
            seed: websiteSeed  // Add seed for reproducible generation
        };
        
        console.log(`📡 Calling website generation API:`, {
            endpoint,
            promptLength: prompt.length,
            hasSeed: !!websiteSeed,
            seed: websiteSeed,
            hasKey: !!this.apiKey
        });
        
        try {
            const response = await axios.post(endpoint, 
                requestBody, 
                { 
                    params,
                    timeout: 30000, // 30s timeout for API call
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            if (!response.data.projectId) {
                throw new Error('Invalid API response: missing projectId');
            }
            
            // Include seed in response for future updates
            response.data.seedUsed = websiteSeed;
            
            return response.data;
            
        } catch (error) {
            console.error('❌ Website generation API error:', {
                error: error.message,
                response: error.response?.data,
                status: error.response?.status
            });
            
            if (error.response?.status === 401) {
                throw new Error('Invalid API key for website generation service');
            } else if (error.response?.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later');
            } else {
                throw new Error(`Website generation API error: ${error.response?.data?.message || error.message}`);
            }
        }
    }

    /**
     * Calls the external webs.clapps.io API to update an existing website
     * @param {string} projectId - Existing project ID (e.g., site-abc123)
     * @param {string} updatePrompt - Update instructions
     * @param {string} seed - Original seed from initial generation
     * @param {number} template - Optional new template ID (1-5)
     * @returns {Promise<Object>} API response with update details
     */
    async callUpdateAPI(projectId, updatePrompt, seed, template = null) {
        if (!this.apiKey) {
            throw new Error('WEB_GENERATOR_API_KEY not configured');
        }
        
        const endpoint = `${this.baseURL}/api/update-site`;
        const params = { key: this.apiKey };
        
        const requestBody = {
            projectId,
            prompt: updatePrompt,
            seed // Use original seed for consistent updates
        };
        
        // Add template parameter - always include since it's required in tool definition
        // Template is required in tool but we want to preserve original if not changing
        if (template && Number.isInteger(template) && template >= 1 && template <= 5) {
            requestBody.template = template;
            console.log(`🎨 Template change requested: ${template}`);
        } else {
            // Template is required in tool definition but we want to keep original
            console.log(`🎨 No template change - will preserve original template`);
        }
        
        console.log(`🔄 Calling website update API:`, {
            endpoint,
            projectId,
            updatePromptLength: updatePrompt.length,
            seed,
            template: template || 'unchanged',
            hasKey: !!this.apiKey
        });
        
        try {
            const response = await axios.post(endpoint, 
                requestBody, 
                { 
                    params,
                    timeout: 30000, // 30s timeout for API call
                    headers: { 'Content-Type': 'application/json' }
                }
            );
            
            if (!response.data.projectId) {
                throw new Error('Invalid update API response: missing projectId');
            }
            
            // Ensure update response includes all necessary data
            response.data.updateType = true; // Mark as update for worker
            response.data.originalProjectId = projectId;
            response.data.seedUsed = seed;
            
            return response.data;
            
        } catch (error) {
            console.error('❌ Website update API error:', {
                error: error.message,
                projectId,
                response: error.response?.data,
                status: error.response?.status
            });
            
            if (error.response?.status === 401) {
                throw new Error('Invalid API key for website update service');
            } else if (error.response?.status === 404) {
                throw new Error('Original website not found - check projectId');
            } else if (error.response?.status === 429) {
                throw new Error('Rate limit exceeded. Please try again later');
            } else {
                throw new Error(`Website update API error: ${error.response?.data?.message || error.message}`);
            }
        }
    }

    /**
     * Initiates website update and sets up Redis state tracking for long-duration processing
     * @param {string} projectId - Existing project ID
     * @param {string} updatePrompt - Update instructions
     * @param {string} seed - Original seed from initial generation
     * @param {string} conversationId - MongoDB conversation ID for notifications
     * @param {number} template - Optional new template ID
     * @returns {Promise<Object>} Update result with tracking URL and job setup
     */
    async initiateUpdate(projectId, updatePrompt, seed, conversationId, template = null) {
        const requestId = `upd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🔄 [${requestId}] Initiating website update for project: ${projectId}, conversation: ${conversationId}`);
        
        try {
            // Step 1: Call external API to start update
            const apiResponse = await this.callUpdateAPI(projectId, updatePrompt, seed, template);
            console.log(`📡 [${requestId}] Update API response received:`, {
                status: apiResponse.status,
                projectId: apiResponse.projectId,
                newRequestId: apiResponse.requestId,
                hasUrl: !!apiResponse.url
            });
            
            // Step 2: Set up Redis state tracking for update job
            await this.setupRedisState(requestId, apiResponse, conversationId, 'update');
            
            // Step 3: Enqueue polling job for background processing  
            await this.enqueuePollJob(requestId);
            
            // Step 4: Return immediate response with same URL (projectId unchanged)
            const trackingUrl = `${this.baseURL}/${apiResponse.projectId}`;
            
            console.log(`✅ [${requestId}] Update setup complete:`, {
                trackingUrl,
                projectId: apiResponse.projectId,
                originalProjectId: projectId,
                updateRequestId: apiResponse.requestId,
                conversationId
            });
            
            return {
                success: true,
                requestId: apiResponse.requestId || requestId,
                projectId: apiResponse.projectId,
                originalProjectId: projectId,
                updateType: true,
                trackingUrl: trackingUrl,
                statusUrl: apiResponse.statusUrl,
                message: `Tu sitio web se está actualizando. Puedes ver el progreso en: ${trackingUrl}`,
                estimatedTime: '5-15 minutos',
                templateChanged: !!template
            };
            
        } catch (error) {
            console.error(`❌ [${requestId}] Website update initiation failed:`, error.message);
            
            // Clean up any partial Redis state
            await this.cleanupJobState(requestId).catch(() => {});
            
            return {
                success: false,
                error: error.message,
                projectId: projectId,
                message: 'Error al iniciar la actualización del sitio web. Por favor intenta nuevamente.'
            };
        }
    }

    /**
     * Sets up Redis state for long-duration job tracking
     * @param {string} requestId - Internal request ID
     * @param {Object} apiResponse - Response from generation/update API
     * @param {string} conversationId - Conversation ID for notifications
     * @param {string} jobType - Job type ('generate' or 'update')
     */
    async setupRedisState(requestId, apiResponse, conversationId, jobType = 'generate') {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            const jobState = {
                projectId: apiResponse.projectId,
                externalRequestId: apiResponse.requestId,
                conversationId: conversationId,
                status: jobType === 'update' ? 'updating' : 'generating',
                jobType: jobType, // 'generate' or 'update'
                startTime: Date.now(),
                url: `${this.baseURL}/${apiResponse.projectId}`,
                statusUrl: apiResponse.statusUrl,
                templateStyle: apiResponse.templateStyle,
                // Update-specific fields
                originalProjectId: apiResponse.originalProjectId || apiResponse.projectId,
                updateType: apiResponse.updateType || false,
                seedUsed: apiResponse.seedUsed
            };
            
            // Store generation state with 25min TTL
            await redisClient.setEx(
                REDIS_KEYS.generating(requestId),
                TTL.generating,
                JSON.stringify(jobState)
            );
            
            // Initialize attempt counter
            await redisClient.setEx(
                REDIS_KEYS.attempts(requestId),
                TTL.attempts,
                '0'
            );
            
            console.log(`📝 [${requestId}] Redis state initialized for ${jobType}:`, {
                projectId: apiResponse.projectId,
                jobType: jobType,
                conversationId,
                ttl: TTL.generating,
                seedUsed: apiResponse.seedUsed
            });
            
        } catch (redisError) {
            console.error(`❌ Redis state setup failed:`, redisError.message);
            // Non-blocking: Continue even if Redis fails
        }
    }

    /**
     * Enqueues polling job for background processing
     * @param {string} requestId - Request ID to poll
     */
    async enqueuePollJob(requestId) {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Add job to persistent polling queue
            await redisClient.lPush(REDIS_KEYS.pollQueue, requestId);
            
            console.log(`🔄 [${requestId}] Polling job enqueued successfully`);
            
        } catch (redisError) {
            console.error(`❌ Failed to enqueue polling job:`, redisError.message);
            // This is more critical - without polling, user won't get notifications
            throw new Error('Failed to schedule background processing');
        }
    }

    // ============================================================================
    // Adaptive Polling Logic - Long-duration optimization
    // ============================================================================

    /**
     * Calculates adaptive polling interval based on elapsed time and attempt count
     * Optimized for 5-20 minute processing times with reduced API calls
     * @param {number} startTime - Job start timestamp
     * @param {number} attempt - Current attempt number
     * @returns {number} Next polling interval in milliseconds
     */
    getAdaptivePollInterval(startTime, attempt) {
        const elapsed = Date.now() - startTime;
        const minutes = elapsed / 60000;
        
        // Adaptive intervals based on expected completion time
        if (minutes < 2) return POLLING_STRATEGY.initial;     // 30s - early stage
        if (minutes < 10) return POLLING_STRATEGY.standard;   // 45s - normal processing  
        if (minutes < 18) return POLLING_STRATEGY.late;       // 60s - late stage
        return POLLING_STRATEGY.final;                        // 90s - final attempts
    }

    /**
     * Checks if job has exceeded maximum timeout (20 minutes)
     * @param {number} startTime - Job start timestamp
     * @returns {boolean} True if timeout exceeded
     */
    isJobTimedOut(startTime) {
        const elapsed = Date.now() - startTime;
        return elapsed > POLLING_STRATEGY.timeout;
    }

    /**
     * Checks if job has exceeded maximum attempts
     * @param {number} attempt - Current attempt number
     * @returns {boolean} True if max attempts exceeded
     */
    hasExceededMaxAttempts(attempt) {
        return attempt >= POLLING_STRATEGY.maxAttempts;
    }

    // ============================================================================
    // State Management & Cleanup
    // ============================================================================

    /**
     * Cleans up Redis state for completed or failed jobs
     * @param {string} requestId - Request ID to clean up
     */
    async cleanupJobState(requestId) {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Remove active state keys (keep completed for audit)
            await redisClient.del(REDIS_KEYS.generating(requestId));
            await redisClient.del(REDIS_KEYS.attempts(requestId));
            await redisClient.del(REDIS_KEYS.pollLock(requestId));
            
            console.log(`🧹 [${requestId}] Job state cleaned up`);
            
        } catch (redisError) {
            console.error(`❌ Failed to cleanup job state:`, redisError.message);
            // Non-blocking cleanup failure
        }
    }

    /**
     * Stores completed job result for audit and debugging
     * @param {string} requestId - Request ID
     * @param {Object} result - Job completion result
     */
    async storeCompletedJob(requestId, result) {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            const completedData = {
                ...result,
                completedAt: Date.now(),
                requestId
            };
            
            await redisClient.setEx(
                REDIS_KEYS.completed(requestId),
                TTL.completed,
                JSON.stringify(completedData)
            );
            
            console.log(`📊 [${requestId}] Completed job stored for audit`);
            
        } catch (redisError) {
            console.error(`❌ Failed to store completed job:`, redisError.message);
            // Non-blocking audit storage failure
        }
    }
}

// ============================================================================
// Module Exports
// ============================================================================

const webGeneratorService = new WebGeneratorService();

module.exports = {
    webGeneratorService,
    REDIS_KEYS,
    POLLING_STRATEGY,
    TTL
};
