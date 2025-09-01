/**
 * Migration: fix_participant_agent_association_constraints.js
 * 
 * Description: Fixes ParticipantAgentAssociations table structure to allow proper manual deletion
 * 
 * Changes:
 * 1. Add explicit primary key (id) if not exists
 * 2. Fix foreign key constraints with proper CASCADE behavior
 * 3. Remove duplicate indexes
 * 4. Ensure threadId uniqueness
 * 
 * Purpose: Allow manual deletion of associations without affecting participants or agents
 */

'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      // 1. Check if id column exists, if not add it
      const tableDescription = await queryInterface.describeTable('ParticipantAgentAssociations');
      
      if (!tableDescription.id) {
        // Add primary key column
        await queryInterface.addColumn('ParticipantAgentAssociations', 'id', {
          type: Sequelize.INTEGER,
          primaryKey: true,
          autoIncrement: true,
          allowNull: false
        }, { transaction });
      }
      
      // 2. Drop existing problematic foreign key constraints
      try {
        await queryInterface.removeConstraint('ParticipantAgentAssociations', 'fk_participant_associations_participant', { transaction });
      } catch (error) {
        console.log('Constraint fk_participant_associations_participant already removed or does not exist');
      }
      
      try {
        await queryInterface.removeConstraint('ParticipantAgentAssociations', 'fk_participant_associations_agent', { transaction });
      } catch (error) {
        console.log('Constraint fk_participant_associations_agent already removed or does not exist');
      }
      
      // 3. Add properly configured foreign key constraints
      await queryInterface.addConstraint('ParticipantAgentAssociations', {
        fields: ['participantId'],
        type: 'foreign key',
        name: 'fk_participant_associations_participant_fixed',
        references: {
          table: 'Participants',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });
      
      await queryInterface.addConstraint('ParticipantAgentAssociations', {
        fields: ['agentId'],
        type: 'foreign key',
        name: 'fk_participant_associations_agent_fixed',
        references: {
          table: 'Agents',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE',
        transaction
      });
      
      // 4. Remove duplicate indexes if they exist
      try {
        await queryInterface.removeIndex('ParticipantAgentAssociations', 'participant_agent_associations_participant_id', { transaction });
      } catch (error) {
        console.log('Index participant_agent_associations_participant_id already removed');
      }
      
      try {
        await queryInterface.removeIndex('ParticipantAgentAssociations', 'participant_agent_associations_agent_id', { transaction });
      } catch (error) {
        console.log('Index participant_agent_associations_agent_id already removed');
      }
      
      // 5. Ensure threadId has unique constraint
      try {
        await queryInterface.addConstraint('ParticipantAgentAssociations', {
          fields: ['threadId'],
          type: 'unique',
          name: 'unique_thread_id',
          transaction
        });
      } catch (error) {
        console.log('Unique constraint on threadId already exists');
      }
      
      await transaction.commit();
      console.log('✅ Migration completed successfully - ParticipantAgentAssociations can now be deleted manually');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Migration failed:', error);
      throw error;
    }
  },

  async down(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    
    try {
      // Rollback changes if needed
      await queryInterface.removeConstraint('ParticipantAgentAssociations', 'fk_participant_associations_participant_fixed', { transaction });
      await queryInterface.removeConstraint('ParticipantAgentAssociations', 'fk_participant_associations_agent_fixed', { transaction });
      await queryInterface.removeConstraint('ParticipantAgentAssociations', 'unique_thread_id', { transaction });
      
      // Remove id column if it was added
      const tableDescription = await queryInterface.describeTable('ParticipantAgentAssociations');
      if (tableDescription.id) {
        await queryInterface.removeColumn('ParticipantAgentAssociations', 'id', { transaction });
      }
      
      await transaction.commit();
      console.log('✅ Rollback completed successfully');
      
    } catch (error) {
      await transaction.rollback();
      console.error('❌ Rollback failed:', error);
      throw error;
    }
  }
};
