const { OpenAI } = require("openai");
// Healthcare-specific tools removed for generic chatbot engine
// TODO: Add generic chatbot tools here if needed

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
                console.log(
                    "Message to add:",
                    JSON.stringify(message, null, 2)
                );
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

            console.log("msg", msg);

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
        for (const toolCall of toolCalls) {
            const {
                id,
                function: { name, arguments: args },
            } = toolCall;
            let output;

            console.log(
                `Executing function ${name} for conversation ${conversationId}`
            );

            // Execute the appropriate function based on the name
            switch (name) {
                // TODO: Add generic chatbot functions here as needed
                default:
                    console.log(`Function call not implemented in generic mode: ${name}`);
                    output = { 
                        status: "not_implemented", 
                        message: `Function ${name} is not available in this generic chatbot configuration`,
                        function_name: name,
                        args: JSON.parse(args)
                    };
            }

            toolOutputs.push({
                tool_call_id: id,
                output: JSON.stringify(output),
            });
        }
        return toolOutputs;
    }
}

const openAIIntegration = new OpenAIIntegration();

module.exports = openAIIntegration;
