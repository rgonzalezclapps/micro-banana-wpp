/**
 * Payment.js
 * 
 * Description: Payment model for MercadoPago credit top-up transactions management
 * 
 * Role in the system: Manages payment lifecycle from creation to completion, handles MercadoPago integration states
 * 
 * Node.js Context: Model - Sequelize model for PostgreSQL payment transaction data management
 * 
 * Dependencies:
 * - sequelize (ORM for database operations)
 * - DataTypes (Sequelize data type definitions)
 * - Participant model (foreign key relationship)
 * 
 * Dependants:
 * - services/mercadopagoService.js (creates and updates payments)
 * - modules/openaiIntegration.js (creates payments via createTopupLink tool)
 * - routes/webhookRoutes.js (updates payment status via MP notifications)
 * - models/index.js (imports and associates this model)
 */

module.exports = (sequelize, DataTypes) => {
  const Payment = sequelize.define('Payment', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    participantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Participants',
        key: 'id'
      },
      onDelete: 'CASCADE'
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      validate: {
        min: 1
      }
    },
    credits: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: {
        min: 1
      }
    },
    status: {
      type: DataTypes.ENUM('new', 'pending', 'approved', 'rejected', 'cancelled'),
      defaultValue: 'new',
      allowNull: false
    },
    // MercadoPago Integration Fields
    mp_payment_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    mp_preference_id: {
      type: DataTypes.STRING,
      allowNull: true
    },
    external_reference: {
      type: DataTypes.STRING,
      allowNull: true,
      unique: true
    },
    // Additional Fields
    note: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    idempotency_key: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    // MercadoPago Response Metadata
    metadata: {
      type: DataTypes.JSON,
      allowNull: true,
      defaultValue: {}
    },
    // Payment Processing Timestamps
    approved_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    credited_at: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'Payments',
    underscored: false,
    indexes: [
      {
        fields: ['participantId']
      },
      {
        fields: ['status']
      },
      {
        fields: ['mp_payment_id']
      },
      {
        fields: ['external_reference']
      },
      {
        fields: ['idempotency_key']
      }
    ]
  });

  Payment.associate = function(models) {
    Payment.belongsTo(models.Participant, { 
      foreignKey: 'participantId',
      onDelete: 'CASCADE'
    });
  };

  // Helper methods for payment lifecycle
  Payment.prototype.markAsPending = function(mpPaymentId, mpPreferenceId) {
    this.status = 'pending';
    this.mp_payment_id = mpPaymentId;
    this.mp_preference_id = mpPreferenceId;
    return this.save();
  };

  Payment.prototype.markAsApproved = function(metadata = {}) {
    this.status = 'approved';
    this.approved_at = new Date();
    this.metadata = { ...this.metadata, ...metadata };
    return this.save();
  };

  Payment.prototype.markAsCredited = function() {
    this.credited_at = new Date();
    return this.save();
  };

  Payment.prototype.markAsRejected = function(reason = '') {
    this.status = 'rejected';
    this.metadata = { ...this.metadata, rejectionReason: reason };
    return this.save();
  };

  return Payment;
};
