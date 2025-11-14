/**
 * webGeneratorWorker.js
 * 
 * Description: Background polling worker for long-duration website generation jobs with Redis queue processing
 * 
 * Role in the system: Processes website generation polling queue continuously, handles 5-20 minute job lifecycles with adaptive polling
 * 
 * Node.js Context: Worker - background service for long-running job management with Redis state coordination
 * 
 * Dependencies:
 * - axios (HTTP client for status polling API)
 * - ../database (Redis client for queue and state management)
 * - ./webGeneratorService (service utilities and configuration)
 * - ./ultramsgService, ./whatsappBusinessService (user notifications)
 * - ../models (database persistence and conversation resolution)
 * 
 * Dependants:
 * - Background process or server startup (continuous operation)
 * - Redis queue populated by webGeneratorService
 */

const axios = require('axios');
const { redisClient } = require('../database');
const { REDIS_KEYS, POLLING_STRATEGY, TTL } = require('./webGeneratorService');
const Conversation = require('../models/Conversation');
const { Agent, WebsiteGeneration } = require('../models');
const ultramsgService = require('./ultramsgService');
const { sendWhatsAppBusinessMessage } = require('./whatsappBusinessService');

// ============================================================================
// Worker Configuration & State Management
// ============================================================================

class WebsiteGeneratorWorker {
    constructor() {
        this.isRunning = false;
        this.baseURL = process.env.WEB_GENERATOR_URL || 'https://webs.clapps.io';
        this.apiKey = process.env.WEB_GENERATOR_API_KEY;
        this.workerInstanceId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        console.log('🔄 WebsiteGeneratorWorker initialized:', {
            baseURL: this.baseURL,
            hasApiKey: !!this.apiKey,
            workerId: this.workerInstanceId
        });
    }

    // ============================================================================
    // Main Worker Loop - Continuous Queue Processing
    // ============================================================================

    /**
     * Starts the background worker for continuous job processing
     * Uses blocking Redis operations for efficient queue processing
     */
    async start() {
        if (this.isRunning) {
            console.log('⚠️ Worker already running');
            return;
        }
        
        this.isRunning = true;
        console.log(`🚀 Starting website generation worker: ${this.workerInstanceId}`);
        
        // Recover any active jobs after server restart
        await this.recoverActiveJobs();
        
        // Main processing loop
        while (this.isRunning) {
            try {
                await this.processQueue();
            } catch (error) {
                console.error('❌ Worker error:', error.message);
                // Wait before retrying to prevent tight error loops
                await this.sleep(5000);
            }
        }
        
        console.log('🛑 Website generation worker stopped');
    }

    /**
     * Stops the background worker gracefully
     */
    async stop() {
        console.log(`🛑 Stopping website generation worker: ${this.workerInstanceId}`);
        this.isRunning = false;
    }

    /**
     * Recovers active jobs after server restart by scanning Redis state
     */
    async recoverActiveJobs() {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Find all generating jobs in Redis
            const generatingKeys = await redisClient.keys('website:generating:*');
            console.log(`🔄 Found ${generatingKeys.length} jobs to recover after restart`);
            
            for (const key of generatingKeys) {
                try {
                    const requestId = key.replace('website:generating:', '');
                    const stateData = await redisClient.get(key);
                    
                    if (stateData) {
                        const state = JSON.parse(stateData);
                        
                        // Check if job is still within timeout
                        const elapsed = Date.now() - state.startTime;
                        if (elapsed < POLLING_STRATEGY.timeout) {
                            console.log(`♻️ Recovering job: ${requestId} (elapsed: ${Math.round(elapsed/60000)}min)`);
                            await redisClient.lPush(REDIS_KEYS.pollQueue, requestId);
                        } else {
                            console.log(`⏰ Job timeout during recovery: ${requestId}`);
                            await this.handleJobTimeout(requestId, state);
                        }
                    }
                } catch (jobError) {
                    console.error(`❌ Error recovering job:`, jobError.message);
                }
            }
        } catch (error) {
            console.error('❌ Job recovery failed:', error.message);
        }
    }

    /**
     * Processes the Redis queue with blocking operations for efficiency
     */
    async processQueue() {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Blocking pop with 30-second timeout (prevents tight loops when queue is empty)
            const result = await redisClient.brPop(
                redisClient.commandOptions({ isolated: true }),
                REDIS_KEYS.pollQueue,
                30
            );
            
            if (result) {
                const requestId = result.element;
                console.log(`📋 Processing job from queue: ${requestId}`);
                await this.processWebsiteJob(requestId);
            }
            
        } catch (error) {
            console.error('❌ Queue processing error:', error.message);
            
            // Handle Redis disconnection gracefully
            if (error.message.includes('connection') || error.message.includes('ECONNREFUSED')) {
                console.log('🔄 Redis connection lost, attempting reconnect...');
                await this.sleep(5000);
            }
        }
    }

    // ============================================================================
    // Job Processing Logic - Long-Duration Polling
    // ============================================================================

    /**
     * Processes individual website generation job with locking and polling
     * @param {string} requestId - Request ID to process
     */
    async processWebsiteJob(requestId) {
        // Acquire distributed lock to prevent duplicate processing
        const lockAcquired = await this.acquireJobLock(requestId);
        if (!lockAcquired) {
            console.log(`🔒 Job ${requestId} already being processed by another worker`);
            return;
        }
        
        try {
            await this.pollWebsiteStatus(requestId);
        } catch (error) {
            console.error(`❌ Job processing error for ${requestId}:`, error.message);
            
            // Re-queue job for retry with exponential backoff
            await this.scheduleJobRetry(requestId, error);
        } finally {
            // Always release lock
            await this.releaseJobLock(requestId);
        }
    }

    /**
     * Acquires distributed lock for job processing
     * @param {string} requestId - Request ID to lock
     * @returns {boolean} True if lock acquired
     */
    async acquireJobLock(requestId) {
        try {
            const lockKey = REDIS_KEYS.pollLock(requestId);
            const lockValue = `${this.workerInstanceId}_${Date.now()}`;
            
            // Atomic lock acquisition with TTL
            const acquired = await redisClient.set(lockKey, lockValue, {
                NX: true, // Only set if key doesn't exist
                EX: TTL.pollLock // 2-minute TTL
            });
            
            return !!acquired;
        } catch (error) {
            console.error(`❌ Lock acquisition failed for ${requestId}:`, error.message);
            return false;
        }
    }

    /**
     * Releases distributed lock for job processing
     * @param {string} requestId - Request ID to unlock
     */
    async releaseJobLock(requestId) {
        try {
            const lockKey = REDIS_KEYS.pollLock(requestId);
            await redisClient.del(lockKey);
        } catch (error) {
            console.error(`❌ Lock release failed for ${requestId}:`, error.message);
        }
    }

    /**
     * Polls website status from external API with adaptive timing
     * @param {string} requestId - Request ID to poll
     */
    async pollWebsiteStatus(requestId) {
        try {
            // Get job state from Redis
            const jobState = await this.getJobState(requestId);
            if (!jobState) {
                console.log(`⚠️ Job state not found for ${requestId}, skipping`);
                return;
            }
            
            // Check timeout and attempt limits
            const elapsed = Date.now() - jobState.startTime;
            const currentAttempts = await this.incrementAttempts(requestId);
            
            console.log(`🔍 [${requestId}] Polling status (attempt ${currentAttempts}, elapsed: ${Math.round(elapsed/60000)}min)`);
            
            // Timeout check (20 minutes maximum)
            if (elapsed > POLLING_STRATEGY.timeout) {
                console.log(`⏰ [${requestId}] Job timeout (${Math.round(elapsed/60000)} minutes)`);
                return await this.handleJobTimeout(requestId, jobState);
            }
            
            // Max attempts check
            if (currentAttempts > POLLING_STRATEGY.maxAttempts) {
                console.log(`🔄 [${requestId}] Max attempts exceeded (${currentAttempts})`);
                return await this.handleJobFailure(requestId, jobState, 'Max polling attempts exceeded');
            }
            
            // Poll external API for status
            const statusResult = await this.pollExternalAPI(jobState.externalRequestId);
            
            if (statusResult.status === 'completed') {
                console.log(`✅ [${requestId}] Website generation completed`);
                await this.handleJobSuccess(requestId, jobState, statusResult);
                
            } else if (statusResult.status === 'failed') {
                console.log(`❌ [${requestId}] Website generation failed: ${statusResult.error}`);
                await this.handleJobFailure(requestId, jobState, statusResult.error);
                
            } else {
                // Still processing - schedule next poll with adaptive interval
                const nextInterval = this.getAdaptivePollInterval(jobState.startTime, currentAttempts);
                console.log(`⏳ [${requestId}] Still processing, next poll in ${nextInterval/1000}s`);
                await this.scheduleNextPoll(requestId, nextInterval);
            }
            
        } catch (error) {
            console.error(`❌ [${requestId}] Polling error:`, error.message);
            throw error; // Re-throw for retry handling
        }
    }

    /**
     * Polls the external webs.clapps.io API for job status
     * @param {string} externalRequestId - External API request ID
     * @returns {Promise<Object>} Status result from API
     */
    async pollExternalAPI(externalRequestId) {
        const endpoint = `${this.baseURL}/api/status/${externalRequestId}`;
        const params = { key: this.apiKey };
        
        try {
            const response = await axios.get(endpoint, {
                params,
                timeout: 30000, // 30s timeout for polling
                headers: { 'Accept': 'application/json' }
            });
            
            return response.data;
            
        } catch (error) {
            console.error('❌ External API polling error:', {
                error: error.message,
                response: error.response?.data,
                status: error.response?.status,
                externalRequestId
            });
            
            if (error.response?.status === 404) {
                throw new Error('External request not found (may have expired)');
            } else if (error.response?.status >= 500) {
                throw new Error('External API server error (temporary)');
            } else {
                throw new Error(`External API error: ${error.response?.data?.message || error.message}`);
            }
        }
    }

    // ============================================================================
    // Adaptive Timing & Retry Logic
    // ============================================================================

    /**
     * Calculates adaptive polling interval based on elapsed time
     * @param {number} startTime - Job start timestamp
     * @param {number} attempt - Current attempt number
     * @returns {number} Next polling interval in milliseconds
     */
    getAdaptivePollInterval(startTime, attempt) {
        const elapsed = Date.now() - startTime;
        const minutes = elapsed / 60000;
        
        // Progressive intervals for 5-20 minute processing times
        if (minutes < 2) return POLLING_STRATEGY.initial;     // 30s - early stage
        if (minutes < 10) return POLLING_STRATEGY.standard;   // 45s - normal processing  
        if (minutes < 18) return POLLING_STRATEGY.late;       // 60s - late stage
        return POLLING_STRATEGY.final;                        // 90s - final attempts
    }

    /**
     * Schedules next polling attempt with adaptive interval
     * @param {string} requestId - Request ID to schedule
     * @param {number} delay - Delay in milliseconds
     */
    async scheduleNextPoll(requestId, delay) {
        // Use setTimeout for scheduling instead of immediate re-queue
        setTimeout(async () => {
            try {
                if (this.isRunning) {
                    await redisClient.lPush(REDIS_KEYS.pollQueue, requestId);
                }
            } catch (error) {
                console.error(`❌ Failed to schedule next poll for ${requestId}:`, error.message);
            }
        }, delay);
    }

    /**
     * Schedules job retry with exponential backoff on error
     * @param {string} requestId - Request ID to retry
     * @param {Error} error - Error that triggered retry
     */
    async scheduleJobRetry(requestId, error) {
        try {
            const attempts = await this.getAttemptCount(requestId);
            const delay = Math.min(30000 * Math.pow(2, attempts), 300000); // Max 5 minutes
            
            console.log(`🔄 [${requestId}] Scheduling retry in ${delay/1000}s due to: ${error.message}`);
            
            setTimeout(async () => {
                if (this.isRunning) {
                    await redisClient.lPush(REDIS_KEYS.pollQueue, requestId);
                }
            }, delay);
            
        } catch (retryError) {
            console.error(`❌ Failed to schedule retry for ${requestId}:`, retryError.message);
        }
    }

    // ============================================================================
    // Job State Management
    // ============================================================================

    /**
     * Gets job state from Redis
     * @param {string} requestId - Request ID
     * @returns {Promise<Object|null>} Job state or null
     */
    async getJobState(requestId) {
        try {
            const stateData = await redisClient.get(REDIS_KEYS.generating(requestId));
            return stateData ? JSON.parse(stateData) : null;
        } catch (error) {
            console.error(`❌ Failed to get job state for ${requestId}:`, error.message);
            return null;
        }
    }

    /**
     * Increments and returns attempt count for request
     * @param {string} requestId - Request ID
     * @returns {Promise<number>} Current attempt count
     */
    async incrementAttempts(requestId) {
        try {
            const attemptKey = REDIS_KEYS.attempts(requestId);
            const count = await redisClient.incr(attemptKey);
            await redisClient.expire(attemptKey, TTL.attempts);
            return count;
        } catch (error) {
            console.error(`❌ Failed to increment attempts for ${requestId}:`, error.message);
            return 1; // Fallback to first attempt
        }
    }

    /**
     * Gets current attempt count for request
     * @param {string} requestId - Request ID
     * @returns {Promise<number>} Current attempt count
     */
    async getAttemptCount(requestId) {
        try {
            const count = await redisClient.get(REDIS_KEYS.attempts(requestId));
            return parseInt(count) || 0;
        } catch (error) {
            console.error(`❌ Failed to get attempt count for ${requestId}:`, error.message);
            return 0;
        }
    }

    // ============================================================================
    // Job Completion Handlers
    // ============================================================================

    /**
     * Handles successful website generation completion
     * @param {string} requestId - Request ID
     * @param {Object} jobState - Current job state
     * @param {Object} result - Success result from API
     */
    async handleJobSuccess(requestId, jobState, result) {
        try {
            // Store completion result
            const completionData = {
                success: true,
                url: result.url,
                projectId: jobState.projectId,
                completedAt: Date.now(),
                processingTime: Date.now() - jobState.startTime,
                templateStyle: result.templateStyle || jobState.templateStyle,
                finalEcho: result.final_echo
            };
            
            await redisClient.setEx(
                REDIS_KEYS.completed(requestId),
                TTL.completed,
                JSON.stringify(completionData)
            );
            
            // Send success notification to user
            await this.sendSuccessNotification(jobState.conversationId, result.url, completionData);
            
            // Update database if using persistence
            await this.updateDatabaseRecord(requestId, 'completed', completionData);
            
            // Cleanup job state
            await this.cleanupJobState(requestId);
            
            console.log(`🎉 [${requestId}] Job completed successfully:`, {
                url: result.url,
                processingTime: `${Math.round(completionData.processingTime/60000)}min`
            });
            
        } catch (error) {
            console.error(`❌ [${requestId}] Success handling error:`, error.message);
        }
    }

    /**
     * Handles website generation failure
     * @param {string} requestId - Request ID
     * @param {Object} jobState - Current job state
     * @param {string} errorMessage - Error description
     */
    async handleJobFailure(requestId, jobState, errorMessage) {
        try {
            const failureData = {
                success: false,
                error: errorMessage,
                failedAt: Date.now(),
                processingTime: Date.now() - jobState.startTime
            };
            
            await redisClient.setEx(
                REDIS_KEYS.completed(requestId),
                TTL.completed,
                JSON.stringify(failureData)
            );
            
            // Send failure notification to user
            const isUpdate = jobState.jobType === 'update' || jobState.updateType;
            await this.sendFailureNotification(jobState.conversationId, errorMessage, isUpdate);
            
            // Update database if using persistence
            await this.updateDatabaseRecord(requestId, 'failed', failureData);
            
            // Cleanup job state
            await this.cleanupJobState(requestId);
            
            console.log(`💥 [${requestId}] Job failed:`, errorMessage);
            
        } catch (error) {
            console.error(`❌ [${requestId}] Failure handling error:`, error.message);
        }
    }

    /**
     * Handles job timeout (20 minutes exceeded)
     * @param {string} requestId - Request ID
     * @param {Object} jobState - Current job state
     */
    async handleJobTimeout(requestId, jobState) {
        const isUpdate = jobState.jobType === 'update' || jobState.updateType;
        const timeoutMessage = isUpdate 
            ? 'Website update timeout: Process exceeded 20 minutes'
            : 'Website generation timeout: Process exceeded 20 minutes';
            
        await this.handleJobFailure(requestId, jobState, timeoutMessage);
    }

    // ============================================================================
    // User Notifications - Dual Service Support
    // ============================================================================

    /**
     * Sends success notification to user via appropriate messaging service
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} websiteUrl - Final website URL
     * @param {Object} completionData - Additional completion data
     */
    async sendSuccessNotification(conversationId, websiteUrl, completionData) {
        try {
            // Different messages for generate vs update
            const isUpdate = completionData.jobType === 'update' || completionData.updateType;
            const message = isUpdate 
                ? `🎉 ¡Tu sitio web ha sido actualizado! Revisa los cambios: ${websiteUrl}`
                : `🎉 ¡Tu web ha sido terminada! Échale un vistazo: ${websiteUrl}`;
                
            await this.sendNotificationMessage(conversationId, message);
            
            console.log(`📱 ${isUpdate ? 'Update' : 'Generation'} success notification sent for conversation: ${conversationId}`);
            
        } catch (error) {
            console.error(`❌ Failed to send success notification:`, error.message);
        }
    }

    /**
     * Sends failure notification to user
     * @param {string} conversationId - MongoDB conversation ID  
     * @param {string} errorMessage - Error description
     * @param {boolean} isUpdate - Whether this was an update job
     */
    async sendFailureNotification(conversationId, errorMessage, isUpdate = false) {
        try {
            const message = isUpdate
                ? `😔 Hubo un problema actualizando tu sitio web: ${errorMessage}. Por favor intenta nuevamente.`
                : `😔 Hubo un problema generando tu sitio web: ${errorMessage}. Por favor intenta nuevamente.`;
                
            await this.sendNotificationMessage(conversationId, message);
            
            console.log(`📱 ${isUpdate ? 'Update' : 'Generation'} failure notification sent for conversation: ${conversationId}`);
            
        } catch (error) {
            console.error(`❌ Failed to send failure notification:`, error.message);
        }
    }

    /**
     * Sends notification message via appropriate service (UltraMsg or WhatsApp Business)
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} message - Message to send
     */
    async sendNotificationMessage(conversationId, message) {
        try {
            // Get conversation and agent data
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            const agent = await Agent.findById(conversation.agentId);
            if (!agent) {
                throw new Error(`Agent not found: ${conversation.agentId}`);
            }
            
            // Validate messaging credentials
            if (!agent.instanceId || !agent.token) {
                throw new Error('Agent missing messaging credentials');
            }
            
            // Send via appropriate service based on agent type
            if (agent.type === 'wpp-bsp') {
                const result = await sendWhatsAppBusinessMessage(agent, conversation.phoneNumber, message);
                if (!result.success) {
                    throw new Error(`WhatsApp Factory send failed: ${result.error}`);
                }
            } else {
                const result = await ultramsgService.sendUltraMsg(agent, conversation.phoneNumber, message);
                if (result.sent !== 'true') {
                    throw new Error(`UltraMsg send failed: ${result.message}`);
                }
            }
            
        } catch (error) {
            console.error(`❌ Notification send error:`, error.message);
            throw error;
        }
    }

    // ============================================================================
    // Database Persistence & Cleanup
    // ============================================================================

    /**
     * Updates database record if using persistence
     * @param {string} requestId - Request ID
     * @param {string} status - New status
     * @param {Object} data - Additional data
     */
    async updateDatabaseRecord(requestId, status, data) {
        try {
            if (WebsiteGeneration) {
                const record = await WebsiteGeneration.findOne({ where: { requestId } });
                if (record) {
                    if (status === 'completed') {
                        await record.markCompleted(data.url, data);
                    } else if (status === 'failed') {
                        await record.markFailed(data.error);
                    }
                }
            }
        } catch (error) {
            console.error(`❌ Database update error:`, error.message);
            // Non-blocking database error
        }
    }

    /**
     * Cleans up Redis state for completed job
     * @param {string} requestId - Request ID to clean up
     */
    async cleanupJobState(requestId) {
        try {
            await redisClient.del(REDIS_KEYS.generating(requestId));
            await redisClient.del(REDIS_KEYS.attempts(requestId));
            // Keep completed records for audit
        } catch (error) {
            console.error(`❌ Cleanup error:`, error.message);
        }
    }

    /**
     * Utility sleep function for delays
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ============================================================================
// Module Exports & Singleton
// ============================================================================

const websiteGeneratorWorker = new WebsiteGeneratorWorker();

module.exports = {
    WebsiteGeneratorWorker,
    websiteGeneratorWorker
};
