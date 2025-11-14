/**
 * modules/conversationManager.js
 * 
 * Description: Conversation lifecycle management with separated Message collection
 * 
 * Role in the system: Handles participant resolution, conversation creation, and message storage
 * 
 * Node.js Context: Module - Conversation and participant management
 * 
 * Dependencies:
 * - models/Agent.js (MongoDB)
 * - models/Participant.js (MongoDB)
 * - models/Conversation.js (MongoDB)
 * - models/Message.js (MongoDB)
 * - utils/dbUtils.js (saveWithRetry helper)
 * 
 * Dependants:
 * - routes/webhookRoutes.js (participant and conversation resolution)
 * - modules/messageQueue.js (conversation updates)
 */

const Agent = require("../models/Agent");
const Conversation = require("../models/Conversation");
const Participant = require("../models/Participant");
const Message = require("../models/Message");
const { saveWithRetry } = require("../utils/dbUtils");
const { cacheMessage } = require("../utils/redisConversationCache"); // ⭐ NEW: Redis cache

/**
 * Get or create participant in MongoDB
 * @param {string} phoneNumber - Participant phone number
 * @param {string} pushname - Participant display name from platform
 * @returns {Promise<Object>} Participant document
 */
async function getOrCreateParticipant(phoneNumber, pushname) {
    try {
        // Direct MongoDB lookup using phone number
        let participant = await Participant.findByPhone(phoneNumber);

        if (!participant) {
            // Create new participant directly in MongoDB
            const participantData = {
                phoneNumber: phoneNumber,
                name: pushname || "Unknown",
                status: 'active',
                creditBalance: 2000,  // 2000 créditos de bienvenida
                metadata: {
                    createdVia: 'webhook'
                }
            };
            
            participant = await Participant.create(participantData);
            console.log(`✅ Created new participant: ${participant.name} (${participant.phoneNumber}) [${participant._id}]`);
        } else {
            // Update name if needed
            if (pushname && (participant.name === "Unknown" || !participant.name)) {
                participant.name = pushname;
                await participant.save();
                console.log(`✅ Updated participant name: ${participant.name} (${participant.phoneNumber})`);
            }
            console.log(`✅ Existing participant found: ${participant.name} (${participant.phoneNumber}) [${participant._id}]`);
        }

        return participant;

    } catch (error) {
        console.error('❌ Error in getOrCreateParticipant:', error);
        throw error;
    }
}

/**
 * Get or create conversation for participant and agent
 * @param {Object} participant - Participant document
 * @param {Object} agent - Agent document
 * @returns {Promise<Object>} Conversation document
 */
async function getOrCreateConversation(participant, agent) {
    // Look for existing conversation by participantId and agentId (both ObjectIds)
    let conversation = await Conversation.findOne({
        participantId: participant._id,
        agentId: agent._id
    });

    if (!conversation) {
        // Create new conversation document
        conversation = new Conversation({
            participantId: participant._id,
            phoneNumber: participant.phoneNumber,
            participantName: participant.name,
            agentId: agent._id,
            agentName: agent.name,
            messageCount: 0,
            lastMessage: null,
            lastMessageTime: new Date(),
            lastMessageSender: {
                role: 'user',
                name: participant.name || 'User'
            },
            unreadCount: 0,
            status: "active"
        });

        await saveWithRetry(conversation, 3);
        console.log("✅ New conversation created:", conversation._id);
    } else {
        console.log("✅ Existing conversation found:", conversation._id);
    }

    return conversation;
}

/**
 * Update conversation data and save message to separate Message collection
 * @param {Object} conversation - Conversation document
 * @param {Object} messageData - Message data to save
 * @param {Object} agent - Agent document
 * @param {Object} participant - Participant document
 * @returns {Promise<Object>} Updated conversation document
 */
async function updateConversationData(conversation, messageData, agent, participant) {
    try {
        // === CRITICAL CHANGE: Save message to separate Message collection ===
        const message = new Message({
            conversationId: conversation._id,
            ...messageData,
            timestamp: messageData.timestamp || new Date()
        });
        
        await message.save();
        console.log(`✅ Message saved to Message collection: ${message._id}`);

        // ====================================================================
        // ⭐ CACHE MESSAGE IN REDIS (for sub-ms access)
        // ====================================================================
        // Non-blocking - if Redis fails, MongoDB is still authoritative
        cacheMessage(conversation._id.toString(), message).catch(err => {
            console.warn(`⚠️ Failed to cache message in Redis (non-blocking):`, err.message);
        });

        // === Update conversation metadata ===
        conversation.messageCount = (conversation.messageCount || 0) + 1;
        
        conversation.lastMessage = messageData.content?.map 
            ? messageData.content.map(chunk => chunk.content).join("") 
            : messageData.content;
        conversation.lastMessageTime = new Date();
        
        // Properly construct lastMessageSender object
        conversation.lastMessageSender = {
            role: messageData.sender, // "user", "ai_agent", etc.
            name: messageData.sender === 'user' 
                ? (participant.name || 'User')
                : (agent.name || 'AI Agent')
        };
        
        // Update participant name if provided
        if (participant.name && participant.name !== "Unknown") {
            conversation.participantName = participant.name;
        }

        // Handle unread count - increment for user messages
        if (messageData.sender === "user") {
            conversation.unreadCount = (conversation.unreadCount || 0) + 1;
        }

        // Save conversation metadata with retry
        const savedConversation = await saveWithRetry(conversation, 3);
        console.log(`✅ Conversation metadata updated: ${savedConversation._id}`);
        
        // ⭐ Return both conversation and message MongoDB _id for placeholder system
        return {
            conversation: savedConversation,
            messageMongoId: message._id  // ⭐ NEW: MongoDB ObjectId for placeholder tracking
        };

    } catch (error) {
        console.error("❌ Error updating conversation data:", error);
        throw error;
    }
}

/**
 * Update conversation participant name
 * @param {string} conversationId - Conversation ID
 * @param {string} newPatientName - New participant name
 * @returns {Promise<Object>} Updated conversation
 */
async function updateConversationPatientName(conversationId, newPatientName) {
    try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }
        
        conversation.participantName = newPatientName;
        await saveWithRetry(conversation, 3);
        
        console.log(`✅ Participant name updated for conversation ${conversationId}: ${newPatientName}`);
        return conversation;
    } catch (error) {
        console.error('❌ Error updating participant name:', error);
        throw error;
    }
}

/**
 * Format conversation for list display
 * @param {Object} conversation - Conversation document
 * @returns {Object} Formatted conversation
 */
function formatConversationForList(conversation) {
    if (!conversation) return null;
    
    // Format conversation for list display
    return {
        _id: conversation._id,
        phoneNumber: conversation.phoneNumber,
        participantName: conversation.participantName || "Unknown",
        agentId: conversation.agentId,
        lastMessage: conversation.lastMessage,
        lastMessageTime: conversation.lastMessageTime,
        lastMessageSender: conversation.lastMessageSender,
        unreadCount: conversation.unreadCount || 0,
        messageCount: conversation.messageCount || 0,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt
    };
}

/**
 * CRM conversation creation placeholder (removed for pure API)
 * @param {Object} conversation - Conversation document
 * @param {Object} participant - Participant document
 */
async function createCRMConversationIfDelfino(conversation, participant) {
    try {
        // Note: CRM integration removed for pure API chatbot
        console.log('CRM integration removed - pure API chatbot');
    } catch (error) {
        // Non-blocking: Log error but don't break conversation creation
        console.error('⚠️ CRM conversation creation failed (non-blocking):', error.message);
    }
}

module.exports = {
    getOrCreateConversation,
    updateConversationData,
    updateConversationPatientName,
    formatConversationForList,
    getOrCreateParticipant,
    createCRMConversationIfDelfino
};
