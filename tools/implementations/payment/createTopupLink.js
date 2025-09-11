/**
 * tools/implementations/payment/createTopupLink.js
 * 
 * Description: Implementation of createTopupLink tool for MercadoPago payment links
 */

const ToolBase = require('../toolBase');
const db = require('../../../models'); // Import centralized models
const { Conversation, ParticipantProfile, Payment } = db; // Destructure MongoDB models

class CreateTopupLinkTool extends ToolBase {
    constructor() {
        super('createTopupLink');
    }

    async validateArgs(parsedArgs) {
        const { amount_ars, credits, note, idempotencyKey, messageToUser } = parsedArgs;
        
        if (!amount_ars || !credits || !idempotencyKey || !messageToUser) {
            throw new Error('Missing required parameters: amount_ars, credits, idempotencyKey, and messageToUser are required');
        }
        
        if (amount_ars !== credits) {
            throw new Error('amount_ars and credits must be equal (1 ARS = 1 credit)');
        }
        
        return true;
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`💳 Creating MercadoPago topup link for conversation ${conversationId}`);
        
        // Send immediate message to user if provided
        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
            try {
                console.log(`📤 Sending immediate message before payment link creation: "${parsedArgs.messageToUser.substring(0, 100)}${parsedArgs.messageToUser.length > 100 ? '...' : ''}"`);
                
                // Get responsesClient instance to send immediate message
                const ResponsesClient = require('../../../modules/responsesClient');
                const responsesClient = new ResponsesClient();
                await responsesClient.sendImmediateMessageToUser(conversationId, parsedArgs.messageToUser.trim());
            } catch (messageError) {
                console.error(`⚠️ Failed to send immediate message (non-blocking):`, {
                    error: messageError.message,
                    conversationId,
                    paymentContext: 'createTopupLink'
                });
            }
        }
        
        try {
            const mercadopagoService = require('../../../services/mercadopagoService');
            
            // Find participant by conversation
            const conversation = await Conversation.findById(conversationId);
            if (!conversation) {
                throw new Error('Conversation not found');
            }
            
            const participant = await ParticipantProfile.findByParticipantId(conversation.participantId);
            if (!participant) {
                throw new Error('Participant not found');
            }
            
            const { amount_ars, credits, note, idempotencyKey } = parsedArgs;
            
            // Check for duplicate idempotency key in MongoDB
            const existingPayment = await Payment.findByIdempotencyKey(idempotencyKey);
            
            if (existingPayment) {
                return {
                    success: true,
                    duplicate: true,
                    message: "Link de pago ya generado con este ID",
                    payment_id: existingPayment._id.toString(),
                    status: existingPayment.status
                };
            }
            
            // Create payment record in MongoDB
            const payment = new Payment({
                participantId: participant.participantId,
                amount: amount_ars,
                credits: credits,
                note: note || `Recarga de ${credits} créditos`,
                idempotencyKey: idempotencyKey,
                status: 'new'
            });
            await payment.save();
            
            console.log(`💾 Payment created in MongoDB:`, {
                paymentId: payment._id,
                participantId: participant.participantId,
                amount: payment.amount,
                credits: payment.credits
            });
            
            // Create MercadoPago preference
            const topupResult = await mercadopagoService.createTopupLink({
                amount_ars: amount_ars,
                credits: credits,
                note: note,
                idempotencyKey: idempotencyKey,
                participantId: participant.participantId
            });
            
            if (topupResult.error) {
                // Update payment status to reflect error
                payment.status = 'rejected';
                payment.metadata = { error: topupResult.details };
                await payment.save();
                
                return {
                    success: false,
                    error: topupResult.message,
                    payment_id: payment._id.toString()
                };
            } else {
                // Update payment with MercadoPago data and set to 'pending'
                payment.status = 'pending';
                payment.mpPreferenceId = topupResult.preference_id;
                payment.externalReference = topupResult.external_reference;
                payment.metadata = { 
                    mp_response: topupResult,
                    created_at: new Date()
                };
                await payment.save();
                
                console.log(`✅ MercadoPago preference created successfully:`, {
                    preferenceId: topupResult.preference_id,
                    externalReference: topupResult.external_reference
                });
                
                return {
                    success: true,
                    payment_link: topupResult.init_point,
                    payment_id: payment._id.toString(),
                    preference_id: topupResult.preference_id,
                    external_reference: topupResult.external_reference,
                    amount_ars: amount_ars,
                    credits: credits,
                    message: `Link de pago generado exitosamente. El usuario recibirá ${credits} créditos al completar el pago de $${amount_ars} ARS.`
                };
            }
            
        } catch (error) {
            console.error(`❌ Error creating topup link:`, error);
            return {
                success: false,
                error: error.message,
                message: "Error al generar link de pago. Por favor intenta nuevamente."
            };
        }
    }
}

module.exports = CreateTopupLinkTool;
