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
    participantId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Participants',
        key: 'id'
      }
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Agents',
        key: 'id'
      }
    },
    threadId: {
      type: DataTypes.STRING,
      allowNull: false
    }
  }, {
    tableName: 'ParticipantAgentAssociations',
    underscored: false
  });

  return ParticipantAgentAssociation;
};
