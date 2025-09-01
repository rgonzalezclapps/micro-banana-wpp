/**
 * ParticipantAgentAssociation.js
 * 
 * Description: Junction model for many-to-many relationship between Participants and Agents with OpenAI thread management
 * 
 * Role in the system: Manages participant-agent assignments and stores OpenAI thread IDs for conversation continuity, renamed from PatientAgentAssociation
 * 
 * Node.js Context: Model - Sequelize junction table for participant-agent relationships with thread context
 * 
 * Dependencies:
 * - sequelize (ORM for database operations)
 * - DataTypes (Sequelize data type definitions)
 * - models/Participant.js (foreign key reference)
 * - models/Agent.js (foreign key reference)
 * 
 * Dependants:
 * - models/Participant.js (uses this for agent associations)
 * - models/Agent.js (uses this for participant associations)
 * - modules/conversationManager.js (manages associations and thread IDs)
 * - modules/openaiIntegration.js (uses threadId for OpenAI API calls)
 * - models/index.js (imports and associates this model)
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const ParticipantAgentAssociation = sequelize.define('ParticipantAgentAssociation', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    participantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Participants',
        key: 'id'
      },
      onDelete: 'CASCADE', // Only cascade if participant is deleted
      onUpdate: 'CASCADE'
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Agents',
        key: 'id'
      },
      onDelete: 'CASCADE', // Only cascade if agent is deleted  
      onUpdate: 'CASCADE'
    },
    threadId: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true // Ensure thread uniqueness
    }
  }, {
    tableName: 'ParticipantAgentAssociations',
    underscored: false,
    indexes: [
      {
        unique: true,
        fields: ['participantId', 'agentId'],
        name: 'unique_participant_agent_combination'
      },
      {
        fields: ['threadId'],
        name: 'idx_thread_id'
      }
    ]
  });

  // Define associations with proper foreign key constraints
  ParticipantAgentAssociation.associate = function(models) {
    // Explicit foreign key definitions for better control
    ParticipantAgentAssociation.belongsTo(models.Participant, {
      foreignKey: 'participantId',
      as: 'participant',
      onDelete: 'CASCADE'
    });
    
    ParticipantAgentAssociation.belongsTo(models.Agent, {
      foreignKey: 'agentId', 
      as: 'agent',
      onDelete: 'CASCADE'
    });
  };

  return ParticipantAgentAssociation;
};
