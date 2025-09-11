const ToolBase = require('../toolBase');
const requestManager = require('../../../modules/requestManager');

class CancelRequestTool extends ToolBase {
    constructor() {
        super('cancelRequest');
    }

    async validateArgs(parsedArgs) {
        if (!parsedArgs.requestId || typeof parsedArgs.requestId !== 'string') {
            throw new Error('requestId is required and must be a string');
        }
        return true;
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`❌ Cancelling request ${parsedArgs.requestId}`);
        return await requestManager.cancelRequest(parsedArgs.requestId);
    }
}

module.exports = CancelRequestTool;
