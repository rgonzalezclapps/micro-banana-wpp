/**
 * models/Payment.js
 * 
 * Description: MongoDB model for storing payment records with MercadoPago integration
 * 
 * Role in the system: Replaces PostgreSQL Payments table for a full MongoDB architecture
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentSchema = new Schema({
    participantId: {
        type: Number,
        required: true,
        index: true // Refers to ParticipantProfile.participantId
    },
    amount: {
        type: Number,
        required: true,
        min: 1
    },
    credits: {
        type: Number,
        required: true,
        min: 1
    },
    status: {
        type: String,
        enum: ['new', 'pending', 'approved', 'rejected', 'credited', 'error'],
        default: 'new'
    },
    mpPaymentId: {
        type: String,
        index: true,
        sparse: true
    },
    mpPreferenceId: {
        type: String,
        index: true,
        sparse: true
    },
    externalReference: {
        type: String,
        index: true,
        sparse: true
    },
    note: {
        type: String,
        maxLength: 200
    },
    idempotencyKey: {
        type: String,
        required: true,
        unique: true
    },
    metadata: {
        type: Schema.Types.Mixed
    },
    approvedAt: {
        type: Date
    },
    creditedAt: {
        type: Date
    }
}, {
    timestamps: true,
    collection: 'payments'
});

// Indexes for performance
PaymentSchema.index({ participantId: 1, status: 1 });
PaymentSchema.index({ idempotencyKey: 1 });

/**
 * Find payment by idempotency key
 */
PaymentSchema.statics.findByIdempotencyKey = async function(idempotencyKey) {
    return this.findOne({ idempotencyKey });
};

/**
 * Mark payment as credited
 */
PaymentSchema.methods.markAsCredited = function() {
    this.status = 'credited';
    this.creditedAt = new Date();
    return this.save();
};

const Payment = mongoose.model('Payment', PaymentSchema);

module.exports = Payment;
