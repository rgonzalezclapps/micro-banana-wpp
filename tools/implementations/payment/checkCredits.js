/**
 * tools/implementations/payment/checkCredits.js
 * 
 * Description: Implementation of checkCredits tool for querying user credit balance
 * 
 * Role in the system: Provides credit balance information to users
 */

const ToolBase = require('../toolBase');
const Conversation = require('../../../models/Conversation');
const { Participant } = require('../../../models');

class CheckCreditsTool extends ToolBase {
    constructor() {
        super('checkCredits');
    }

    /**
     * Validate checkCredits arguments
     * @param {Object} parsedArgs - Tool arguments
     */
    async validateArgs(parsedArgs) {
        if (!parsedArgs.messageToUser || typeof parsedArgs.messageToUser !== 'string') {
            throw new Error('messageToUser is required and must be a string');
        }
        return true;
    }

    /**
     * Implementation of credit balance check
     * @param {Object} parsedArgs - Tool arguments
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<Object>} Credit balance result
     */
    async implementation(parsedArgs, conversationId) {
        // Send immediate message to user
        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
            try {
                console.log(`📤 [${conversationId}] Sending immediate credit check message: "${parsedArgs.messageToUser.substring(0, 50)}..."`);
                
                // Get responsesClient instance to send immediate message
                const ResponsesClient = require('../../../modules/responsesClient');
                const responsesClient = new ResponsesClient();
                await responsesClient.sendImmediateMessageToUser(conversationId, parsedArgs.messageToUser.trim());
            } catch (messageError) {
                console.error(`⚠️ [${conversationId}] Failed to send immediate message (non-blocking):`, messageError.message);
            }
        }

        // Get conversation and participant
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }

        const Participant = require('../../../models/Participant');
        const participant = await Participant.findById(conversation.participantId);
        if (!participant) {
            throw new Error('Participant not found');
        }

        // Return credit balance information
        return {
            participant_id: participant._id.toString(),
            name: participant.name,
            phone_number: participant.phoneNumber,
            credit_balance: participant.creditBalance || 0,
            formatted_balance: `${(participant.creditBalance || 0).toLocaleString('es-AR')} créditos`,
            message: `Balance actual: ${(participant.creditBalance || 0).toLocaleString('es-AR')} créditos disponibles`
        };
    }

    /**
     * Send immediate message to user (placeholder - to be implemented)
     * @param {string} conversationId - Conversation ID
     * @param {string} message - Message to send
     */
    async sendImmediateMessage(conversationId, message) {
        // TODO: Implement immediate messaging integration
        console.log(`💬 [${conversationId}] Immediate message: ${message}`);
    }
}

module.exports = CheckCreditsTool;
