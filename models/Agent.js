const { DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
    const Agent = sequelize.define(
        "Agent",
        {
            name: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            type: {
                type: DataTypes.ENUM("openai", "wpp-bsp"),
                allowNull: false,
            },
            channelId: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            assistantId: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            instanceId: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            token: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            status: {
                type: DataTypes.ENUM("Ready", "Active", "Paused"),
                defaultValue: "Ready",
            },
            clientId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },
        },
        {
            tableName: "Agents",
            underscored: false,
            paranoid: true,
        }
    );

    Agent.associate = (models) => {
        Agent.belongsTo(models.Client, {
            foreignKey: "clientId",
            as: "agentClient",
        });
        
        // Many-to-many relationship with Participants through ParticipantAgentAssociations
        Agent.belongsToMany(models.Participant, { 
            through: models.ParticipantAgentAssociation,
            foreignKey: 'agentId'
        });
    };

    return Agent;
};
