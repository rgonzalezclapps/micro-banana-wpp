const ToolBase = require('../toolBase');
const requestManager = require('../../../modules/requestManager');

class ListActiveRequestsTool extends ToolBase {
    constructor() {
        super('listActiveRequests');
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`📋 Listing active requests for conversation ${conversationId}`);
        return await requestManager.listActiveRequests(conversationId);
    }
}

module.exports = ListActiveRequestsTool;
