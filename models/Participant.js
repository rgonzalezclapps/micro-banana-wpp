/**
 * Participant.js
 * 
 * Description: Participant model for generic chatbot engine - represents any person/entity engaging with agents
 * 
 * Role in the system: Core entity for participant management in generic conversation system, renamed from Patient model for broader use cases
 * 
 * Node.js Context: Model - Sequelize model for PostgreSQL participant data management
 * 
 * Dependencies:
 * - sequelize (ORM for database operations)
 * - DataTypes (Sequelize data type definitions)
 * 
 * Dependants:
 * - models/ParticipantAgentAssociation.js (references this model)
 * - modules/conversationManager.js (uses this for participant management)
 * - routes/webhookRoutes.js (creates/retrieves participants)
 * - models/index.js (imports and associates this model)
 */

module.exports = (sequelize, DataTypes) => {
  const Participant = sequelize.define('Participant', {
    name: {
      type: DataTypes.STRING,
      allowNull: true
    },
    phoneNumber: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active'
    }
  }, {
    tableName: 'Participants',
    underscored: false,
  });

  Participant.associate = function(models) {
    Participant.belongsToMany(models.Agent, { 
      through: models.ParticipantAgentAssociation,
      foreignKey: 'participantId'
    });
  };

  return Participant;
};
