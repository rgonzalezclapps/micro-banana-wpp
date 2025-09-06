/**
 * videoPollingWorker.js
 * 
 * Description: Background polling worker for short-duration video generation jobs with Redis queue processing
 * 
 * Role in the system: Processes video generation polling queue continuously, handles 1-2 minute job lifecycles with frequent polling
 * 
 * Node.js Context: Worker - background service for short-duration video job management with Redis state coordination
 * 
 * Dependencies:
 * - axios (HTTP client for status polling API)
 * - ../database (Redis client for queue and state management)
 * - ./ultramsgService (video message sending via UltraMsg)
 * - ./whatsappBusinessService (video message sending via WhatsApp Factory)
 * - ../models (conversation resolution and agent data)
 * 
 * Dependants:
 * - Background process or server startup (continuous operation)
 * - Redis queue populated by openaiIntegration.js videoGenerator tool
 */

const axios = require('axios');
const { redisClient } = require('../database');
const Conversation = require('../models/Conversation');
const { Agent } = require('../models');
const ultramsgService = require('./ultramsgService');
const { sendWhatsAppBusinessMessage } = require('./whatsappBusinessService');

// ============================================================================
// Video Worker Configuration - Optimized for 1-2 minute jobs
// ============================================================================

// Redis key patterns for video jobs (shorter TTL for faster processing)
const VIDEO_REDIS_KEYS = {
    // Video job state tracking (10min TTL - videos complete in 1-2min typically)
    videoJob: (jobId) => `video:job:${jobId}`,
    
    // Video polling queue (persistent - no TTL)
    pollQueue: 'video:poll:queue',
    
    // Video polling locks (1min TTL - prevent concurrent polling)
    pollLock: (jobId) => `video:lock:${jobId}`,
    
    // Completed video jobs (2hrs TTL - shorter retention for videos)
    completed: (jobId) => `video:completed:${jobId}`,
    
    // Attempt counter (10min TTL)
    attempts: (jobId) => `video:attempts:${jobId}`
};

// Video polling strategy - optimized for 1-2 minute processing
const VIDEO_POLLING_STRATEGY = {
    interval: 10000,         // 10s intervals - much more frequent than websites
    timeout: 300000,         // 5min maximum timeout (vs 20min for websites)
    maxAttempts: 30,         // 30 attempts (5min / 10s = 30)
    initialDelay: 5000       // 5s initial delay before first poll
};

// TTL values for video jobs (shorter durations)
const VIDEO_TTL = {
    videoJob: 600,           // 10min (generous buffer for 1-2min jobs)
    pollLock: 60,            // 1min (prevent concurrent polling)
    completed: 7200,         // 2hrs (audit trail)
    attempts: 600            // 10min (same as job state)
};

// Video API configuration
const VIDEO_API_CONFIG = {
    baseURL: process.env.VIDEO_API_EXTERNAL_URL || 'https://video.api-ai-mvp.com',
    apiKey: process.env.VIDEO_API_KEY || process.env.API_KEY_WEBHOOK,
    timeout: 15000 // 15s timeout for polling requests
};

class VideoPollingWorker {
    constructor() {
        this.isRunning = false;
        this.workerInstanceId = `video_worker_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        console.log('🎬 VideoPollingWorker initialized:', {
            baseURL: VIDEO_API_CONFIG.baseURL,
            hasApiKey: !!VIDEO_API_CONFIG.apiKey,
            workerId: this.workerInstanceId,
            pollInterval: VIDEO_POLLING_STRATEGY.interval,
            timeout: VIDEO_POLLING_STRATEGY.timeout
        });
    }

    // ============================================================================
    // Main Worker Loop - Continuous Video Job Processing
    // ============================================================================

    /**
     * Starts the background worker for continuous video job processing
     */
    async start() {
        if (this.isRunning) {
            console.log('⚠️ Video worker already running');
            return;
        }
        
        this.isRunning = true;
        console.log(`🚀 Starting video polling worker: ${this.workerInstanceId}`);
        
        // Recover any active video jobs after server restart
        await this.recoverActiveVideoJobs();
        
        // Main processing loop
        while (this.isRunning) {
            try {
                await this.processVideoQueue();
            } catch (error) {
                console.error('❌ Video worker error:', error.message);
                // Wait before retrying to prevent tight error loops
                await this.sleep(5000);
            }
        }
        
        console.log('🛑 Video polling worker stopped');
    }

    /**
     * Stops the video background worker gracefully
     */
    async stop() {
        console.log(`🛑 Stopping video polling worker: ${this.workerInstanceId}`);
        this.isRunning = false;
    }

    /**
     * Recovers active video jobs after server restart
     */
    async recoverActiveVideoJobs() {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Find all video jobs in Redis
            const videoJobKeys = await redisClient.keys('video:job:*');
            console.log(`🔄 Found ${videoJobKeys.length} video jobs to recover after restart`);
            
            for (const key of videoJobKeys) {
                try {
                    const jobId = key.replace('video:job:', '');
                    const jobData = await redisClient.get(key);
                    
                    if (jobData) {
                        const job = JSON.parse(jobData);
                        
                        // Check if job is still within timeout (5 minutes)
                        const elapsed = Date.now() - job.startTime;
                        if (elapsed < VIDEO_POLLING_STRATEGY.timeout) {
                            console.log(`♻️ Recovering video job: ${jobId} (elapsed: ${Math.round(elapsed/1000)}s)`);
                            await redisClient.lPush(VIDEO_REDIS_KEYS.pollQueue, jobId);
                        } else {
                            console.log(`⏰ Video job timeout during recovery: ${jobId}`);
                            await this.handleVideoJobTimeout(jobId, job);
                        }
                    }
                } catch (jobError) {
                    console.error(`❌ Error recovering video job:`, jobError.message);
                }
            }
        } catch (error) {
            console.error('❌ Video job recovery failed:', error.message);
        }
    }

    /**
     * Processes the video Redis queue with blocking operations
     */
    async processVideoQueue() {
        try {
            if (!redisClient.isOpen) {
                await redisClient.connect();
            }
            
            // Blocking pop with 15-second timeout (optimized for video jobs)
            const result = await redisClient.brPop(
                redisClient.commandOptions({ isolated: true }),
                VIDEO_REDIS_KEYS.pollQueue,
                15
            );
            
            if (result) {
                const jobId = result.element;
                console.log(`🎬 Processing video job from queue: ${jobId}`);
                await this.processVideoJob(jobId);
            }
            
        } catch (error) {
            console.error('❌ Video queue processing error:', error.message);
            
            // Handle Redis disconnection gracefully
            if (error.message.includes('connection') || error.message.includes('ECONNREFUSED')) {
                console.log('🔄 Redis connection lost, attempting reconnect...');
                await this.sleep(5000);
            }
        }
    }

    // ============================================================================
    // Video Job Processing - Short Duration Optimization
    // ============================================================================

    /**
     * Processes individual video job with locking and polling
     * @param {string} jobId - Video job ID to process
     */
    async processVideoJob(jobId) {
        // Acquire distributed lock to prevent duplicate processing
        const lockAcquired = await this.acquireVideoJobLock(jobId);
        if (!lockAcquired) {
            console.log(`🔒 Video job ${jobId} already being processed by another worker`);
            return;
        }
        
        try {
            await this.pollVideoJobStatus(jobId);
        } catch (error) {
            console.error(`❌ Video job processing error for ${jobId}:`, error.message);
            
            // Re-queue job for retry with delay
            await this.scheduleVideoJobRetry(jobId, error);
        } finally {
            // Always release lock
            await this.releaseVideoJobLock(jobId);
        }
    }

    /**
     * Polls video job status from external API
     * @param {string} jobId - Video job ID to poll
     */
    async pollVideoJobStatus(jobId) {
        try {
            // Get job data from Redis
            const jobData = await this.getVideoJobData(jobId);
            if (!jobData) {
                console.log(`⚠️ Video job data not found for ${jobId}, skipping`);
                return;
            }
            
            // Check timeout and attempt limits
            const elapsed = Date.now() - jobData.startTime;
            const currentAttempts = await this.incrementVideoAttempts(jobId);
            
            console.log(`🔍 [${jobId}] Polling video status (attempt ${currentAttempts}, elapsed: ${Math.round(elapsed/1000)}s)`);
            
            // Timeout check (5 minutes maximum for videos)
            if (elapsed > VIDEO_POLLING_STRATEGY.timeout) {
                console.log(`⏰ [${jobId}] Video job timeout (${Math.round(elapsed/1000)} seconds)`);
                return await this.handleVideoJobTimeout(jobId, jobData);
            }
            
            // Max attempts check
            if (currentAttempts > VIDEO_POLLING_STRATEGY.maxAttempts) {
                console.log(`🔄 [${jobId}] Video max attempts exceeded (${currentAttempts})`);
                return await this.handleVideoJobFailure(jobId, jobData, 'Max polling attempts exceeded');
            }
            
            // Poll video API for status
            const statusResult = await this.pollVideoAPI(jobId);
            
            if (statusResult.status === 'completed') {
                console.log(`✅ [${jobId}] Video generation completed`);
                await this.handleVideoJobSuccess(jobId, jobData, statusResult);
                
            } else if (statusResult.status === 'failed') {
                console.log(`❌ [${jobId}] Video generation failed: ${statusResult.error}`);
                await this.handleVideoJobFailure(jobId, jobData, statusResult.error);
                
            } else if (statusResult.status === 'not_found') {
                console.log(`❓ [${jobId}] Video job not found on API - may have expired`);
                await this.handleVideoJobFailure(jobId, jobData, 'Job not found on video API');
                
            } else {
                // Still processing - schedule next poll
                console.log(`⏳ [${jobId}] Video still processing, next poll in ${VIDEO_POLLING_STRATEGY.interval/1000}s`);
                await this.scheduleNextVideoPoll(jobId);
            }
            
        } catch (error) {
            console.error(`❌ [${jobId}] Video polling error:`, error.message);
            throw error; // Re-throw for retry handling
        }
    }

    /**
     * Polls the external video API for job status
     * @param {string} jobId - Video job ID
     * @returns {Promise<Object>} Status result from video API
     */
    async pollVideoAPI(jobId) {
        const endpoint = `${VIDEO_API_CONFIG.baseURL}/job/${jobId}`;
        
        try {
            const response = await axios.get(endpoint, {
                headers: {
                    'X-API-Key': VIDEO_API_CONFIG.apiKey,
                    'Accept': 'application/json'
                },
                timeout: VIDEO_API_CONFIG.timeout
            });
            
            return response.data;
            
        } catch (error) {
            console.error('❌ Video API polling error:', {
                error: error.message,
                response: error.response?.data,
                status: error.response?.status,
                jobId
            });
            
            if (error.response?.status === 404) {
                return { status: 'not_found', error: 'Video job not found' };
            } else if (error.response?.status >= 500) {
                throw new Error('Video API server error (temporary)');
            } else {
                throw new Error(`Video API error: ${error.response?.data?.message || error.message}`);
            }
        }
    }

    // ============================================================================
    // Video Job State Management
    // ============================================================================

    /**
     * Gets video job data from Redis
     * @param {string} jobId - Video job ID
     * @returns {Promise<Object|null>} Job data or null
     */
    async getVideoJobData(jobId) {
        try {
            const jobData = await redisClient.get(VIDEO_REDIS_KEYS.videoJob(jobId));
            return jobData ? JSON.parse(jobData) : null;
        } catch (error) {
            console.error(`❌ Failed to get video job data for ${jobId}:`, error.message);
            return null;
        }
    }

    /**
     * Increments and returns attempt count for video job
     * @param {string} jobId - Video job ID
     * @returns {Promise<number>} Current attempt count
     */
    async incrementVideoAttempts(jobId) {
        try {
            const attemptKey = VIDEO_REDIS_KEYS.attempts(jobId);
            const count = await redisClient.incr(attemptKey);
            await redisClient.expire(attemptKey, VIDEO_TTL.attempts);
            return count;
        } catch (error) {
            console.error(`❌ Failed to increment video attempts for ${jobId}:`, error.message);
            return 1; // Fallback to first attempt
        }
    }

    /**
     * Acquires distributed lock for video job processing
     * @param {string} jobId - Video job ID to lock
     * @returns {boolean} True if lock acquired
     */
    async acquireVideoJobLock(jobId) {
        try {
            const lockKey = VIDEO_REDIS_KEYS.pollLock(jobId);
            const lockValue = `${this.workerInstanceId}_${Date.now()}`;
            
            // Atomic lock acquisition with TTL
            const acquired = await redisClient.set(lockKey, lockValue, {
                NX: true, // Only set if key doesn't exist
                EX: VIDEO_TTL.pollLock // 1-minute TTL
            });
            
            return !!acquired;
        } catch (error) {
            console.error(`❌ Video lock acquisition failed for ${jobId}:`, error.message);
            return false;
        }
    }

    /**
     * Releases distributed lock for video job processing
     * @param {string} jobId - Video job ID to unlock
     */
    async releaseVideoJobLock(jobId) {
        try {
            const lockKey = VIDEO_REDIS_KEYS.pollLock(jobId);
            await redisClient.del(lockKey);
        } catch (error) {
            console.error(`❌ Video lock release failed for ${jobId}:`, error.message);
        }
    }

    /**
     * Schedules next video poll with fixed interval
     * @param {string} jobId - Video job ID to schedule
     */
    async scheduleNextVideoPoll(jobId) {
        setTimeout(async () => {
            try {
                if (this.isRunning) {
                    await redisClient.lPush(VIDEO_REDIS_KEYS.pollQueue, jobId);
                }
            } catch (error) {
                console.error(`❌ Failed to schedule next video poll for ${jobId}:`, error.message);
            }
        }, VIDEO_POLLING_STRATEGY.interval);
    }

    /**
     * Schedules video job retry with exponential backoff
     * @param {string} jobId - Video job ID to retry
     * @param {Error} error - Error that triggered retry
     */
    async scheduleVideoJobRetry(jobId, error) {
        try {
            const attempts = await this.getVideoAttemptCount(jobId);
            const delay = Math.min(5000 * Math.pow(2, attempts), 60000); // Max 1 minute delay
            
            console.log(`🔄 [${jobId}] Scheduling video retry in ${delay/1000}s due to: ${error.message}`);
            
            setTimeout(async () => {
                if (this.isRunning) {
                    await redisClient.lPush(VIDEO_REDIS_KEYS.pollQueue, jobId);
                }
            }, delay);
            
        } catch (retryError) {
            console.error(`❌ Failed to schedule video retry for ${jobId}:`, retryError.message);
        }
    }

    /**
     * Gets current video attempt count
     * @param {string} jobId - Video job ID
     * @returns {Promise<number>} Current attempt count
     */
    async getVideoAttemptCount(jobId) {
        try {
            const count = await redisClient.get(VIDEO_REDIS_KEYS.attempts(jobId));
            return parseInt(count) || 0;
        } catch (error) {
            console.error(`❌ Failed to get video attempt count for ${jobId}:`, error.message);
            return 0;
        }
    }

    // ============================================================================
    // Video Job Completion Handlers
    // ============================================================================

    /**
     * Handles successful video generation completion
     * @param {string} jobId - Video job ID
     * @param {Object} jobData - Current job data
     * @param {Object} result - Success result from video API
     */
    async handleVideoJobSuccess(jobId, jobData, result) {
        try {
            // Store completion result
            const completionData = {
                success: true,
                videoUrl: result.videoUrl,
                fileId: result.fileId,
                jobId: jobId,
                completedAt: Date.now(),
                processingTime: Date.now() - jobData.startTime,
                timestamp: result.timestamp
            };
            
            await redisClient.setEx(
                VIDEO_REDIS_KEYS.completed(jobId),
                VIDEO_TTL.completed,
                JSON.stringify(completionData)
            );
            
            // Send video completion notification to user
            await this.sendVideoCompletionNotification(jobData.conversationId, result.videoUrl, completionData);
            
            // Cleanup job state
            await this.cleanupVideoJobState(jobId);
            
            console.log(`🎉 [${jobId}] Video job completed successfully:`, {
                videoUrl: result.videoUrl,
                processingTime: `${Math.round(completionData.processingTime/1000)}s`
            });
            
        } catch (error) {
            console.error(`❌ [${jobId}] Video success handling error:`, error.message);
        }
    }

    /**
     * Handles video generation failure
     * @param {string} jobId - Video job ID
     * @param {Object} jobData - Current job data
     * @param {string} errorMessage - Error description
     */
    async handleVideoJobFailure(jobId, jobData, errorMessage) {
        try {
            const failureData = {
                success: false,
                error: errorMessage,
                jobId: jobId,
                failedAt: Date.now(),
                processingTime: Date.now() - jobData.startTime
            };
            
            await redisClient.setEx(
                VIDEO_REDIS_KEYS.completed(jobId),
                VIDEO_TTL.completed,
                JSON.stringify(failureData)
            );
            
            // Send failure notification to user
            await this.sendVideoFailureNotification(jobData.conversationId, errorMessage);
            
            // Cleanup job state
            await this.cleanupVideoJobState(jobId);
            
            console.log(`💥 [${jobId}] Video job failed:`, errorMessage);
            
        } catch (error) {
            console.error(`❌ [${jobId}] Video failure handling error:`, error.message);
        }
    }

    /**
     * Handles video job timeout (5 minutes exceeded)
     * @param {string} jobId - Video job ID
     * @param {Object} jobData - Current job data
     */
    async handleVideoJobTimeout(jobId, jobData) {
        await this.handleVideoJobFailure(jobId, jobData, 'Video generation timeout: Process exceeded 5 minutes');
    }

    // ============================================================================
    // Video Notifications - Dual Service Support with Video Format
    // ============================================================================

    /**
     * Sends video completion notification via appropriate messaging service
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} videoUrl - Final video URL
     * @param {Object} completionData - Additional completion data
     */
    async sendVideoCompletionNotification(conversationId, videoUrl, completionData) {
        try {
            console.log(`🎬 Sending video completion notification for conversation: ${conversationId}`);
            
            // Get conversation and agent data
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            const agent = await Agent.findByPk(conversation.agentId);
            if (!agent) {
                throw new Error(`Agent not found: ${conversation.agentId}`);
            }
            
            // Validate messaging credentials
            if (!agent.instanceId || !agent.token) {
                throw new Error('Agent missing messaging credentials for video notification');
            }
            
            const caption = `🎥 ¡Tu video está listo! Se generó en ${Math.round(completionData.processingTime/1000)} segundos.`;
            
            // Send video via appropriate service based on agent type
            if (agent.type === 'wpp-bsp') {
                // WhatsApp Factory API video sending
                await this.sendWhatsAppVideo(agent, conversation.phoneNumber, videoUrl, caption);
                
            } else {
                // UltraMsg video sending with proper format
                await this.sendUltraMsgVideo(agent, conversation.phoneNumber, videoUrl, caption);
            }
            
            console.log(`📱 Video notification sent successfully for conversation: ${conversationId}`);
            
        } catch (error) {
            console.error(`❌ Failed to send video notification:`, {
                error: error.message,
                conversationId,
                videoUrl: videoUrl?.substring(0, 100) + '...'
            });
        }
    }

    /**
     * Sends video failure notification to user
     * @param {string} conversationId - MongoDB conversation ID  
     * @param {string} errorMessage - Error description
     */
    async sendVideoFailureNotification(conversationId, errorMessage) {
        try {
            const message = `😔 Hubo un problema generando tu video: ${errorMessage}. Por favor intenta nuevamente.`;
            await this.sendVideoTextMessage(conversationId, message);
            
            console.log(`📱 Video failure notification sent for conversation: ${conversationId}`);
            
        } catch (error) {
            console.error(`❌ Failed to send video failure notification:`, error.message);
        }
    }

    /**
     * Sends UltraMsg video message using proper video format
     * @param {Object} agent - Agent with UltraMsg credentials
     * @param {string} phoneNumber - Phone number
     * @param {string} videoUrl - Video URL
     * @param {string} caption - Video caption
     */
    async sendUltraMsgVideo(agent, phoneNumber, videoUrl, caption) {
        try {
            console.log(`📹 Sending video via UltraMsg to ${phoneNumber}`);
            
            // Use UltraMsg video endpoint with proper format
            const result = await ultramsgService.sendUltraMsgVideo(
                agent,
                phoneNumber,
                videoUrl,
                caption
            );
            
            console.log(`🔍 [VIDEO-WORKER] UltraMsg response validation:`, {
                sentField: result.sent,
                sentType: typeof result.sent,
                messageField: result.message,
                hasId: !!result.id,
                rawData: result.data
            });
            
            if (result.sent !== 'true') {
                throw new Error(`UltraMsg video send failed: ${result.message || 'Unknown error'}`);
            }
            
            console.log(`✅ UltraMsg video sent successfully`);
            
        } catch (error) {
            console.error(`❌ UltraMsg video send error:`, error.message);
            throw error;
        }
    }

    /**
     * Sends WhatsApp Factory video message
     * @param {Object} agent - Agent with WhatsApp Factory credentials  
     * @param {string} phoneNumber - Phone number
     * @param {string} videoUrl - Video URL
     * @param {string} caption - Video caption
     */
    async sendWhatsAppVideo(agent, phoneNumber, videoUrl, caption) {
        try {
            console.log(`📹 Sending video via WhatsApp Factory to ${phoneNumber}`);
            
            // For now, send as text message with video link (WhatsApp Factory video support TBD)
            const message = `${caption}\n\n🔗 Video: ${videoUrl}`;
            const result = await sendWhatsAppBusinessMessage(agent, phoneNumber, message);
            
            if (!result.success) {
                throw new Error(`WhatsApp Factory video send failed: ${result.error}`);
            }
            
            console.log(`✅ WhatsApp Factory video notification sent successfully`);
            
        } catch (error) {
            console.error(`❌ WhatsApp Factory video send error:`, error.message);
            throw error;
        }
    }

    /**
     * Sends text message via appropriate service (fallback for failures)
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} message - Message to send
     */
    async sendVideoTextMessage(conversationId, message) {
        try {
            // Get conversation and agent data
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            const agent = await Agent.findByPk(conversation.agentId);
            if (!agent) {
                throw new Error(`Agent not found: ${conversation.agentId}`);
            }
            
            // Send via appropriate service
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
            console.error(`❌ Video text message error:`, error.message);
            throw error;
        }
    }

    // ============================================================================
    // Cleanup & Utility Functions
    // ============================================================================

    /**
     * Cleans up Redis state for completed video job
     * @param {string} jobId - Video job ID to clean up
     */
    async cleanupVideoJobState(jobId) {
        try {
            await redisClient.del(VIDEO_REDIS_KEYS.videoJob(jobId));
            await redisClient.del(VIDEO_REDIS_KEYS.attempts(jobId));
            // Keep completed records for audit
        } catch (error) {
            console.error(`❌ Video cleanup error:`, error.message);
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
// Job Enqueueing Function - Called from openaiIntegration.js
// ============================================================================

/**
 * Enqueues a video job for background polling
 * @param {string} jobId - Video job ID from API response
 * @param {string} conversationId - MongoDB conversation ID
 * @param {Object} jobMetadata - Additional job metadata
 */
async function enqueueVideoJob(jobId, conversationId, jobMetadata = {}) {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
        
        // Store job data in Redis
        const jobData = {
            jobId: jobId,
            conversationId: conversationId,
            startTime: Date.now(),
            status: 'polling',
            ...jobMetadata
        };
        
        await redisClient.setEx(
            VIDEO_REDIS_KEYS.videoJob(jobId),
            VIDEO_TTL.videoJob,
            JSON.stringify(jobData)
        );
        
        // Enqueue job for polling with initial delay
        setTimeout(async () => {
            try {
                await redisClient.lPush(VIDEO_REDIS_KEYS.pollQueue, jobId);
                console.log(`✅ Video job ${jobId} enqueued for polling`);
            } catch (error) {
                console.error(`❌ Failed to enqueue video job ${jobId}:`, error.message);
            }
        }, VIDEO_POLLING_STRATEGY.initialDelay);
        
        console.log(`📝 Video job ${jobId} prepared for background polling`);
        
    } catch (error) {
        console.error(`❌ Failed to enqueue video job:`, error.message);
        throw error;
    }
}

// ============================================================================
// Module Exports & Singleton
// ============================================================================

const videoPollingWorker = new VideoPollingWorker();

module.exports = {
    VideoPollingWorker,
    videoPollingWorker,
    enqueueVideoJob,
    VIDEO_REDIS_KEYS,
    VIDEO_POLLING_STRATEGY
};
