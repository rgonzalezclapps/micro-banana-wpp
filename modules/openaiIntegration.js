const { OpenAI } = require("openai");
const requestManager = require('./requestManager');
const Conversation = require('../models/Conversation');
const { Agent } = require('../models');
const ultramsgService = require('../services/ultramsgService');

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

    /**
     * Send immediate message to user via UltraMsg before processing begins
     * @param {string} conversationId - MongoDB conversation ID
     * @param {string} messageText - Message text to send (supports basic markdown)
     * @returns {Promise<Object>} Send result from UltraMsg
     */
    async sendImmediateMessageToUser(conversationId, messageText) {
        console.log(`📤 Sending immediate message to user in conversation: ${conversationId}`);
        
        try {
            // Resolve conversation data
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            // Resolve agent data  
            const agent = await Agent.findByPk(conversation.agentId);
            if (!agent) {
                throw new Error(`Agent not found: ${conversation.agentId}`);
            }
            
            // Validate UltraMsg credentials
            if (!agent.instanceId || !agent.token) {
                throw new Error(`Agent ${agent.id} missing UltraMsg credentials (instanceId: ${!!agent.instanceId}, token: ${!!agent.token})`);
            }
            
            // Validate phone number
            if (!conversation.phoneNumber || conversation.phoneNumber.trim().length === 0) {
                throw new Error(`Invalid phone number for conversation ${conversationId}: ${conversation.phoneNumber}`);
            }
            
            console.log(`📱 Sending via UltraMsg to ${conversation.phoneNumber} using agent ${agent.name} (ID: ${agent.id})`);
            
            // Send message via UltraMsg
            const result = await ultramsgService.sendUltraMsg(
                agent, 
                conversation.phoneNumber, 
                messageText.trim()
            );
            
            if (result.sent !== 'true') {
                throw new Error(`UltraMsg send failed: ${result.message || 'Unknown error'}`);
            }
            
            console.log(`✅ Immediate message sent successfully to ${conversation.phoneNumber}:`, {
                messageLength: messageText.length,
                agentId: agent.id,
                responseId: result.data?.id || 'N/A'
            });
            
            return result;
            
        } catch (error) {
            console.error(`❌ Failed to send immediate message to user:`, {
                conversationId,
                error: error.message,
                messagePreview: messageText.substring(0, 50) + (messageText.length > 50 ? '...' : '')
            });
            throw error;
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
                        
                        // 🚀 NEW FEATURE: Send immediate message to user if provided
                        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
                            try {
                                console.log(`📤 Sending immediate message before processing: "${parsedArgs.messageToUser.substring(0, 100)}${parsedArgs.messageToUser.length > 100 ? '...' : ''}"`);
                                await this.sendImmediateMessageToUser(
                                    conversationId, 
                                    parsedArgs.messageToUser.trim()
                                );
                            } catch (messageError) {
                                // Non-blocking: Log error but continue with processing
                                console.error(`⚠️ Failed to send immediate message (non-blocking):`, {
                                    error: messageError.message,
                                    requestId: parsedArgs.requestId,
                                    conversationId
                                });
                                // Continue with processing - don't fail the entire request
                            }
                        }
                        
                        // Continue with normal processing
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
                    // Payment System - MercadoPago Integration
                    // ============================================================================

                    case "createTopupLink":
                        console.log(`💳 Creating MercadoPago topup link for conversation ${conversationId}`);
                        
                        // 🚀 NEW FEATURE: Send immediate message to user if provided
                        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
                            try {
                                console.log(`📤 Sending immediate message before payment link creation: "${parsedArgs.messageToUser.substring(0, 100)}${parsedArgs.messageToUser.length > 100 ? '...' : ''}"`);
                                await this.sendImmediateMessageToUser(
                                    conversationId, 
                                    parsedArgs.messageToUser.trim()
                                );
                            } catch (messageError) {
                                // Non-blocking: Log error but continue with payment processing
                                console.error(`⚠️ Failed to send immediate message (non-blocking):`, {
                                    error: messageError.message,
                                    conversationId,
                                    paymentContext: 'createTopupLink'
                                });
                                // Continue with payment processing - don't fail the entire request
                            }
                        }
                        
                        try {
                            const mercadopagoService = require('../services/mercadopagoService');
                            const { Payment, Participant } = require('../models');
                            
                            // Find participant by conversation
                            const conversation = await Conversation.findById(conversationId);
                            if (!conversation) {
                                throw new Error('Conversation not found');
                            }
                            
                            const participant = await Participant.findByPk(conversation.participantId);
                            if (!participant) {
                                throw new Error('Participant not found');
                            }
                            
                            // Validate input parameters
                            const { amount_ars, credits, note, idempotencyKey } = parsedArgs;
                            
                            if (!amount_ars || !credits || !idempotencyKey) {
                                throw new Error('Missing required parameters: amount_ars, credits, and idempotencyKey are required');
                            }
                            
                            // Validate 1:1 conversion
                            if (amount_ars !== credits) {
                                throw new Error('amount_ars and credits must be equal (1 ARS = 1 credit)');
                            }
                            
                            // Check for duplicate idempotency key
                            const existingPayment = await Payment.findOne({
                                where: { idempotencyKey: idempotencyKey }
                            });
                            
                            if (existingPayment) {
                                // Return existing payment link if already created
                                output = {
                                    success: true,
                                    duplicate: true,
                                    message: "Link de pago ya generado con este ID",
                                    payment_id: existingPayment.id,
                                    status: existingPayment.status
                                };
                                break;
                            }
                            
                            // Create payment record in 'new' status
                            const payment = await Payment.create({
                                participantId: participant.id,
                                amount: amount_ars,
                                credits: credits,
                                note: note || `Recarga de ${credits} créditos`,
                                idempotencyKey: idempotencyKey,
                                status: 'new'
                            });
                            
                            console.log(`💾 Payment created in database:`, {
                                paymentId: payment.id,
                                participantId: participant.id,
                                amount: payment.amount,
                                credits: payment.credits
                            });
                            
                            // Create MercadoPago preference
                            const topupResult = await mercadopagoService.createTopupLink({
                                amount_ars: amount_ars,
                                credits: credits,
                                note: note,
                                idempotencyKey: idempotencyKey,
                                participantId: participant.id
                            });
                            
                            if (topupResult.error) {
                                // Update payment status to reflect error
                                await payment.update({ 
                                    status: 'rejected',
                                    metadata: { error: topupResult.details }
                                });
                                
                                output = {
                                    success: false,
                                    error: topupResult.message,
                                    payment_id: payment.id
                                };
                            } else {
                                // Update payment with MercadoPago data and set to 'pending'
                                await payment.update({
                                    status: 'pending',
                                    mp_preference_id: topupResult.preference_id,
                                    external_reference: topupResult.external_reference,
                                    metadata: { 
                                        mp_response: topupResult,
                                        created_at: new Date()
                                    }
                                });
                                
                                console.log(`✅ MercadoPago preference created successfully:`, {
                                    preferenceId: topupResult.preference_id,
                                    externalReference: topupResult.external_reference
                                });
                                
                                output = {
                                    success: true,
                                    payment_link: topupResult.init_point,
                                    payment_id: payment.id,
                                    preference_id: topupResult.preference_id,
                                    external_reference: topupResult.external_reference,
                                    amount_ars: amount_ars,
                                    credits: credits,
                                    message: `Link de pago generado exitosamente. El usuario recibirá ${credits} créditos al completar el pago de $${amount_ars} ARS.`
                                };
                            }
                            
                        } catch (error) {
                            console.error(`❌ Error creating topup link:`, error);
                            output = {
                                success: false,
                                error: error.message,
                                message: "Error al generar link de pago. Por favor intenta nuevamente."
                            };
                        }
                        break;

                    // ============================================================================
                    // Credit Balance Query - Check User Credits  
                    // ============================================================================

                    case "check_credits":
                    case "checkCredits":
                        console.log(`💰 Checking credit balance for conversation ${conversationId}`);
                        
                        // 🚀 NEW FEATURE: Send immediate message to user if provided
                        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
                            try {
                                console.log(`📤 Sending immediate message before credit check: "${parsedArgs.messageToUser.substring(0, 100)}${parsedArgs.messageToUser.length > 100 ? '...' : ''}"`);
                                await this.sendImmediateMessageToUser(
                                    conversationId, 
                                    parsedArgs.messageToUser.trim()
                                );
                            } catch (messageError) {
                                // Non-blocking: Log error but continue with credit check
                                console.error(`⚠️ Failed to send immediate message (non-blocking):`, {
                                    error: messageError.message,
                                    conversationId,
                                    creditContext: 'checkCredits'
                                });
                                // Continue with credit check - don't fail the entire request
                            }
                        }
                        
                        try {
                            const { Participant } = require('../models');
                            
                            // Find participant by conversation
                            const conversation = await Conversation.findById(conversationId);
                            if (!conversation) {
                                throw new Error('Conversation not found');
                            }
                            
                            const participant = await Participant.findByPk(conversation.participantId);
                            if (!participant) {
                                throw new Error('Participant not found');
                            }
                            
                            console.log(`💰 Credit balance query for participant ${participant.id}:`, {
                                participantId: participant.id,
                                name: participant.name,
                                phoneNumber: participant.phoneNumber,
                                currentBalance: participant.creditBalance
                            });
                            
                            output = {
                                success: true,
                                participant_id: participant.id,
                                name: participant.name,
                                phone_number: participant.phoneNumber,
                                credit_balance: participant.creditBalance,
                                formatted_balance: `${participant.creditBalance.toLocaleString('es-AR')} créditos`,
                                message: `Balance actual: ${participant.creditBalance.toLocaleString('es-AR')} créditos disponibles`
                            };
                            
                        } catch (error) {
                            console.error('❌ Error checking credit balance:', error);
                            
                            output = {
                                success: false,
                                error: error.message || 'Error checking credit balance',
                                credit_balance: 0,
                                message: 'No se pudo consultar el balance de créditos'
                            };
                        }
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
        
        // 🚨 CRITICAL FIX: Log tool calls in message.functionCalls for official tracking
        try {
            await this.logToolCallsToConversation(conversationId, toolCalls, toolOutputs);
        } catch (loggingError) {
            // Non-blocking: Log error but don't fail the entire tool execution
            console.error(`⚠️ Failed to log tool calls to conversation (non-blocking):`, {
                conversationId,
                error: loggingError.message,
                toolCallCount: toolCalls.length
            });
        }
        
        return toolOutputs;
    }

    /**
     * Log executed tool calls to conversation message.functionCalls for official tracking
     * @param {string} conversationId - MongoDB conversation ID
     * @param {Array} toolCalls - Original tool calls from OpenAI
     * @param {Array} toolOutputs - Executed tool outputs
     * @returns {Promise<void>}
     */
    async logToolCallsToConversation(conversationId, toolCalls, toolOutputs) {
        console.log(`📝 Logging ${toolCalls.length} tool calls to conversation: ${conversationId}`);
        
        try {
            // Find the conversation
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error(`Conversation not found: ${conversationId}`);
            }
            
            if (!conversation.messages || conversation.messages.length === 0) {
                throw new Error(`No messages found in conversation: ${conversationId}`);
            }
            
            // Find the most recent user message to attach function calls
            // This should be the message that triggered the AI response with tool calls
            let targetMessage = null;
            for (let i = conversation.messages.length - 1; i >= 0; i--) {
                const msg = conversation.messages[i];
                if (msg.sender === 'user') {
                    targetMessage = msg;
                    break;
                }
            }
            
            if (!targetMessage) {
                // Fallback: use the most recent message
                targetMessage = conversation.messages[conversation.messages.length - 1];
                console.log(`⚠️ No user message found, using most recent message (sender: ${targetMessage.sender})`);
            }
            
            // Initialize functionCalls array if it doesn't exist
            if (!targetMessage.functionCalls) {
                targetMessage.functionCalls = [];
            }
            
            // Process each tool call
            for (let i = 0; i < toolCalls.length; i++) {
                const toolCall = toolCalls[i];
                const toolOutput = toolOutputs[i];
                
                try {
                    const parsedArgs = JSON.parse(toolCall.function.arguments);
                    const parsedOutput = JSON.parse(toolOutput.output);
                    
                    // Create function call record according to schema
                    const functionCallRecord = {
                        type: 'function', // Default per schema
                        name: toolCall.function.name,
                        parameters: parsedArgs, // Original parameters sent to function
                        updates: [parsedOutput] // Array of execution results
                    };
                    
                    // Add to message functionCalls array
                    targetMessage.functionCalls.push(functionCallRecord);
                    
                    console.log(`📝 Logged tool call: ${toolCall.function.name} with ${Object.keys(parsedArgs).length} parameters`);
                    
                } catch (parseError) {
                    console.error(`❌ Failed to parse tool call ${i}:`, {
                        toolName: toolCall.function.name,
                        error: parseError.message
                    });
                    
                    // Still log what we can
                    const fallbackRecord = {
                        type: 'function',
                        name: toolCall.function.name,
                        parameters: { error: 'Failed to parse arguments', raw: toolCall.function.arguments },
                        updates: [{ error: 'Failed to parse output', raw: toolOutput.output }]
                    };
                    
                    targetMessage.functionCalls.push(fallbackRecord);
                }
            }
            
            // Save the updated conversation
            await conversation.save();
            
            console.log(`✅ Successfully logged ${toolCalls.length} tool calls to message in conversation ${conversationId}:`, {
                messageTimestamp: targetMessage.timestamp,
                messageSender: targetMessage.sender,
                totalFunctionCalls: targetMessage.functionCalls.length
            });
            
        } catch (error) {
            console.error(`❌ Error logging tool calls to conversation:`, {
                conversationId,
                error: error.message,
                toolCallCount: toolCalls.length
            });
            throw error;
        }
    }
}

const openAIIntegration = new OpenAIIntegration();

module.exports = openAIIntegration;
