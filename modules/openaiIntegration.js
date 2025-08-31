const { OpenAI } = require("openai");
const requestManager = require('./requestManager');
const Conversation = require('../models/Conversation');

class OpenAIIntegration {
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    async createThread() {
        try {
            const thread = await this.openai.beta.threads.create();
            console.log("New OpenAI thread created:", thread.id);
            return thread;
        } catch (error) {
            console.error("Error creating thread:", error.message);
            throw new Error("Failed to create OpenAI thread");
        }
    }

    async addMessageToThread(threadId, message) {
        try {
            const parsedContent = this._safeParseJSON(message);
            const messages = this._prepareMessages(parsedContent);

            console.log(
                `Adding ${messages.length} messages to thread ${threadId}`
            );
            for (const message of messages) {
                // 🧹 CLEAN LOG: Avoid logging full message with potential blob data
                console.log("📤 Adding message to thread:", {
                    role: message.role,
                    contentLength: message.content[0]?.text?.length || 0,
                    hasContent: !!message.content[0]?.text
                });
                
                await this.openai.beta.threads.messages.create(
                    threadId,
                    message
                );
            }
            console.log("All messages added to thread successfully");
        } catch (error) {
            console.error("Error adding message to thread:", error);
            throw error;
        }
    }

    async runAssistant(assistantId, threadId) {
        try {
            console.log(
                `Running assistant with ID: ${assistantId} for thread: ${threadId}`
            );
            const run = await this.openai.beta.threads.runs.create(threadId, {
                assistant_id: assistantId,
            });
            console.log(`Assistant run created: ${run.id}`);
            return run;
        } catch (error) {
            console.error("Error running assistant:", error);
            throw error;
        }
    }

    async waitForRunCompletion(runId, threadId, conversationId) {
        let run;
        let messagesToQuote = [];
        let toolResults = [];
        let checkCount = 0;
        const maxChecks = 80;
        do {
            checkCount++;
            console.log(
                `[Check #${checkCount}] Checking run status for runId: ${runId}, threadId: ${threadId}, conversationId: ${conversationId}`
            );

            try {
                run = await this.getRunStatus(threadId, runId);
                console.log(`--- Run status: ${run.status}`);

                if (run.status === "completed") {
                    const messages = await this.getMessages(threadId);
                    const lastMessage = messages.data[0];

                    return {
                        type: "message",
                        content: lastMessage.content[0].text.value,
                        messagesToQuote: messagesToQuote,
                        toolResults: toolResults
                    };
                } else if (run.status === "requires_action") {
                    console.log(
                        `[Check #${checkCount}] Run requires action for runId: ${runId}, threadId: ${threadId}`
                    );
                    const toolCalls =
                        run.required_action.submit_tool_outputs.tool_calls;
                    console.log("toolCalls", toolCalls);
                    let toolOutputs = await this.executeToolCalls(
                        toolCalls,
                        conversationId
                    );

                    toolResults = toolResults.concat(
                        toolOutputs.map(output => {
                            const parsedOutput = JSON.parse(output.output);
                            return {
                                tool_call_id: output.tool_call_id,
                                ...parsedOutput
                            };
                        })
                    );

                    messagesToQuote = toolOutputs.reduce((acc, output) => {
                        console.log("output", output);
                        const parsedOutput = JSON.parse(output.output);
                        if (
                            parsedOutput.message_id ||
                            parsedOutput.referenced_message_id
                        ) {
                            acc.push(
                                parsedOutput.message_id ||
                                    parsedOutput.referenced_message_id
                            );
                        }
                        return acc;
                    }, []);
                    toolOutputs = toolOutputs.map(
                        ({ message_id, referenced_message_id, ...rest }) => rest
                    );

                    console.log("toolOutputs", toolOutputs);
                    await this.submitToolOutputs(threadId, runId, toolOutputs);
                    // After submitting tool outputs, continue the loop to check the updated run status
                } else if (run.status === "failed") {
                    console.error(
                        `[Check #${checkCount}] Run failed for runId: ${runId}, threadId: ${threadId}`
                    );
                    throw new Error("Assistant run failed");
                }
                if (run.status !== "completed" && run.status !== "failed") {
                    console.log(
                        `[Check #${checkCount}] Run status: ${run.status}. Waiting before next check...`
                    );
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(
                    `Error checking run status (attempt ${checkCount}):`,
                    error
                );
                if (checkCount >= maxChecks) {
                    throw new Error(
                        `Max check attempts reached for runId: ${runId}, threadId: ${threadId}`
                    );
                }
                await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds before retrying
            }
        } while (
            run.status !== "completed" &&
            run.status !== "failed" &&
            checkCount < maxChecks
        );
    }

    async submitToolOutputs(threadId, runId, toolOutputs) {
        try {
            const run = await this.openai.beta.threads.runs.submitToolOutputs(
                threadId,
                runId,
                {
                    tool_outputs: toolOutputs,
                }
            );
            return run;
        } catch (error) {
            console.error("Error submitting tool outputs:", error);
            throw error;
        }
    }

    async getRunStatus(threadId, runId) {
        try {
            const run = await this.openai.beta.threads.runs.retrieve(
                threadId,
                runId
            );
            return run;
        } catch (error) {
            console.error("Error getting run status:", error);
            throw error;
        }
    }

    async getMessages(threadId) {
        try {
            const messages = await this.openai.beta.threads.messages.list(
                threadId
            );
            return messages;
        } catch (error) {
            console.error("Error getting messages:", error);
            throw error;
        }
    }

    _prepareMessages(parsedContent) {
        return parsedContent.messages.map((msg) => {
            const rebuiltContent = this._rebuildContent(msg.content);
            const rebuiltAudioTranscription = msg.audio_transcription || "";
            const rebuiltQuotedMessage = msg.quoted_message
                ? JSON.stringify(msg.quoted_message)
                : null;

            // 🔧 DIAGNOSTIC LOG: Verify fileStorage inclusion
            console.log("🔍 DIAGNOSTIC - Message preparation for OpenAI:", {
                messageId: msg.message_id,
                hasFileStorage: !!msg.fileStorage,
                fileStorageStatus: msg.fileStorage?.status || 'none',
                fileStorageFileId: msg.fileStorage?.fileId || 'none'
            });

            return {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            messages: [
                                {
                                    timestamp: msg.timestamp,
                                    type: msg.type,
                                    content: rebuiltContent,
                                    audio_transcription:
                                        rebuiltAudioTranscription,
                                    quoted_message: rebuiltQuotedMessage,
                                    media_name: msg.media_name || null,
                                    sender: msg.sender,
                                    message_id: msg.message_id,
                                    // 🔧 CRITICAL FIX: Include fileStorage for AI tools
                                    fileStorage: msg.fileStorage || { status: 'not_applicable' }
                                },
                            ],
                            system_message: parsedContent.system_message,
                        }),
                    },
                ],
            };
        });
    }

    // Removed Botmaker-specific message preparation

    _rebuildContent(content) {
        if (Array.isArray(content)) {
            return content
                .sort((a, b) => a.order - b.order)
                .map((chunk) => chunk.content)
                .join("");
        }
        return content || "";
    }

    _safeParseJSON(content) {
        try {
            return JSON.parse(content);
        } catch (error) {
            console.error("Error parsing JSON content:", error);
            throw new Error(
                "Invalid JSON content provided to OpenAI integration"
            );
        }
    }

    async executeToolCalls(toolCalls, conversationId) {
        console.log("Executing tool calls for conversation:", conversationId);
        const toolOutputs = [];
        
        // Get conversation details for participant info
        const conversation = await Conversation.findById(conversationId);
        const participantId = conversation ? conversation.participantId : null;
        const participantName = conversation ? conversation.participantName : 'Unknown';
        
        for (const toolCall of toolCalls) {
            const {
                id,
                function: { name, arguments: args },
            } = toolCall;
            let output;

            console.log(
                `🔧 Executing function ${name} for conversation ${conversationId}`
            );

            try {
                const parsedArgs = JSON.parse(args);

                // Execute the appropriate function based on the name
                switch (name) {
                    // ============================================================================
                    // Request Management Tools - Parallel image processing with Google Gemini
                    // ============================================================================

                    case "newRequest":
                        console.log(`📋 Creating new request with system prompt: "${parsedArgs.systemPrompt?.substring(0, 100)}..."`);
                        
                        output = await requestManager.createNewRequest(
                            conversationId,
                            participantId,
                            participantName,
                            parsedArgs.systemPrompt,
                            parsedArgs.initialImages || [],
                            parsedArgs.requestType || 'image_processing'
                        );
                        break;

                    case "updateRequest":
                        console.log(`🔄 Updating request ${parsedArgs.requestId} with ${parsedArgs.newImages?.length || 0} new images`);
                        
                        output = await requestManager.updateRequest(
                            parsedArgs.requestId,
                            parsedArgs.newImages || [],
                            parsedArgs.instructions || ''
                        );
                        break;

                    case "processRequest":
                        console.log(`⚡ Processing request ${parsedArgs.requestId} with Google Gemini`);
                        
                        output = await requestManager.processRequest(
                            parsedArgs.requestId,
                            parsedArgs.finalPrompt || ''
                        );
                        break;

                    // ============================================================================
                    // Request Query Tools (Optional/Helper tools)
                    // ============================================================================

                    case "getRequestStatus":
                        console.log(`📊 Getting status for request ${parsedArgs.requestId}`);
                        
                        output = await requestManager.getRequestStatus(parsedArgs.requestId);
                        break;

                    case "listActiveRequests":
                        console.log(`📋 Listing active requests for conversation ${conversationId}`);
                        
                        output = await requestManager.listActiveRequests(conversationId);
                        break;

                    case "cancelRequest":
                        console.log(`❌ Cancelling request ${parsedArgs.requestId}`);
                        
                        output = await requestManager.cancelRequest(parsedArgs.requestId);
                        break;

                    // ============================================================================
                    // Default case for unimplemented functions
                    // ============================================================================
                    
                    default:
                        console.log(`❓ Function call not implemented: ${name}`);
                        output = { 
                            success: false,
                            status: "not_implemented", 
                            message: `Function ${name} is not available in this configuration. Available functions: newRequest, updateRequest, processRequest, getRequestStatus, listActiveRequests, cancelRequest`,
                            function_name: name,
                            args: parsedArgs
                        };
                        break;
                }

            } catch (error) {
                console.error(`❌ Error executing function ${name}:`, error.message);
                output = {
                    success: false,
                    status: "error",
                    error: error.message,
                    function_name: name
                };
            }

            // Ensure output has required structure for OpenAI
            if (!output.hasOwnProperty('success')) {
                output.success = output.status === 'completed' || output.status === 'success';
            }

            toolOutputs.push({
                tool_call_id: id,
                output: JSON.stringify(output),
            });
        }
        
        console.log(`✅ Completed ${toolOutputs.length} tool calls for conversation ${conversationId}`);
        return toolOutputs;
    }
}

const openAIIntegration = new OpenAIIntegration();

module.exports = openAIIntegration;
