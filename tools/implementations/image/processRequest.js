/**
 * tools/implementations/image/processRequest.js
 * 
 * Description: Implementation of processRequest tool for executing image processing with Google Gemini
 */

const ToolBase = require('../toolBase');
const requestManager = require('../../../modules/requestManager');

class ProcessRequestTool extends ToolBase {
    constructor() {
        super('processRequest');
    }

    async validateArgs(parsedArgs) {
        if (!parsedArgs.requestId || typeof parsedArgs.requestId !== 'string') {
            throw new Error('requestId is required and must be a string');
        }
        
        if (!parsedArgs.finalPrompt || typeof parsedArgs.finalPrompt !== 'string') {
            throw new Error('finalPrompt is required and must be a string');
        }
        
        if (!parsedArgs.messageToUser || typeof parsedArgs.messageToUser !== 'string') {
            throw new Error('messageToUser is required and must be a string');
        }
        
        return true;
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`⚡ Processing request ${parsedArgs.requestId} with Google Gemini`);
        
        // Send immediate message to user if provided
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
            }
        }
        
        // Continue with normal processing
        const result = await requestManager.processRequest(
            parsedArgs.requestId,
            parsedArgs.finalPrompt || ''
        );
        
        return result;
    }

    async sendImmediateMessageToUser(conversationId, messageText) {
        // TODO: Implement immediate messaging - for now just log
        console.log(`💬 [${conversationId}] Immediate message: ${messageText}`);
    }
}

module.exports = ProcessRequestTool;
