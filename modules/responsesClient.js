/**
 * modules/responsesClient.js
 * 
 * Description: OpenAI Responses API client with MongoDB configuration and modular tools
 * 
 * Role in the system: Clean Responses API implementation with dynamic configuration
 */

const { OpenAI } = require("openai");
const Conversation = require('../models/Conversation');
const Agent = require('../models/Agent');
const ToolSchema = require('../models/ToolSchema');
const toolExecutor = require('../tools/toolExecutor');
const debugLoader = require('../utils/debugLoader');
const { redisClient } = require('../database');
const { loadMessages: loadMessagesFromRedis, populateCache } = require('../utils/redisConversationCache'); // ⭐ Redis cache
const { createExternalDownloadUrl, createDownloadUrl } = require('../utils/fileStorageUtils');
const axios = require('axios'); // Added axios for robust image downloading
const Message = require('../models/Message'); // ⭐ For MongoDB fallback

class ResponsesClient {
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        // model, maxTokens, and other config now loaded dynamically from MongoDB per agent
    }

    /**
     * Generate AI response using Responses API with MongoDB configuration
     */
    async generateResponse(conversationId, newMessage, abortController = null) {
        console.log(`🤖 [${conversationId}] Starting Responses API processing`);

        try {
            // Get conversation to determine agent
            const conversation = await Conversation.findById(conversationId);
            const agentId = conversation?.agentId;
            
            // Load agent configuration from MongoDB
            const agentConfig = await this.loadAgentConfig(agentId);
            
            // Build conversation context
            const messages = await this.buildMessages(conversationId, newMessage);
            
            // Load agent-specific tools (debug mode or MongoDB)
            const tools = await this.getTools(agentId);
            
            // Check for debug tools override
            let finalTools = tools;
            if (debugLoader.isDebugMode()) {
                const debugStatus = debugLoader.getDebugStatus();
                
                if (debugStatus.tools_debug) {
                    const debugTools = await debugLoader.loadDebugTools();
                    if (debugTools) {
                        finalTools = debugTools;
                        console.log(`🐛 [${conversationId}] Using DEBUG tools from file (${debugTools.length} tools)`);
                    }
                }
            }
            
            // Log request details (safe for debugging)
            console.log(`📤 [${conversationId}] Responses API request:`, {
                model: agentConfig.modelConfig.model,
                messageCount: messages.length,
                toolCount: tools.length,
                maxTokens: agentConfig.modelConfig.maxCompletionTokens,
                schemaName: agentConfig.responseSchema.name,
                hasImages: messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'image_url'))
            });

            // Check for debug schema override
            let responseFormat = { type: 'json_schema', json_schema: agentConfig.responseSchema };
            if (debugLoader.isDebugMode()) {
                const debugStatus = debugLoader.getDebugStatus();
                
                if (debugStatus.schema_debug) {
                    const debugSchema = await debugLoader.loadDebugSchema();
                    if (debugSchema) {
                        responseFormat = { type: 'json_schema', json_schema: debugSchema };
                        console.log(`🐛 [${conversationId}] Using DEBUG schema from file: ${debugSchema.name}`);
                    }
                }
            }

            // ================================================================
            // ⭐ MODEL CONFIGURATION - OpenAI Public API Parameters ONLY
            // ================================================================
            // OpenAI Public API ONLY supports: max_completion_tokens, temperature, top_p
            // Azure-specific parameters (max_output_tokens, reasoning_effort, verbosity) NOT supported
            
            const requestConfig = {
                model: agentConfig.modelConfig.model,
                messages,
                tools: finalTools,
                response_format: responseFormat,
                max_completion_tokens: agentConfig.modelConfig.maxCompletionTokens,
                stream: agentConfig.modelConfig.streaming
            };
            
            // ================================================================
            // ⭐ Add temperature ONLY for non-reasoning models
            // ================================================================
            const modelName = agentConfig.modelConfig.model.toLowerCase();
            const isReasoningModel = modelName.includes('gpt-5') && !modelName.includes('mini');
            
            if (!isReasoningModel) {
                // Standard models (gpt-5-mini, gpt-4o) support temperature
                requestConfig.temperature = agentConfig.modelConfig.temperature;
                console.log(`⚡ [${conversationId}] Standard model: using temperature=${requestConfig.temperature}`);
            } else {
                // Reasoning models (gpt-5, gpt-5.1)
                console.log(`🧠 [${conversationId}] Reasoning model detected: ${agentConfig.modelConfig.model}`);
                
                // ⭐ TRY to send reasoning_effort (may or may not be supported in public API)
                if (agentConfig.modelConfig.reasoningEffort) {
                    requestConfig.reasoning_effort = agentConfig.modelConfig.reasoningEffort;
                    console.log(`🎯 [${conversationId}] Sending reasoning_effort='${requestConfig.reasoning_effort}' (will test if supported)`);
                }
                
                if (agentConfig.modelConfig.verbosity) {
                    requestConfig.verbosity = agentConfig.modelConfig.verbosity;
                    console.log(`🎯 [${conversationId}] Sending verbosity='${requestConfig.verbosity}' (will test if supported)`);
                }
                
                // Temperature not supported in reasoning models
            }

            console.log(`🔄 [${conversationId}] Using ${agentConfig.modelConfig.streaming ? 'STREAMING' : 'NON-STREAMING'} mode per agent config`);

            // LOG: Complete request being sent to OpenAI (human readable)
            /*console.log(`📤 [${conversationId}] FULL REQUEST TO OPENAI:`, JSON.stringify({
                model: requestConfig.model,
                stream: requestConfig.stream,
                max_completion_tokens: requestConfig.max_completion_tokens,
                response_format: {
                    type: requestConfig.response_format.type,
                    json_schema: {
                        name: requestConfig.response_format.json_schema.name,
                        strict: requestConfig.response_format.json_schema.strict,
                        schema_keys: Object.keys(requestConfig.response_format.json_schema.schema)
                    }
                },
                messages: messages.map((msg, idx) => ({
                    index: idx,
                    role: msg.role,
                    content_type: typeof msg.content,
                    content_preview: typeof msg.content === 'string' 
                        ? msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : '')
                        : Array.isArray(msg.content) 
                            ? `[${msg.content.length} parts: ${msg.content.map(p => p.type).join(', ')}]`
                            : '[complex content]'
                })),
                tools: tools.map(tool => ({
                    name: tool.function.name,
                    description_preview: tool.function.description.substring(0, 50) + '...',
                    parameter_count: Object.keys(tool.function.parameters?.properties || {}).length
                }))
            }, null, 2)); */

            // LOG: RAW REQUEST being sent to OpenAI (cleaned for readability)
            const cleanedRequestConfig = { ...requestConfig };
            
            // Clean system prompt and messages with base64 data for readability
            if (cleanedRequestConfig.messages) {
                cleanedRequestConfig.messages = cleanedRequestConfig.messages.map(msg => {
                    if (msg.role === 'system') {
                        return { ...msg, content: "[SYSTEM_PROMPT]" };
                    }
                    if (Array.isArray(msg.content)) {
                        const newContent = msg.content.map(part => {
                            if (part.type === 'image_url' && part.image_url?.url.startsWith('data:image')) {
                                return {
                                    ...part,
                                    image_url: { ...part.image_url, url: "[BASE64_IMAGE_DATA]" }
                                };
                            }
                            return part;
                        });
                        return { ...msg, content: newContent };
                    }
                    return msg;
                });
            }
            
            // Clean tools array for readability  
            if (cleanedRequestConfig.tools && cleanedRequestConfig.tools.length > 0) {
                cleanedRequestConfig.tools = cleanedRequestConfig.tools.map((tool, index) => ({
                    type: tool.type,
                    function: {
                        name: tool.function.name,
                        description: `[TOOL_${index + 1}_DESCRIPTION]`, // Clean large descriptions
                        parameters: `[TOOL_${index + 1}_PARAMETERS]`   // Clean large parameter schemas
                    }
                }));
            }
            
            // Clean response format schema for readability
            if (cleanedRequestConfig.response_format && cleanedRequestConfig.response_format.json_schema) {
                cleanedRequestConfig.response_format = {
                    type: cleanedRequestConfig.response_format.type,
                    json_schema: {
                        name: cleanedRequestConfig.response_format.json_schema.name,
                        description: "[RESPONSE_SCHEMA]",
                        schema: "[RESPONSE_SCHEMA_PROPERTIES]"
                    }
                };
            }
            
            console.log(`🔍 [${conversationId}] RAW REQUEST PACKET:`, JSON.stringify(cleanedRequestConfig, null, 2));

            // ================================================================
            // ⭐ OPENAI REQUEST WITH ABORT CAPABILITY
            // ================================================================
            const openAIOptions = {};
            if (abortController) {
                openAIOptions.signal = abortController.signal;
                console.log(`🎯 [${conversationId}] AbortController signal attached to OpenAI request`);
            }

            const response = await this.openai.chat.completions.create(requestConfig, openAIOptions);

            // LOG: RAW RESPONSE from OpenAI (complete packet)
            if (agentConfig.modelConfig.streaming) {
                console.log(`🔍 [${conversationId}] RAW RESPONSE: [STREAMING - will log chunks]`);
            } else {
                console.log(`🔍 [${conversationId}] RAW RESPONSE PACKET:`, JSON.stringify(response, null, 2));
            }

            // Process response (streaming or non-streaming)
            const result = await this.processStream(response, conversationId, messages, agentConfig, abortController);
            
            console.log(`✅ [${conversationId}] Responses API processing completed`);
            return result;

        } catch (error) {
            // ================================================================
            // ⭐ HANDLE ABORT ERROR GRACEFULLY
            // ================================================================
            if (error.name === 'AbortError' || error.message?.includes('aborted')) {
                console.log(`🚫 [${conversationId}] OpenAI request was aborted (expected behavior)`);
                return {
                    content: null,
                    toolCalls: [],
                    toolResults: [],
                    hasTools: false,
                    aborted: true,
                    tokens: {},
                    openaiResponseId: null,
                    finishReason: 'aborted'
                };
            }
            
            console.error(`❌ [${conversationId}] Responses API error:`, error.message);
            throw new Error(`AI processing failed: ${error.message}`);
        }
    }

    /**
     * Create contextual placeholder for historical images (when not including blob)
     * Uses AI observation if available, falls back to metadata
     * 
     * @param {Object} message - Message object with fileStorage
     * @returns {string} Formatted placeholder text
     */
    createImagePlaceholder(message) {
        // ====================================================================
        // ⭐ BEST OPTION: Use AI's visual description if available
        // ====================================================================
        
        if (message.fileStorage?.aiObservation?.visualDescription) {
            return `[Previously shared image: ${message.fileStorage.aiObservation.visualDescription}]`;
        }
        
        // ====================================================================
        // ⭐ FALLBACK: Build from metadata
        // ====================================================================
        
        const parts = ['[Previously shared image'];
        
        if (message.fileStorage?.contentType) {
            parts.push(`type: ${message.fileStorage.contentType}`);
        }
        
        if (message.fileStorage?.filename) {
            parts.push(`file: ${message.fileStorage.filename}`);
        }
        
        if (message.fileStorage?.fileSizeHuman) {
            parts.push(`size: ${message.fileStorage.fileSizeHuman}`);
        }
        
        // Include user's text description if provided
        const userText = message.content?.map(c => c.content).join(' ').trim();
        if (userText && userText.length > 10) {
            const truncatedText = userText.length > 100 ? userText.substring(0, 100) + '...' : userText;
            parts.push(`context: "${truncatedText}"`);
        }
        
        return parts.join(', ') + ']';
    }

    /**
     * Build conversation messages from Message collection (separated)
     * ⭐ PERFORMANCE: Redis cache layer for sub-ms access at scale
     */
    async buildMessages(conversationId, newMessage) {
        const perfStart = performance.now();
        const conversation = await Conversation.findById(conversationId);
        
        // Load agent configuration from MongoDB
        const agentConfig = await this.loadAgentConfig(conversation?.agentId);
        
        // ====================================================================
        // ⭐ GET IMAGE HISTORY SETTINGS
        // ====================================================================
        const imageHistoryMode = agentConfig.imageContextConfig?.historyMode || 'low';
        const maxHistoricalImages = agentConfig.imageContextConfig?.maxHistoricalImages || 20;
        
        console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🖼️ [${conversationId}] Image history mode: ${imageHistoryMode} (max: ${maxHistoricalImages})`);
        
        // Load system prompt (debug mode or MongoDB)
        let systemPrompt = agentConfig.systemPrompt;
        
        // Check for debug prompt override
        if (debugLoader.isDebugMode()) {
            const debugStatus = debugLoader.getDebugStatus();
            console.log(`🐛 [${conversationId}] Debug mode active:`, debugStatus);
            
            if (debugStatus.prompt_debug) {
                const debugPrompt = await debugLoader.loadDebugPrompt(conversation?.agentId);
                if (debugPrompt) {
                    systemPrompt = debugPrompt;
                    console.log(`🐛 [${conversationId}] Using DEBUG prompt from file`);
                }
            }
        }

        const messages = [
            { role: 'system', content: systemPrompt }
        ];

        // ====================================================================
        // ⭐ REDIS CACHE LAYER: Active Conversations Strategy
        // ====================================================================
        // 
        // Strategy:
        // 1. Active conversations (< 2h): Redis cache (< 5ms access)
        // 2. Inactive conversations (> 2h): MongoDB query (250ms, acceptable)
        // 3. Max cached: 50 messages (FIFO, oldest discarded)
        // 
        // Cold Start (no Redis):
        // - Load last 50 messages from MongoDB
        // - Populate Redis with all loaded messages
        // - Next messages: Progressive fill until 50
        // - After 50: FIFO (remove oldest when adding new)
        // 
        // Hot Path (Redis exists):
        // - Load from Redis (< 5ms) ⚡
        // - MongoDB untouched
        // - TTL refreshed on each new message (2h window)
        
        let conversationMessages;
        const MAX_HISTORY_MESSAGES = 50; // Max messages for OpenAI context
        
        // ================================================================
        // ⭐ TRY REDIS FIRST (active conversations)
        // ================================================================
        conversationMessages = await loadMessagesFromRedis(conversationId, MAX_HISTORY_MESSAGES);
        
        if (!conversationMessages) {
            // ================================================================
            // ⭐ CACHE MISS: Cold Start - Load from MongoDB
            // ================================================================
            // Conversation either:
            // - Never cached (first time)
            // - Inactive > 2h (TTL expired)
            
            console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🔄 [${conversationId}] Redis MISS (inactive or first time) - loading from MongoDB`);
            
            // Load last 50 messages (or less if conversation is new)
            conversationMessages = await Message.find({ conversationId })
                .sort({ timestamp: -1 })
                .limit(MAX_HISTORY_MESSAGES)
                .select('-fileStorage.base64Cache.data')
            .lean();
        
            conversationMessages.reverse(); // Chronological order
            
            // ============================================================
            // ⭐ POPULATE REDIS (non-blocking)
            // ============================================================
            // Start Redis cache for this conversation
            // Will fill progressively until 50 messages
            // Then FIFO (oldest discarded)
            
            populateCache(conversationId, conversationMessages).catch(err => {
                console.warn(`⚠️ Failed to populate Redis cache:`, err.message);
            });
            
            console.log(`[+${Math.round(performance.now() - perfStart)}ms] 📂 [${conversationId}] Loaded ${conversationMessages.length} messages from MongoDB (populating Redis)`);
        } else {
            // ================================================================
            // ⭐ SMART DETECTION: Incomplete Redis Cache
            // ================================================================
            // If Redis has VERY FEW messages (< 5), might be incomplete cache
            // (e.g., only the latest message was cached, not full history)
            
            if (conversationMessages.length < 5) {
                console.log(`[+${Math.round(performance.now() - perfStart)}ms] ⚠️ [${conversationId}] Redis has only ${conversationMessages.length} messages - checking MongoDB for more`);
                
                // Check if MongoDB has more messages
                const mongoCount = await Message.countDocuments({ conversationId });
                
                if (mongoCount > conversationMessages.length) {
                    console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🔄 [${conversationId}] Incomplete cache detected (Redis: ${conversationMessages.length}, MongoDB: ${mongoCount}) - reloading from MongoDB`);
                    
                    // Load full history from MongoDB
                    conversationMessages = await Message.find({ conversationId })
                        .sort({ timestamp: -1 })
                        .limit(MAX_HISTORY_MESSAGES)
                        .select('-fileStorage.base64Cache.data')
                        .lean();
                    
                    conversationMessages.reverse(); // Chronological order
                    
                    // Re-populate Redis with complete history (non-blocking)
                    populateCache(conversationId, conversationMessages).catch(err => {
                        console.warn(`⚠️ Failed to re-populate Redis cache:`, err.message);
                    });
                    
                    console.log(`[+${Math.round(performance.now() - perfStart)}ms] ✅ [${conversationId}] Loaded ${conversationMessages.length} messages from MongoDB (re-populated Redis)`);
                } else {
                    console.log(`[+${Math.round(performance.now() - perfStart)}ms] ♻️ [${conversationId}] Redis HIT - ${conversationMessages.length} messages (< 5ms) ⚡`);
                }
            } else {
                console.log(`[+${Math.round(performance.now() - perfStart)}ms] ♻️ [${conversationId}] Redis HIT - ${conversationMessages.length} messages (< 5ms) ⚡`);
            }
        }

        // ====================================================================
        // ⭐ FIND LAST ASSISTANT MESSAGE (for 'low' mode cutoff)
        // ====================================================================
        
        let lastAssistantMessageIndex = -1;
        
        if (imageHistoryMode === 'low') {
            for (let i = conversationMessages.length - 1; i >= 0; i--) {
                if (conversationMessages[i].sender === 'ai_agent') {
                    lastAssistantMessageIndex = i;
                    console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🔍 [${conversationId}] Last assistant message at index ${i}`);
                    break;
                }
            }
        }

        // ====================================================================
        // ⭐ TRACK IMAGE INCLUSION FOR SMART HISTORY
        // ====================================================================
        let imagesIncluded = 0;
        let imagesPlaceholdered = 0;

        // ====================================================================
        // ⭐ Process ALL messages (no skipping - Redis/MongoDB have correct order)
        // ====================================================================
        // All messages are already in MongoDB/Redis in chronological order
        // No need to skip duplicates - they're the source of truth
        
        for (let i = 0; i < conversationMessages.length; i++) {
            const msg = conversationMessages[i];

            // Check if AI message has tool context for perfect reconstruction
            if (msg.sender === 'ai_agent') {
                if (msg.openaiToolContext && msg.openaiToolContext.tool_calls && msg.openaiToolContext.tool_calls.length > 0) {
                    console.log(`🛠️ [${conversationId}] Reconstructing OpenAI tool context`, {
                        toolCount: msg.openaiToolContext.tool_calls.length
                    });
                    
                    // Step 1: Add assistant message with tool_calls
                    messages.push({
                        role: 'assistant',
                        content: null,
                        tool_calls: msg.openaiToolContext.tool_calls
                    });
                    
                    // Step 2: Add tool result messages
                    for (const toolResult of msg.openaiToolContext.tool_results) {
                        messages.push({
                            role: 'tool',
                            content: toolResult.content,
                            tool_call_id: toolResult.tool_call_id
                        });
                    }
                    
                    // Step 3: Add the final assistant response
                    const reconstructedAssistantMessage = this.reconstructAssistantMessageAsJSON(msg);
                    messages.push({
                        role: 'assistant',
                        content: reconstructedAssistantMessage
                    });
                    
                    console.log(`✅ [${conversationId}] Tool context reconstructed: ${1 + msg.openaiToolContext.tool_results.length + 1} messages added`);
                    
                } else {
                    // Standard AI message processing (no tool context)
                    const reconstructedAssistantMessage = this.reconstructAssistantMessageAsJSON(msg);
                    messages.push({
                        role: 'assistant',
                        content: reconstructedAssistantMessage
                    });
                }
            } else if (msg.sender === 'user') {
                console.log(`[TRACE - buildMessages] Processing historical user message:`, {
                  messageId: msg.msg_foreign_id,
                  hasFileStorage: !!msg.fileStorage,
                  fileStorageStatus: msg.fileStorage?.status,
                  fileId: msg.fileStorage?.fileId
                });

                // Standard user message processing
                const contentParts = [];
                const textContent = this.reconstructUserMessageAsJSON(msg, conversation);
                if (textContent && textContent.trim()) {
                    contentParts.push({ type: 'text', text: textContent });
                }

                // ================================================================
                // ⭐ SMART IMAGE INCLUSION LOGIC
                // ================================================================
                
                if (msg.fileStorage && msg.fileStorage.status === 'success' && msg.fileStorage.fileId) {
                    // ============================================================
                    // ⭐ CRITICAL: Skip AUDIO files (only process actual IMAGES)
                    // ============================================================
                    const contentType = msg.fileStorage.contentType || '';
                    const isAudioFile = contentType.includes('audio/') || contentType.includes('ogg');
                    
                    if (isAudioFile) {
                        console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🎵 [${conversationId}] Skipping audio file (not an image): ${msg.fileStorage.fileId}`);
                        // Audio files should not be included as images - continue to next message
                    } else {
                        // This is an actual image file - process normally
                        let shouldIncludeBlob = false;
                        
                        switch (imageHistoryMode) {
                            case 'full':
                                // Always include blob (respecting max limit)
                                shouldIncludeBlob = (imagesIncluded < maxHistoricalImages);
                                break;
                                
                            case 'low':
                                // Only include if AFTER last assistant message
                                shouldIncludeBlob = (i > lastAssistantMessageIndex) && (imagesIncluded < maxHistoricalImages);
                                break;
                                
                            case 'none':
                                // Never include historical blobs
                                shouldIncludeBlob = false;
                                break;
                        }
                    
                    if (shouldIncludeBlob) {
                        // ============================================================
                        // ⭐ INCLUDE ACTUAL BLOB (with caching)
                        // ============================================================
                        
                        // Load full message with blob cache data
                        const fullMessage = await Message.findById(msg._id)
                            .select('+fileStorage.base64Cache.data')  // Explicitly include
                            .lean();
                        
                        const imagePart = await this.loadImageAsBase64(fullMessage, conversationId, false);
                        
                    if (imagePart) {
                        contentParts.push(imagePart);
                            imagesIncluded++;
                            console.log(`[+${Math.round(performance.now() - perfStart)}ms] 🖼️ [${conversationId}] Included image blob #${imagesIncluded}: ${msg.fileStorage.fileId}`);
                        }
                        
                    } else {
                        // ============================================================
                        // ⭐ USE CONTEXTUAL PLACEHOLDER (save time + tokens)
                        // ============================================================
                        
                        const placeholder = this.createImagePlaceholder(msg);
                        
                        // Append to text content
                        if (contentParts.length > 0 && contentParts[0].type === 'text') {
                            contentParts[0].text += `\n\n${placeholder}`;
                        } else {
                            contentParts.push({ type: 'text', text: placeholder });
                        }
                        
                        imagesPlaceholdered++;
                        console.log(`[+${Math.round(performance.now() - perfStart)}ms] 📝 [${conversationId}] Used placeholder for: ${msg.fileStorage.fileId}`);
                    }
                    }  // ⭐ Close else (not audio file)
                }
                
                let finalContent;
                if (contentParts.length === 1 && contentParts[0].type === 'text') {
                    finalContent = contentParts[0].text;
                } else if (contentParts.length === 0) {
                    finalContent = "";
                } else {
                    finalContent = contentParts;
                }

                messages.push({
                    role: 'user',
                    content: finalContent
                });
            }
        }

        // ====================================================================
        // ⭐ NO need to add newMessage - already in Redis/MongoDB cache
        // ====================================================================
        // All messages are loaded from cache in correct chronological order
        // No duplicate messages, no manual appending needed
        
        console.log(`[+${Math.round(performance.now() - perfStart)}ms] 📝 [${conversationId}] Built ${messages.length} messages for OpenAI context`, {
            imagesIncluded,
            imagesPlaceholdered,
            tokensSavedEstimate: imagesPlaceholdered * 1000,
            source: conversationMessages.length > 0 ? (conversationMessages[0]._id ? 'MongoDB' : 'Redis') : 'empty'
        });
        
        return messages;
    }

    /**
     * Downloads an image from our file storage and prepares it in base64 format for OpenAI.
     * 
     * ⭐ PERFORMANCE OPTIMIZATION: Blob caching system
     * - First request: Download and cache blob in MongoDB
     * - Subsequent requests: Reuse cached blob (saves 0.5-1s per image + ~1000 tokens)
     * - Cache TTL: 30 days
     * 
     * @param {Object} message - Full message object from MongoDB (must include fileStorage.base64Cache if queried)
     * @param {string} conversationId - For logging purposes
     * @param {boolean} forceReload - Force re-download even if cached
     * @returns {Object|null} OpenAI-compatible image part or null if fails
     */
    async loadImageAsBase64(message, conversationId, forceReload = false) {
        const perfStart = performance.now();
        const fileId = message.fileStorage?.fileId;
        
        if (!fileId) {
            console.log(`[+0ms] ⚠️ [${conversationId}] No fileId found in message`);
            return null;
        }
        
        // ====================================================================
        // ⭐ OPTIMIZATION: Use cached blob if available
        // ====================================================================
        
        if (!forceReload && message.fileStorage.base64Cache?.data) {
            const cacheAge = Date.now() - new Date(message.fileStorage.base64Cache.cachedAt).getTime();
            const MAX_CACHE_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days
            
            if (cacheAge < MAX_CACHE_AGE) {
                const elapsed = Math.round(performance.now() - perfStart);
                const cacheAgeMin = Math.round(cacheAge / 1000 / 60);
                
                console.log(`[+${elapsed}ms] ♻️ [${conversationId}] Using cached blob: ${fileId} (age: ${cacheAgeMin}min, size: ${message.fileStorage.base64Cache.sizeKB}KB)`);
                
                return {
                    type: 'image_url',
                    image_url: {
                        url: `data:${message.fileStorage.base64Cache.mimeType};base64,${message.fileStorage.base64Cache.data}`
                    }
                };
            } else {
                const cacheAgeDays = Math.round(cacheAge / 1000 / 60 / 60 / 24);
                console.log(`[+${Math.round(performance.now() - perfStart)}ms] ⚠️ [${conversationId}] Cached blob expired (${cacheAgeDays} days old) - re-downloading`);
            }
        }
        
        // ====================================================================
        // ⭐ DOWNLOAD & CACHE: First time or expired/missing cache
        // ====================================================================
        
        console.log(`[+${Math.round(performance.now() - perfStart)}ms] 📥 [${conversationId}] Downloading and caching image: ${fileId}`);
        
        try {
            const downloadUrl = createDownloadUrl(fileId);

            const response = await axios({
                method: 'get',
                url: downloadUrl,
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Micro-Banana-ResponsesClient/1.0',
                    'X-API-Key': process.env.API_KEY_WEBHOOK
                }
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}`);
            }

            const base64Data = Buffer.from(response.data).toString('base64');
            const mimeType = response.headers['content-type'] || 'image/jpeg';
            const sizeBytes = response.data.length;
            const sizeKB = Math.round(sizeBytes / 1024);

            console.log(`[+${Math.round(performance.now() - perfStart)}ms] ✅ [${conversationId}] Image downloaded (${sizeKB}KB)`);
            
            // ================================================================
            // ⭐ SAVE TO MONGODB: Cache for future requests
            // ================================================================
            
            try {
                const Message = require('../models/Message');
                await Message.findByIdAndUpdate(message._id, {
                    'fileStorage.base64Cache': {
                        data: base64Data,
                        mimeType: mimeType,
                        cachedAt: new Date(),
                        sizeBytes: sizeBytes,
                        sizeKB: sizeKB
                    }
                });
                
                console.log(`[+${Math.round(performance.now() - perfStart)}ms] 💾 [${conversationId}] Blob cached in MongoDB: ${fileId} (${sizeKB}KB)`);
            } catch (cacheError) {
                console.error(`⚠️ Failed to cache blob (non-blocking):`, cacheError.message);
                // Continue - caching is optimization, not critical path
            }

            return {
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${base64Data}`
                }
            };

        } catch (error) {
            console.error(`❌ [${conversationId}] Failed to download image ${fileId}:`, error.message);
            return null;
        }
    }

    /**
     * Process response (streaming or non-streaming) with tool calls handling
     * ⭐ Enhanced with AbortController support and token tracking
     */
    async processStream(response, conversationId, messages, agentConfig, abortController = null) {
        let toolCalls = [];
        let assistantMessage = '';
        let finishReason = null;
        let tokens = {};
        let openaiResponseId = null;

        if (agentConfig.modelConfig.streaming) {
            console.log(`🔄 [${conversationId}] Processing streaming response...`);

            // Process streaming response
            for await (const chunk of response) {
                // LOG: Each streaming chunk (raw)
                console.log(`🔍 [${conversationId}] STREAMING CHUNK:`, JSON.stringify(chunk, null, 2));
                
                const choice = chunk.choices?.[0];
                if (!choice) continue;

                // Accumulate tool calls
                if (choice.delta?.tool_calls) {
                    toolCalls = this.accumulateToolCalls(choice.delta.tool_calls, toolCalls);
                }

                // Accumulate content
                if (choice.delta?.content) {
                    assistantMessage += choice.delta.content;
                }

                // Check finish reason
                if (choice.finish_reason) {
                    finishReason = choice.finish_reason;
                    break;
                }
            }
        } else {
            console.log(`🔄 [${conversationId}] Processing non-streaming response...`);

            // Process non-streaming response
            const choice = response.choices?.[0];
            if (choice) {
                toolCalls = choice.message?.tool_calls || [];
                assistantMessage = choice.message?.content || '';
                finishReason = choice.finish_reason;
            }
            
            // ⭐ Extract tokens and response ID
            tokens = response.usage || {};
            openaiResponseId = response.id;
        }

        // Handle tool calls if present
        if (finishReason === 'tool_calls' && toolCalls.length > 0) {
            console.log(`🔧 [${conversationId}] Executing ${toolCalls.length} tool calls`);
            
            const toolResults = await this.executeTools(toolCalls, conversationId);
            
            // 🔥 NEW ARCHITECTURE: Tool context will be saved with AI message in messageQueue.js
            
            // Continue conversation with tool results
            const continuationMessages = [
                ...messages,
                { role: 'assistant', tool_calls: toolCalls },
                ...toolResults.map(result => ({
                    role: 'tool',
                    content: result.output,
                    tool_call_id: result.tool_call_id
                }))
            ];

            // Get final response after tool execution
            // ⭐ Include abort signal for second request too
            const toolOpenAIOptions = abortController ? { signal: abortController.signal } : {};
            
            // ⭐ Build tool continuation config
            const toolRequestConfig = {
                model: agentConfig.modelConfig.model,
                messages: continuationMessages,
                response_format: { type: 'json_schema', json_schema: agentConfig.responseSchema },
                max_completion_tokens: agentConfig.modelConfig.maxCompletionTokens,
                stream: agentConfig.modelConfig.streaming
            };
            
            // ================================================================
            // ⭐ Detect reasoning model (needed in this scope)
            // ================================================================
            const modelName = agentConfig.modelConfig.model.toLowerCase();
            const isReasoningModel = modelName.includes('gpt-5') && !modelName.includes('mini');
            
            // Apply model-specific parameters
            if (!isReasoningModel) {
                // Standard models
                toolRequestConfig.temperature = agentConfig.modelConfig.temperature;
            } else {
                // Reasoning models - try to send reasoning parameters
                if (agentConfig.modelConfig.reasoningEffort) {
                    toolRequestConfig.reasoning_effort = agentConfig.modelConfig.reasoningEffort;
                }
                if (agentConfig.modelConfig.verbosity) {
                    toolRequestConfig.verbosity = agentConfig.modelConfig.verbosity;
                }
            }
            
            const finalResponse = await this.openai.chat.completions.create(toolRequestConfig, toolOpenAIOptions);

            // Process final response based on streaming mode
            let finalContent = '';
            if (agentConfig.modelConfig.streaming) {
                for await (const chunk of finalResponse) {
                    if (chunk.choices?.[0]?.delta?.content) {
                        finalContent += chunk.choices[0].delta.content;
                    }
                }
            } else {
                finalContent = finalResponse.choices?.[0]?.message?.content || '';
            }

            // ⭐ Extract tokens from final response
            if (finalResponse.usage) {
                tokens = finalResponse.usage;
            }
            if (finalResponse.id) {
                openaiResponseId = finalResponse.id;
            }

            // LOG: Complete response from OpenAI (FULL CONTENT, no truncation)
            console.log(`📥 [${conversationId}] FULL RESPONSE FROM OPENAI:`, JSON.stringify({
                streaming_mode: agentConfig.modelConfig.streaming,
                finish_reason: finishReason,
                content_length: finalContent.length,
                content_full: finalContent, // FULL content, no preview
                tool_calls_count: toolCalls.length,
                tool_calls_full: toolCalls.map(tc => ({
                    id: tc.id,
                    name: tc.function.name,
                    arguments_full: tc.function.arguments // FULL arguments, no preview
                })),
                tool_results_count: toolResults.length,
                tool_results_full: toolResults.map(tr => ({
                    tool_call_id: tr.tool_call_id,
                    output_full: tr.output // FULL output, no preview
                })),
                tokens: tokens,  // ⭐ NEW: Token usage
                response_id: openaiResponseId  // ⭐ NEW: Response ID
            }, null, 2));

            return {
                content: finalContent,
                toolCalls: toolCalls,
                toolResults: toolResults,
                hasTools: true,
                tokens: tokens,              // ⭐ NEW
                openaiResponseId: openaiResponseId,  // ⭐ NEW
                finishReason: finishReason,  // ⭐ NEW
                aborted: false
            };
        }

        // Return direct response if no tools
        console.log(`📥 [${conversationId}] DIRECT RESPONSE FROM OPENAI (no tools):`, JSON.stringify({
            streaming_mode: agentConfig.modelConfig.streaming,
            finish_reason: finishReason,
            content_length: assistantMessage.length,
            content_full: assistantMessage, // FULL content, no truncation
            has_tools: false,
            tokens: tokens,  // ⭐ NEW
            response_id: openaiResponseId  // ⭐ NEW
        }, null, 2));

        return {
            content: assistantMessage,
            toolCalls: [],
            toolResults: [],
            hasTools: false,
            tokens: tokens,              // ⭐ NEW
            openaiResponseId: openaiResponseId,  // ⭐ NEW
            finishReason: finishReason,  // ⭐ NEW
            aborted: false
        };
    }

    /**
     * Accumulate tool calls from streaming chunks
     */
    accumulateToolCalls(deltaToolCalls, existingToolCalls) {
        for (const deltaCall of deltaToolCalls) {
            const index = deltaCall.index;
            
            if (!existingToolCalls[index]) {
                existingToolCalls[index] = {
                    id: deltaCall.id || '',
                    type: deltaCall.type || 'function',
                    function: {
                        name: deltaCall.function?.name || '',
                        arguments: deltaCall.function?.arguments || ''
                    }
                };
            } else {
                // Accumulate function arguments
                if (deltaCall.function?.arguments) {
                    existingToolCalls[index].function.arguments += deltaCall.function.arguments;
                }
            }
        }
        
        return existingToolCalls;
    }

    /**
     * Execute tool calls using modular tool implementations
     */
    async executeTools(toolCalls, conversationId) {
        const toolOutputs = [];
        
        console.log(`🔧 [${conversationId}] Executing ${toolCalls.length} tool calls with modular architecture`);
        
        for (const toolCall of toolCalls) {
            const { id, function: { name, arguments: args } } = toolCall;

            try {
                const parsedArgs = JSON.parse(args);
                
                // Use modular tool executor
                const output = await toolExecutor.executeTool(name, parsedArgs, conversationId);

                toolOutputs.push({
                    tool_call_id: id,
                    output: JSON.stringify(output)
                });

            } catch (error) {
                console.error(`❌ [${conversationId}] Tool execution failed for ${name}:`, error.message);
                
                toolOutputs.push({
                    tool_call_id: id,
                    output: JSON.stringify({
                        success: false,
                        status: "error",
                        error: error.message,
                        function_name: name
                    })
                });
            }
        }
        
        console.log(`✅ [${conversationId}] Completed ${toolOutputs.length} modular tool executions`);
        return toolOutputs;
    }

    /**
     * Send immediate message to user via appropriate service
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} messageText - Message text to send
     * @returns {Promise<Object>} Send result from messaging service
     */
    async sendImmediateMessageToUser(conversationId, messageText) {
        console.log(`📤 [${conversationId}] Sending immediate message: "${messageText.substring(0, 50)}..."`);
        
        try {
            // Get conversation and agent details
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error('Conversation not found');
            }
            
            const Agent = require('../models/Agent');
            const agent = await Agent.findById(conversation.agentId);
            if (!agent) {
                throw new Error('Agent not found');
            }

            const phoneNumber = conversation.phoneNumber;
            if (!phoneNumber) {
                throw new Error('Phone number not found in conversation');
            }

            let sendResult;

            // Route to appropriate service based on agent type
            if (agent.type === 'wpp-bsp') {
                // WhatsApp Business Service Provider
                console.log(`📱 [${conversationId}] Using WhatsApp Business Service`);
                const { sendWhatsAppBusinessMessage } = require('../services/whatsappBusinessService');
                sendResult = await sendWhatsAppBusinessMessage(agent, phoneNumber, messageText);
                
                if (sendResult && sendResult.success) {
                    console.log(`✅ [${conversationId}] WhatsApp Business immediate message sent successfully`);
                } else {
                    console.error(`❌ [${conversationId}] WhatsApp Business immediate message failed:`, sendResult);
                }
            } else {
                // Default to UltraMsg
                console.log(`📱 [${conversationId}] Using UltraMsg service`);
                const ultramsgService = require('../services/ultramsgService');
                sendResult = await ultramsgService.sendUltraMsg(agent, phoneNumber, messageText);
                
                console.log(`🔍 [${conversationId}] UltraMsg immediate response:`, sendResult);
                
                if (sendResult && (sendResult.sent === 'true' || sendResult.sent === true)) {
                    console.log(`✅ [${conversationId}] UltraMsg immediate message sent successfully:`, {
                        id: sendResult.id,
                        sent: sendResult.sent
                    });
                } else {
                    console.error(`❌ [${conversationId}] UltraMsg immediate message failed:`, sendResult);
                }
            }

            return sendResult;

        } catch (error) {
            console.error(`❌ [${conversationId}] Error sending immediate message:`, error.message);
            // Non-blocking error - don't throw
            return {
                success: false,
                error: error.message,
                service: 'immediate_messaging'
            };
        }
    }

    /**
     * Load agent configuration from MongoDB with caching
     */
    async loadAgentConfig(agentId) {
        if (!agentId) {
            throw new Error('Agent ID is required');
        }

        try {
            // Check Redis cache first
            const cacheKey = `agent_config:${agentId}`;
            const cachedConfig = await redisClient.get(cacheKey);
            
            if (cachedConfig) {
                console.log(`📦 [Agent ${agentId}] Using cached configuration`);
                return JSON.parse(cachedConfig);
            }

            // Load agent from MongoDB (consolidated model)
            console.log(`📥 [Agent ${agentId}] Loading configuration from MongoDB`);
            const agent = await Agent.findById(agentId);
            
            if (!agent) {
                throw new Error(`No configuration found for agent ${agentId}`);
            }

            // Format as agentConfig for compatibility
            const agentConfig = {
                agentId: agent._id,
                agentName: agent.name,
                status: agent.status,
                systemPrompt: agent.systemPrompt,
                modelConfig: agent.modelConfig,
                responseSchema: agent.responseSchema,
                metadata: agent.metadata
            };

            // ⭐ OPTIMIZATION: Cache for 24 hours (prompts rarely change)
            await redisClient.setEx(cacheKey, 86400, JSON.stringify(agentConfig));
            
            console.log(`✅ [Agent ${agentId}] Loaded configuration`, {
                version: agentConfig.metadata.version,
                category: agentConfig.metadata.category,
                model: agentConfig.modelConfig.model,
                maxTokens: agentConfig.modelConfig.maxCompletionTokens,
                streaming: agentConfig.modelConfig.streaming,
                configSource: 'MongoDB'
            });

            return agentConfig;

        } catch (error) {
            console.error(`❌ [Agent ${agentId}] Error loading configuration:`, error.message);
            throw error;
        }
    }

    /**
     * Load tools for specific agent from MongoDB
     */
    async loadAgentTools(agentId) {
        try {
            // Check Redis cache first
            const cacheKey = `agent_tools:${agentId}`;
            const cachedTools = await redisClient.get(cacheKey);
            
            if (cachedTools) {
                console.log(`📦 [Agent ${agentId}] Using cached tools`);
                return JSON.parse(cachedTools);
            }

            // Load from MongoDB
            const toolDocs = await ToolSchema.findActiveToolsForAgent(agentId);
            const tools = toolDocs.map(doc => doc.toolDefinition);
            
            console.log(`✅ [Agent ${agentId}] Loaded ${tools.length} tools from MongoDB`);

            // Cache for future use (1 hour TTL)
            await redisClient.setEx(cacheKey, 3600, JSON.stringify(tools));

            return tools;

        } catch (error) {
            console.error(`❌ [Agent ${agentId}] Error loading tools:`, error.message);
            return []; // Return empty array as fallback
        }
    }

    /**
     * Get tools configuration for OpenAI API (dynamic from MongoDB)
     */
    async getTools(agentId) {
        if (agentId) {
            return await this.loadAgentTools(agentId);
        }
        
        return []; // No fallback tools
    }

    /**
     * Reconstruct user message in JSON format (consistent with new messages)
     * @param {Object} msg - Message object from MongoDB
     * @param {Object} conversation - Conversation context
     * @returns {string} JSON string in same format as new messages
     */
    reconstructUserMessageAsJSON(msg, conversation) {
        const moment = require('moment-timezone');
        
        // Reconstruct content
        let content = '';
        if (Array.isArray(msg.content)) {
            content = msg.content
                .sort((a, b) => a.order - b.order)
                .map(chunk => chunk.content)
                .join('');
        } else {
            content = msg.content || '';
        }

        // Reconstruct audio transcription
        let audioTranscription = '';
        if (msg.audioTranscription && msg.audioTranscription.text) {
            if (Array.isArray(msg.audioTranscription.text)) {
                audioTranscription = msg.audioTranscription.text.map(chunk => chunk.content).join('');
            } else if (typeof msg.audioTranscription.text === 'object' && msg.audioTranscription.text.content) {
                audioTranscription = msg.audioTranscription.text.content;
            } else {
                audioTranscription = msg.audioTranscription.text || '';
            }
        }

        // Convert UTC timestamp to Argentina timezone
        const argentinaTimestamp = msg.timestamp 
            ? moment(msg.timestamp).tz('America/Argentina/Buenos_Aires').format()
            : moment().tz('America/Argentina/Buenos_Aires').format();

        // Reconstruct in same JSON format as new messages
        const reconstructedJSON = {
            messages: [{
                timestamp: argentinaTimestamp, // Argentina timezone instead of UTC
                type: msg.type || 'chat',
                content: content,
                audio_transcription: audioTranscription,
                quoted_message: msg.quotedMessage || {},
                media_name: msg.media?.filename || null,
                sender: msg.sender,
                message_id: msg.msg_foreign_id || msg._id.toString(),
                fileStorage: msg.fileStorage || { status: 'not_applicable' }
            }],
            system_message: JSON.stringify({
                conversation_context: {
                    participantName: conversation.participantName || "Unknown"
                }
            })
        };

        return JSON.stringify(reconstructedJSON);
    }

    /**
     * Reconstruct assistant message in JSON format (consistent with response schema)
     * @param {Object} msg - Assistant message object from MongoDB
     * @returns {string} JSON string with assistant response structure
     */
    reconstructAssistantMessageAsJSON(msg) {
        const moment = require('moment-timezone');
        
        // Reconstruct content
        let messageContent = '';
        if (Array.isArray(msg.content)) {
            messageContent = msg.content
                .sort((a, b) => a.order - b.order)
                .map(chunk => chunk.content)
                .join('');
        } else {
            messageContent = msg.content || '';
        }

        // Parse ai_system_message if available
        let aiSystemMessage = {};
        try {
            if (msg.aiSystemMessage) {
                if (typeof msg.aiSystemMessage === 'string') {
                    aiSystemMessage = JSON.parse(msg.aiSystemMessage);
                } else {
                    aiSystemMessage = msg.aiSystemMessage;
                }
            }
        } catch (e) {
            // Fallback if parsing fails
            aiSystemMessage = {
                lead_info: { full_name: "", phone: "", email: "", company: "", interest: "", notes: "" },
                current_flow: { status: "delivering_results" },
                image_processing: { active_requests: "0", last_request_id: "", processing_type: "" }
            };
        }

        // Convert UTC timestamp to Argentina timezone
        const argentinaTimestamp = msg.timestamp 
            ? moment(msg.timestamp).tz('America/Argentina/Buenos_Aires').format()
            : moment().tz('America/Argentina/Buenos_Aires').format();

        // Reconstruct in response schema format
        const reconstructedResponse = {
            timestamp: argentinaTimestamp, // Argentina timezone instead of UTC
            thinking: msg.thinking || "Historical message context",
            response: {
                recipient: msg.recipient || "user",
                message: messageContent
            },
            ai_system_message: aiSystemMessage
        };

        return JSON.stringify(reconstructedResponse);
    }

    /**
     * Format user message for API consumption (supports multimodal with images)
     */
    formatUserMessage(msg) {
        let contentParts = [];
        
        // Add Text Content (with message context for historical messages)
        let textContent = '';
        if (Array.isArray(msg.content)) {
            textContent = msg.content
                .sort((a, b) => a.order - b.order)
                .map(chunk => chunk.content)
                .join('');
        } else {
            textContent = msg.content || '';
        }

        // Include audio transcription if available and not empty
        if (msg.audioTranscription && msg.audioTranscription.text) {
            const transcription = Array.isArray(msg.audioTranscription.text) 
                ? msg.audioTranscription.text.map(chunk => chunk.content).join('')
                : msg.audioTranscription.text.content || msg.audioTranscription.text;
            
            // Only add if transcription has actual content
            if (transcription && transcription.trim().length > 0) {
                textContent += `\n[Audio transcription: ${transcription}]`;
            }
        }

        // For historical messages with images, include message metadata
        if (msg.fileStorage && msg.fileStorage.status === 'success' && msg.fileStorage.fileId) {
            // Add message metadata for context
            textContent += `\n[Message type: ${msg.type || 'image'}, Timestamp: ${msg.timestamp ? msg.timestamp.toISOString() : 'unknown'}]`;
        }
        
        if (textContent && textContent.trim()) {
            contentParts.push({ type: 'text', text: textContent });
        }

        // Add Image Content if available and successful
        if (msg.fileStorage && msg.fileStorage.status === 'success' && msg.fileStorage.fileId) {
            const imageUrl = createExternalDownloadUrl(msg.fileStorage.fileId);
            contentParts.push({
                type: 'image_url',
                image_url: {
                    url: imageUrl,
                },
            });
            console.log(`🖼️ [Historical Image] Attaching image to message: ${imageUrl}`);
        }
        
        // If only text was present, return a simple string for efficiency
        if (contentParts.length === 1 && contentParts[0].type === 'text') {
            return contentParts[0].text;
        }

        // If no content at all, return empty string
        if (contentParts.length === 0) {
            return "";
        }

        return contentParts;
    }

    /**
     * Format assistant message for API consumption
     */
    formatAssistantMessage(msg) {
        if (Array.isArray(msg.content)) {
            return msg.content
                .sort((a, b) => a.order - b.order)
                .map(chunk => chunk.content)
                .join('');
        }
        return msg.content || '';
    }

}

module.exports = ResponsesClient;
