const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);

// 🏗️ PROFESSIONAL APPROACH: Import centralized database connection
const { sequelize } = require('../database');

const db = {};

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (file.indexOf('.') !== 0) && (file !== basename) && (file.slice(-3) === '.js');
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

// Generic chatbot engine models - complete participant system
db.Agent = require('./Agent')(sequelize, Sequelize.DataTypes);
db.Client = require('./Client')(sequelize, Sequelize.DataTypes);
db.Participant = require('./Participant')(sequelize, Sequelize.DataTypes);
db.ParticipantAgentAssociation = require('./ParticipantAgentAssociation')(sequelize, Sequelize.DataTypes);
db.Payment = require('./Payment')(sequelize, Sequelize.DataTypes);

Object.keys(db).forEach(modelName => {
  if (db[modelName].associate) {
    db[modelName].associate(db);
  }
});

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// MongoDB models (Mongoose) - Added for request processing system
db.Conversation = require('./Conversation');
db.Request = require('./Request');

module.exports = db;
