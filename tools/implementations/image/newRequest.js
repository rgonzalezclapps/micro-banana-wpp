/**
 * tools/implementations/image/newRequest.js
 * 
 * Description: Implementation of newRequest tool for creating image processing requests
 */

const ToolBase = require('../toolBase');
const requestManager = require('../../../modules/requestManager');
const Conversation = require('../../../models/Conversation');

class NewRequestTool extends ToolBase {
    constructor() {
        super('newRequest');
    }

    async validateArgs(parsedArgs) {
        if (!parsedArgs.systemPrompt || typeof parsedArgs.systemPrompt !== 'string') {
            throw new Error('systemPrompt is required and must be a string');
        }
        
        if (!Array.isArray(parsedArgs.initialImages)) {
            throw new Error('initialImages must be an array');
        }
        
        if (!parsedArgs.requestType) {
            throw new Error('requestType is required');
        }
        
        return true;
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`📋 Creating new request with system prompt: "${parsedArgs.systemPrompt?.substring(0, 100)}..."`);
        console.log(`🔍 [newRequest] Received initialImages:`, {
          count: parsedArgs.initialImages?.length || 0,
          fileIds: parsedArgs.initialImages || [],
          types: (parsedArgs.initialImages || []).map(id => ({
            id: id,
            length: id.length,
            isHex: /^[a-f0-9]+$/.test(id),
            is32Chars: id.length === 32
          }))
        });
        
        // Get conversation details for participant info
        const conversation = await Conversation.findById(conversationId);
        const participantId = conversation ? conversation.participantId : null;
        const participantName = conversation ? conversation.participantName : 'Unknown';
        
        const result = await requestManager.createNewRequest(
            conversationId,
            participantId,
            participantName,
            parsedArgs.systemPrompt,
            parsedArgs.initialImages || [],
            parsedArgs.requestType || 'image_processing'
        );
        
        return result;
    }
}

module.exports = NewRequestTool;
