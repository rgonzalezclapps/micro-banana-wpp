/**
 * models/Participant.js
 * 
 * Description: MongoDB model for storing participant profiles (users/patients)
 * 
 * Role in the system: Central participant data storage with credit management and profile information
 * 
 * Node.js Context: Model - MongoDB schema for complete participant management
 * 
 * Dependencies:
 * - mongoose (ODM for MongoDB operations)
 * 
 * Dependants:
 * - modules/conversationManager.js (participant creation and retrieval)
 * - modules/messageQueue.js (participant reference in processing)
 * - services/mercadopagoService.js (credit management)
 * - tools/implementations/payment/* (credit operations)
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ============================================================================
// Main Participant Schema
// ============================================================================

const ParticipantSchema = new Schema({
  // === Core Identity ===
  // Note: participantId Number removed - use MongoDB _id directly
  name: {
    type: String,
    required: true,
    default: 'Unknown'
  },
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'restricted'],
    default: 'active'
  },
  
  // === Credit System ===
  creditBalance: {
    type: Number,
    default: 2000,  // 2000 créditos iniciales para nuevos usuarios
    min: 0
  },
  totalCreditsEarned: {
    type: Number,
    default: 0
  },
  totalCreditsSpent: {
    type: Number,
    default: 0
  },
  
  // === Profile Information ===
  profile: {
    email: String,
    firstName: String,
    lastName: String,
    preferredLanguage: {
      type: String,
      default: 'es-AR'
    },
    timezone: {
      type: String,
      default: 'America/Argentina/Buenos_Aires'
    }
  },
  
  // === Healthcare Specific (for healthcare agents) ===
  healthcare: {
    dni: String,
    dniType: String,
    birthDate: Date,
    gender: String,
    insuranceCode: String,
    planCode: String,
    insuranceNumber: String
  },
  
  // === Activity Tracking ===
  lastActivity: {
    type: Date,
    default: Date.now
  },
  conversationCount: {
    type: Number,
    default: 0
  },
  
  // === Metadata ===
  metadata: {
    createdVia: {
      type: String,
      enum: ['webhook', 'api', 'migration'],
      default: 'webhook'
    },
    lastModified: {
      type: Date,
      default: Date.now
    },
    notes: String
  }
}, {
  timestamps: true,
  collection: 'participants'
});

// ============================================================================
// Indexes for Performance
// ============================================================================

// Primary lookup by phone number
ParticipantSchema.index({ phoneNumber: 1 });

// Status and activity filtering
ParticipantSchema.index({ status: 1, lastActivity: -1 });

// Healthcare DNI lookup
ParticipantSchema.index({ 'healthcare.dni': 1 }, { sparse: true });

// Credit balance queries
ParticipantSchema.index({ creditBalance: 1 }, { sparse: true });

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Update credit balance
 * @param {number} amount - Amount to add or subtract
 * @param {string} operation - 'add' or 'subtract'
 * @returns {Promise<Object>} Updated participant document
 */
ParticipantSchema.methods.updateCredits = async function(amount, operation = 'add') {
  if (operation === 'add') {
    this.creditBalance += amount;
    this.totalCreditsEarned += amount;
  } else if (operation === 'subtract') {
    this.creditBalance = Math.max(0, this.creditBalance - amount);
    this.totalCreditsSpent += amount;
  }
  
  this.lastActivity = new Date();
  return await this.save();
};

/**
 * Check if participant has sufficient credits
 * @param {number} amount - Required credit amount
 * @returns {boolean} True if participant has sufficient credits
 */
ParticipantSchema.methods.hasCredits = function(amount) {
  return this.creditBalance >= amount;
};

/**
 * Add credits to participant
 * @param {number} amount - Amount to add
 * @returns {Promise<Object>} Updated participant document
 */
ParticipantSchema.methods.addCredits = async function(amount) {
  return await this.updateCredits(amount, 'add');
};

/**
 * Deduct credits from participant
 * @param {number} amount - Amount to deduct
 * @returns {Promise<Object>} Updated participant document
 * @throws {Error} If insufficient credits
 */
ParticipantSchema.methods.deductCredits = async function(amount) {
  if (!this.hasCredits(amount)) {
    throw new Error(`Insufficient credits. Required: ${amount}, Available: ${this.creditBalance}`);
  }
  return await this.updateCredits(amount, 'subtract');
};

/**
 * Increment conversation count
 * @returns {Promise<Object>} Updated participant document
 */
ParticipantSchema.methods.incrementConversationCount = async function() {
  this.conversationCount += 1;
  this.lastActivity = new Date();
  return await this.save();
};

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Find participant by phone number
 * @param {string} phoneNumber - Participant phone number
 * @returns {Promise<Object>} Participant document
 */
ParticipantSchema.statics.findByPhone = async function(phoneNumber) {
  return await this.findOne({ phoneNumber });
};

/**
 * Create or update participant
 * @param {Object} participantData - Participant data
 * @returns {Promise<Object>} Created or updated participant
 */
ParticipantSchema.statics.createOrUpdate = async function(participantData) {
  const { phoneNumber } = participantData;
  if (!phoneNumber) {
    throw new Error('phoneNumber is required');
  }

  const options = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  };

  return await this.findOneAndUpdate({ phoneNumber }, participantData, options);
};

/**
 * Find participants by status
 * @param {string} status - Participant status
 * @returns {Promise<Array>} Array of participants
 */
ParticipantSchema.statics.findByStatus = async function(status) {
  return await this.find({ status }).sort({ lastActivity: -1 });
};

/**
 * Find active participants
 * @returns {Promise<Array>} Array of active participants
 */
ParticipantSchema.statics.findActive = async function() {
  return await this.findByStatus('active');
};

/**
 * Get participant credit statistics
 * @param {ObjectId} participantId - Participant ID
 * @returns {Promise<Object>} Credit statistics
 */
ParticipantSchema.statics.getCreditStats = async function(participantId) {
  const participant = await this.findById(participantId);
  if (!participant) {
    throw new Error('Participant not found');
  }
  
  return {
    currentBalance: participant.creditBalance,
    totalEarned: participant.totalCreditsEarned,
    totalSpent: participant.totalCreditsSpent,
    netCredits: participant.totalCreditsEarned - participant.totalCreditsSpent
  };
};

// ============================================================================
// Middleware
// ============================================================================

// Pre-save middleware
ParticipantSchema.pre('save', function(next) {
  this.metadata.lastModified = new Date();
  this.lastActivity = new Date();
  next();
});

// ============================================================================
// Virtual Properties
// ============================================================================

// Legacy compatibility: map _id to id
ParticipantSchema.virtual('id').get(function() {
  return this._id.toString();
});

// Ensure virtuals are included in JSON output
ParticipantSchema.set('toJSON', { virtuals: true });
ParticipantSchema.set('toObject', { virtuals: true });

// ============================================================================
// Export Model
// ============================================================================

const Participant = mongoose.model('Participant', ParticipantSchema);

module.exports = Participant;

