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
            // clientId is no longer needed
            // clientId: {
            //     type: DataTypes.INTEGER,
            //     allowNull: false,
            // },
        },
        {
            tableName: "Agents",
            underscored: false,
            paranoid: true,
        }
    );

    Agent.associate = (models) => {
        // No longer associated with a Client
        // Agent.belongsTo(models.Client, {
        //     foreignKey: "clientId",
        //     as: "agentClient",
        // });
        
        // Participant relationship moved to MongoDB - no longer needed here
        // Agent.belongsToMany(models.Participant, { 
        //     through: models.ParticipantAgentAssociation,
        //     foreignKey: 'agentId'
        // });
    };

    return Agent;
};
