const { Agent, Participant, ParticipantAgentAssociation } = require("../models");
const Conversation = require("../models/Conversation");
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
        // Get or create participant-agent association with thread ID
        const association = await getOrCreateParticipantAgentAssociation(participant, agent);
        
        // Create new conversation document
        conversation = new Conversation({
            participantId: participant.id,
            phoneNumber: participant.phoneNumber,
            participantName: participant.name,
            agentId: agent.id,
            agentName: agent.name,
            clientId: agent.clientId,
            threadId: association.threadId,
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

async function getOrCreateParticipantAgentAssociation(participant, agent) {
    try {
        // Look for existing association
        let association = await ParticipantAgentAssociation.findOne({
            where: {
                participantId: participant.id,
                agentId: agent.id
            }
        });

        if (!association) {
            // Create new OpenAI thread for this participant-agent pair
            const thread = await openAIIntegration.createThread();
            
            // Create new association
            association = await ParticipantAgentAssociation.create({
                participantId: participant.id,
                agentId: agent.id,
                threadId: thread.id
            });
            console.log(`Created new participant-agent association: Participant ${participant.id} <-> Agent ${agent.id} (Thread: ${thread.id})`);
        } else {
            console.log(`Existing participant-agent association found: Participant ${participant.id} <-> Agent ${agent.id} (Thread: ${association.threadId})`);
        }

        return association;
    } catch (error) {
        console.error('Error in getOrCreateParticipantAgentAssociation:', error);
        throw error;
    }
}

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
        clientId: conversation.clientId,
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
        // Look for existing participant by phone number
        let participant = await Participant.findOne({
            where: { phoneNumber: phoneNumber }
        });

        if (!participant) {
            // Create new participant
            participant = await Participant.create({
                phoneNumber: phoneNumber,
                name: pushname || "Unknown",
                status: 'active'
            });
            console.log(`Created new participant: ${participant.name} (${participant.phoneNumber})`);
        } else {
            // Update name if pushname is provided and current name is "Unknown"
            if (pushname && (participant.name === "Unknown" || !participant.name)) {
                participant.name = pushname;
                await participant.save();
                console.log(`Updated participant name: ${participant.name} (${participant.phoneNumber})`);
            }
            console.log(`Existing participant found: ${participant.name} (${participant.phoneNumber})`);
        }

        return participant;
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
    getOrCreateParticipantAgentAssociation,
    createCRMConversationIfDelfino
};