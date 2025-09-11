/**
 * tools/implementations/image/updateRequest.js
 * 
 * Description: Implementation of updateRequest tool for updating existing image processing requests
 */

const ToolBase = require('../toolBase');
const requestManager = require('../../../modules/requestManager');

class UpdateRequestTool extends ToolBase {
    constructor() {
        super('updateRequest');
    }

    async validateArgs(parsedArgs) {
        if (!parsedArgs.requestId || typeof parsedArgs.requestId !== 'string') {
            throw new Error('requestId is required and must be a string');
        }
        
        if (!Array.isArray(parsedArgs.newImages)) {
            throw new Error('newImages must be an array');
        }
        
        if (!parsedArgs.instructions || typeof parsedArgs.instructions !== 'string') {
            throw new Error('instructions is required and must be a string');
        }
        
        return true;
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`🔄 Updating request ${parsedArgs.requestId} with ${parsedArgs.newImages?.length || 0} new images`);
        
        const result = await requestManager.updateRequest(
            parsedArgs.requestId,
            parsedArgs.newImages || [],
            parsedArgs.instructions || ''
        );
        
        return result;
    }
}

module.exports = UpdateRequestTool;
