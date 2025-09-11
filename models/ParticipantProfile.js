/**
 * models/ParticipantProfile.js
 * 
 * Description: MongoDB model for storing participant profiles (users/patients)
 * 
 * Role in the system: Central participant data storage replacing PostgreSQL Participants
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ParticipantProfileSchema = new Schema({
    participantId: {
        type: Number,
        required: true,
        unique: true,
        index: true // Reference to PostgreSQL Participant.id (during transition)
    },
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
    // Credit system
    creditBalance: {
        type: Number,
        default: 0,
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
    // Profile information
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
    // Healthcare specific (for Delfino agent)
    healthcare: {
        dni: String,
        dniType: String,
        birthDate: Date,
        gender: String,
        insuranceCode: String,
        planCode: String,
        insuranceNumber: String
    },
    // Activity tracking
    lastActivity: {
        type: Date,
        default: Date.now
    },
    conversationCount: {
        type: Number,
        default: 0
    },
    // Metadata
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
    collection: 'participantProfiles'
});

// Indexes for performance
ParticipantProfileSchema.index({ phoneNumber: 1 });
ParticipantProfileSchema.index({ status: 1, lastActivity: -1 });
ParticipantProfileSchema.index({ 'healthcare.dni': 1 }, { sparse: true });

/**
 * Find participant by phone number
 */
ParticipantProfileSchema.statics.findByPhone = async function(phoneNumber) {
    return this.findOne({ phoneNumber });
};

/**
 * Find participant by PostgreSQL ID (during transition)
 */
ParticipantProfileSchema.statics.findByParticipantId = async function(participantId) {
    return this.findOne({ participantId });
};

/**
 * Create or update participant
 */
ParticipantProfileSchema.statics.createOrUpdate = async function(participantData) {
    const { phoneNumber } = participantData;
    if (!phoneNumber) {
        throw new Error('phoneNumber is required');
    }

    const options = {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
    };

    return this.findOneAndUpdate({ phoneNumber }, participantData, options);
};

/**
 * Update credit balance
 */
ParticipantProfileSchema.methods.updateCredits = function(amount, operation = 'add') {
    if (operation === 'add') {
        this.creditBalance += amount;
        this.totalCreditsEarned += amount;
    } else if (operation === 'subtract') {
        this.creditBalance = Math.max(0, this.creditBalance - amount);
        this.totalCreditsSpent += amount;
    }
    
    this.lastActivity = new Date();
    return this.save();
};

// Pre-save middleware
ParticipantProfileSchema.pre('save', function(next) {
    this.metadata.lastModified = new Date();
    this.lastActivity = new Date();
    next();
});

const ParticipantProfile = mongoose.model('ParticipantProfile', ParticipantProfileSchema);

module.exports = ParticipantProfile;
