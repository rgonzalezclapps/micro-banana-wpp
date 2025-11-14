/**
 * models/Conversation.js
 * 
 * Description: MongoDB model for conversation metadata (messages now in separate collection)
 * 
 * Role in the system: Tracks conversation state, participants, and metadata
 * 
 * Node.js Context: Model - MongoDB schema for conversation management
 * 
 * Dependencies:
 * - mongoose (ODM for MongoDB operations)
 * - Message model (for virtual populate)
 * - Agent model (for references)
 * - Participant model (for references)
 * 
 * Dependants:
 * - modules/conversationManager.js (conversation creation and retrieval)
 * - modules/messageQueue.js (conversation updates)
 * - routes/webhookRoutes.js (conversation lookup)
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Note: MessageSchema has been moved to models/Message.js
// Messages are now stored in a separate collection for scalability

const ConversationSchema = new Schema({
  // === References (UPDATED to ObjectId) ===
  participantId: {
    type: Schema.Types.ObjectId,
    ref: 'Participant',
    required: true,
    index: true
  },
  phoneNumber: {
    type: String,
    required: true,
    index: true
  },
  participantName: {
    type: String,
    default: 'Unknown'
  },
  agentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
    index: true
  },
  agentName: {
    type: String,
    required: false
  },
  
  // === Messages Array REMOVED - now in separate Message collection ===
  // messages: [MessageSchema],  // DELETED
  
  // === Message Metadata (NEW) ===
  messageCount: {
    type: Number,
    default: 0
  },
  unreadCount: {
    type: Number,
    default: 0
  },
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageTime: {
    type: Date,
    default: Date.now
  },
  lastMessageSender: {
    role: {
      type: String,
      enum: ['ai_agent', 'bot_agent', 'user', 'agent', 'specialist', 'system_trigger'],
      required: false
    },
    name: {
      type: String,
      default: function() {
        if (this.lastMessageSender?.role === 'user') {
          return this.participantName || 'User';
        } else if (this.lastMessageSender?.role === 'ai_agent') {
          return this.agentName || 'AI Agent';
        }
        return '';
      }
    }
  },
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active'
  }
}, {
  timestamps: true
});

// ============================================================================
// Indexes for Performance
// ============================================================================

// Unique conversation per participant-agent pair
ConversationSchema.index({ participantId: 1, agentId: 1 }, { unique: true });

// Phone number lookup
ConversationSchema.index({ phoneNumber: 1 });

// Recent conversations
ConversationSchema.index({ lastMessageTime: -1 });

// Status filtering
ConversationSchema.index({ status: 1 });

// ⭐ NEW: Agent-based queries (for analytics and filtering)
ConversationSchema.index({ agentId: 1, status: 1 });

// ⭐ NEW: Phone + agent lookup (for multi-agent scenarios)
ConversationSchema.index({ phoneNumber: 1, agentId: 1 });

// ============================================================================
// Virtual Properties
// ============================================================================

// Virtual populate for agent
ConversationSchema.virtual('agent', {
  ref: 'Agent',
  localField: 'agentId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for participant
ConversationSchema.virtual('participant', {
  ref: 'Participant',
  localField: 'participantId',
  foreignField: '_id',
  justOne: true
});

// Virtual populate for messages (from Message collection)
ConversationSchema.virtual('messages', {
  ref: 'Message',
  localField: '_id',
  foreignField: 'conversationId'
});

// Legacy compatibility: map _id to id
ConversationSchema.virtual('id').get(function() {
  return this._id.toString();
});

// Ensure virtuals are included when converting to JSON
ConversationSchema.set('toJSON', { virtuals: true });
ConversationSchema.set('toObject', { virtuals: true });

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Increment message count
 */
ConversationSchema.methods.incrementMessageCount = async function() {
  this.messageCount += 1;
  return await this.save();
};

/**
 * Reset unread count
 */
ConversationSchema.methods.resetUnreadCount = async function() {
  this.unreadCount = 0;
  return await this.save();
};

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Find conversation by participant and agent
 * @param {ObjectId} participantId - Participant ID
 * @param {ObjectId} agentId - Agent ID
 * @returns {Promise<Object>} Conversation document
 */
ConversationSchema.statics.findByParticipantAndAgent = async function(participantId, agentId) {
  return await this.findOne({ participantId, agentId });
};

/**
 * Find conversations by participant
 * @param {ObjectId} participantId - Participant ID
 * @returns {Promise<Array>} Array of conversations
 */
ConversationSchema.statics.findByParticipant = async function(participantId) {
  return await this.find({ participantId }).sort({ lastMessageTime: -1 });
};

/**
 * Find conversations by agent
 * @param {ObjectId} agentId - Agent ID
 * @returns {Promise<Array>} Array of conversations
 */
ConversationSchema.statics.findByAgent = async function(agentId) {
  return await this.find({ agentId }).sort({ lastMessageTime: -1 });
};

// ============================================================================
// Export Model
// ============================================================================

const Conversation = mongoose.model('Conversation', ConversationSchema);

module.exports = Conversation;

