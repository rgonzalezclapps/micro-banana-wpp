/**
 * modules/openaiIntegration.js
 * 
 * Description: Clean OpenAI integration using Responses API with MongoDB configuration
 * 
 * Role in the system: Simple wrapper around ResponsesClient with tool execution delegation
 * 
 * Node.js Context: Module - AI processing coordination
 * 
 * Dependencies:
 * - modules/responsesClient.js (Responses API client)
 * - modules/requestManager.js (Image processing tools)
 * 
 * Dependants:
 * - modules/messageQueue.js (Message processing pipeline)
 */

const ResponsesClient = require('./responsesClient');
const requestManager = require('./requestManager');

class OpenAIIntegration {
    constructor() {
        this.responsesClient = new ResponsesClient();
    }

    /**
     * Main entry point for processing conversation messages
     * Replaces: createThread, runAssistant, waitForRunCompletion workflow
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} message - User message to process
     * @returns {Object} AI response with tool results
     */
    async processConversationMessage(conversationId, message, abortController = null) {
        console.log(`🤖 [${conversationId}] Processing message with Responses API`);

        try {
            // Process using ResponsesClient (handles streaming, tools, schema from MongoDB)
            // ⭐ Pass abortController for cancellation capability
            const result = await this.responsesClient.generateResponse(conversationId, message, abortController);

            console.log(`✅ [${conversationId}] Message processed successfully`, {
                hasTools: result.hasTools,
                toolCount: result.toolCalls.length,
                responseLength: result.content?.length || 0,
                aborted: result.aborted || false
            });

            return {
                type: "message",
                content: result.content,
                toolCalls: result.toolCalls || [],      // Original OpenAI tool calls
                toolResults: result.toolResults || [],  // Tool execution results
                hasTools: result.hasTools || false,     // Whether tools were used
                aborted: result.aborted || false,       // ⭐ NEW: Whether request was aborted
                tokens: result.tokens || {},            // ⭐ NEW: Token usage data
                openaiResponseId: result.openaiResponseId,  // ⭐ NEW: OpenAI response ID
                finishReason: result.finishReason,      // ⭐ NEW: Finish reason
                messagesToQuote: [] // Not used in Responses API
            };
                            
                        } catch (error) {
            console.error(`❌ [${conversationId}] Error processing message:`, error.message);
            throw new Error(`AI processing failed: ${error.message}`);
        }
    }
}

const openAIIntegration = new OpenAIIntegration();

module.exports = openAIIntegration;
