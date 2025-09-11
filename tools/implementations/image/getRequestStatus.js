/**
 * tools/implementations/image/getRequestStatus.js
 * 
 * Description: Implementation of getRequestStatus tool for querying request status
 */

const ToolBase = require('../toolBase');
const requestManager = require('../../../modules/requestManager');

class GetRequestStatusTool extends ToolBase {
    constructor() {
        super('getRequestStatus');
    }

    async validateArgs(parsedArgs) {
        if (!parsedArgs.requestId || typeof parsedArgs.requestId !== 'string') {
            throw new Error('requestId is required and must be a string');
        }
        return true;
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`📊 Getting status for request ${parsedArgs.requestId}`);
        
        const result = await requestManager.getRequestStatus(parsedArgs.requestId);
        return result;
    }
}

module.exports = GetRequestStatusTool;
