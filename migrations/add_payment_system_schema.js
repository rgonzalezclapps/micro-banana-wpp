/**
 * add_payment_system_schema.js
 * 
 * Description: Database migration to add payment system with MercadoPago integration
 * 
 * Role in the system: Creates Payment table and adds creditBalance to Participants table
 * 
 * Node.js Context: Migration - Sequelize migration for PostgreSQL schema changes
 * 
 * Dependencies:
 * - sequelize (migration interface)
 * - QueryInterface (Sequelize migration methods)
 * - DataTypes (Sequelize data type definitions)
 * 
 * Dependants:
 * - models/Payment.js (depends on Payment table structure)
 * - models/Participant.js (depends on creditBalance column)
 */

'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      // 1. Add creditBalance column to Participants table
      console.log('Adding creditBalance column to Participants table...');
      await queryInterface.addColumn('Participants', 'credit_balance', {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 10000
      }, { transaction });

      // 2. Create Payments table
      console.log('Creating Payments table...');
      await queryInterface.createTable('Payments', {
        id: {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        },
        participantId: {
          type: Sequelize.INTEGER,
          allowNull: false,
          references: {
            model: 'Participants',
            key: 'id'
          },
          onUpdate: 'CASCADE',
          onDelete: 'CASCADE',
          field: 'participantId'
        },
        amount: {
          type: Sequelize.DECIMAL(10, 2),
          allowNull: false
        },
        credits: {
          type: Sequelize.INTEGER,
          allowNull: false
        },
        status: {
          type: Sequelize.ENUM('new', 'pending', 'approved', 'rejected', 'cancelled'),
          defaultValue: 'new',
          allowNull: false
        },
        mp_payment_id: {
          type: Sequelize.STRING,
          allowNull: true
        },
        mp_preference_id: {
          type: Sequelize.STRING,
          allowNull: true
        },
        external_reference: {
          type: Sequelize.STRING,
          allowNull: true,
          unique: true
        },
        note: {
          type: Sequelize.STRING(120),
          allowNull: true
        },
        idempotency_key: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true
        },
        metadata: {
          type: Sequelize.JSON,
          allowNull: true,
          defaultValue: {}
        },
        approved_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        credited_at: {
          type: Sequelize.DATE,
          allowNull: true
        },
        createdAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        },
        updatedAt: {
          type: Sequelize.DATE,
          allowNull: false,
          defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
        }
      }, { transaction });

      // 3. Create indexes for Payments table
      console.log('Creating indexes for Payments table...');
      
      await queryInterface.addIndex('Payments', ['participantId'], {
        name: 'payments_participant_id_idx',
        transaction
      });
      
      await queryInterface.addIndex('Payments', ['status'], {
        name: 'payments_status_idx',
        transaction
      });
      
      await queryInterface.addIndex('Payments', ['mp_payment_id'], {
        name: 'payments_mp_payment_id_idx',
        transaction
      });
      
      await queryInterface.addIndex('Payments', ['external_reference'], {
        name: 'payments_external_reference_idx',
        transaction
      });
      
      await queryInterface.addIndex('Payments', ['idempotency_key'], {
        name: 'payments_idempotency_key_idx',
        transaction
      });

      await transaction.commit();
      console.log('✅ Payment system schema migration completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Payment system schema migration failed:', error);
      throw error;
    }
  },

  down: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    try {
      console.log('Dropping Payments table...');
      await queryInterface.dropTable('Payments', { transaction });
      
      console.log('Removing creditBalance column from Participants table...');
      await queryInterface.removeColumn('Participants', 'credit_balance', { transaction });

      await transaction.commit();
      console.log('✅ Payment system schema rollback completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Payment system schema rollback failed:', error);
      throw error;
    }
  }
};
