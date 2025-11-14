/**
 * models/index.js
 * 
 * Description: Centralized model exports for MongoDB-only architecture
 * 
 * Role in the system: Single point of import for all database models
 * 
 * Node.js Context: Model Index - MongoDB model exports (PostgreSQL removed)
 * 
 * Dependencies:
 * - mongoose (all models are MongoDB/Mongoose)
 * 
 * Dependants:
 * - All modules, routes, services, and tools that import models
 */

// ============================================================================
// MongoDB Models (Mongoose) - Complete System
// ============================================================================

const Agent = require('./Agent');
const Participant = require('./Participant');
const Conversation = require('./Conversation');
const Message = require('./Message');
const Payment = require('./Payment');
const Request = require('./Request');
const ToolSchema = require('./ToolSchema');

// ============================================================================
// Export All Models
// ============================================================================

module.exports = {
  // Core Models
  Agent,
  Participant,
  Conversation,
  Message,
  
  // Payment System
  Payment,
  
  // AI & Tools
  Request,
  ToolSchema
};
