/**
 * models/PaymentRecord.js
 * 
 * Description: MongoDB model for payment records (replacing PostgreSQL Payment)
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const PaymentRecordSchema = new Schema({
    participantId: {
        type: Number,
        required: true,
        index: true // Reference to ParticipantProfile.participantId
    },
    phoneNumber: {
        type: String,
        required: true,
        index: true // For easy lookup
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
        enum: ['new', 'pending', 'approved', 'rejected', 'credited', 'cancelled'],
        default: 'new',
        index: true
    },
    note: {
        type: String,
        default: ''
    },
    idempotencyKey: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // MercadoPago data
    mercadopago: {
        paymentId: String,
        preferenceId: String,
        externalReference: String,
        initPoint: String, // Payment link
        status: String,
        statusDetail: String
    },
    // Timestamps
    approvedAt: Date,
    creditedAt: Date,
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    }
}, {
    timestamps: true,
    collection: 'paymentRecords'
});

// Indexes for performance
PaymentRecordSchema.index({ participantId: 1, status: 1 });
PaymentRecordSchema.index({ 'mercadopago.paymentId': 1 }, { sparse: true });
PaymentRecordSchema.index({ createdAt: -1 });

/**
 * Find payment by idempotency key
 */
PaymentRecordSchema.statics.findByIdempotencyKey = async function(idempotencyKey) {
    return this.findOne({ idempotencyKey });
};

/**
 * Find payments by participant
 */
PaymentRecordSchema.statics.findByParticipant = async function(participantId, limit = 10) {
    return this.find({ participantId })
        .sort({ createdAt: -1 })
        .limit(limit);
};

/**
 * Mark payment as pending with MercadoPago data
 */
PaymentRecordSchema.methods.markAsPending = function(mpPaymentId, mpPreferenceId, initPoint) {
    this.status = 'pending';
    this.mercadopago.paymentId = mpPaymentId;
    this.mercadopago.preferenceId = mpPreferenceId;
    this.mercadopago.initPoint = initPoint;
    return this.save();
};

/**
 * Mark payment as approved
 */
PaymentRecordSchema.methods.markAsApproved = function(mpStatusDetail) {
    this.status = 'approved';
    this.approvedAt = new Date();
    this.mercadopago.status = 'approved';
    this.mercadopago.statusDetail = mpStatusDetail;
    return this.save();
};

/**
 * Mark payment as credited (credits added to participant)
 */
PaymentRecordSchema.methods.markAsCredited = function() {
    this.status = 'credited';
    this.creditedAt = new Date();
    return this.save();
};

const PaymentRecord = mongoose.model('PaymentRecord', PaymentRecordSchema);

module.exports = PaymentRecord;
