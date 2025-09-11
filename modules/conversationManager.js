const { Agent } = require("../models");
const Conversation = require("../models/Conversation");
const ParticipantProfile = require("../models/ParticipantProfile");
const openAIIntegration = require("./openaiIntegration");
const { saveWithRetry } = require("../utils/dbUtils");
// Removed Twenty CRM service dependency

async function getOrCreateConversation(participant, agent) {
    // Look for existing conversation by phone number and agent
    let conversation = await Conversation.findOne({
        phoneNumber: participant.phoneNumber,
        agentId: agent.id
    });

    if (!conversation) {
        // No need for separate association - relationship is stored in conversation
        
        // Create new conversation document
        conversation = new Conversation({
            participantId: participant.id,
            phoneNumber: participant.phoneNumber,
            participantName: participant.name,
            agentId: agent.id,
            agentName: agent.name,
            // clientId removed - no longer needed in clientless architecture
            // threadId removed - context managed by Conversation.messages
            messages: [],
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
        console.log("New conversation created:", conversation._id);
    } else {
        console.log("Existing conversation found:", conversation._id);
    }

    return conversation;
}

// ParticipantAgentAssociation removed - relationship stored in Conversation document

async function updateConversationData(conversation, messageData, agent, participant) {
    try {
        // Add new message to conversation
        conversation.messages.push({
            ...messageData,
            timestamp: new Date()
        });

        // Update conversation metadata
        conversation.lastMessage = messageData.content?.map 
            ? messageData.content.map(chunk => chunk.content).join("") 
            : messageData.content;
        conversation.lastMessageTime = new Date();
        
        // 🔧 FIXER MODE: Properly construct lastMessageSender object
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

        // Save conversation with retry
        const savedConversation = await saveWithRetry(conversation, 3);
        return savedConversation;

    } catch (error) {
        console.error("Error updating conversation data:", error);
        throw error;
    }
}

async function updateConversationPatientName(conversationId, newPatientName) {
    try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            throw new Error('Conversation not found');
        }
        
        conversation.participantName = newPatientName;
        await saveWithRetry(conversation, 3);
        
        console.log(`Participant name updated for conversation ${conversationId}: ${newPatientName}`);
        return conversation;
    } catch (error) {
        console.error('Error updating participant name:', error);
        throw error;
    }
}

function formatConversationForList(conversation) {
    if (!conversation) return null;
    
    // Format conversation for list display
    return {
        _id: conversation._id,
        phoneNumber: conversation.phoneNumber,
        participantName: conversation.participantName || "Unknown",
        agentId: conversation.agentId,
        // clientId removed - no longer needed
        lastMessage: conversation.lastMessage,
        lastMessageTime: conversation.lastMessageTime,
        lastMessageSender: conversation.lastMessageSender,
        unreadCount: conversation.unreadCount || 0,
        status: conversation.status,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        // Include messages if needed, but exclude by default for performance
        messages: conversation.messages, 
    };
}

async function getOrCreateParticipant(phoneNumber, pushname) {
    try {
        // Direct MongoDB lookup - NO PostgreSQL fallback
        let participant = await ParticipantProfile.findByPhone(phoneNumber);

        if (!participant) {
            // Create new participant directly in MongoDB
            const participantData = {
                participantId: Date.now(), // Generate unique ID
                phoneNumber: phoneNumber,
                name: pushname || "Unknown",
                status: 'active',
                creditBalance: 0,
                metadata: {
                    createdVia: 'webhook'
                }
            };
            
            participant = await ParticipantProfile.create(participantData);
            console.log(`Created new participant in MongoDB: ${participant.name} (${participant.phoneNumber})`);
            
            // Return formatted for compatibility
            return {
                id: participant.participantId,
                name: participant.name,
                phoneNumber: participant.phoneNumber,
                status: participant.status,
                creditBalance: participant.creditBalance
            };
        } else {
            // Update name if needed
            if (pushname && (participant.name === "Unknown" || !participant.name)) {
                participant.name = pushname;
                await participant.save();
                console.log(`Updated participant name: ${participant.name} (${participant.phoneNumber})`);
            }
            console.log(`Existing participant found in MongoDB: ${participant.name} (${participant.phoneNumber})`);
            
            // Return formatted for compatibility
            return {
                id: participant.participantId,
                name: participant.name,
                phoneNumber: participant.phoneNumber,
                status: participant.status,
                creditBalance: participant.creditBalance
            };
        }

    } catch (error) {
        console.error('Error in getOrCreateParticipant:', error);
        throw error;
    }
}

/**
 * Creates CRM conversation immediately after MongoDB creation for Delfino agent.
 * Non-blocking: errors logged but don't affect conversation creation.
 * 
 * @param {Object} conversation MongoDB conversation object
 * @param {Object} participant Participant object with phone information
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
    // getOrCreateParticipantAgentAssociation removed - not needed
    createCRMConversationIfDelfino
};