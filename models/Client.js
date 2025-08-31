const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const Client = sequelize.define('Client', {
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    status: {
      type: DataTypes.ENUM('active', 'inactive'),
      defaultValue: 'active',
    },
  }, {
    timestamps: true,
  });

  Client.associate = function(models) {
    Client.hasMany(models.Agent, { foreignKey: 'clientId', as: 'agents' });
    // Pure chatbot API - removed SystemUser and Patient associations
  };

  return Client;
};