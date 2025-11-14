/**
 * models/Agent.js (MongoDB - Consolidated)
 * 
 * Description: MongoDB model for AI agents consolidating PostgreSQL Agent + AgentConfig
 * 
 * Role in the system: Central source of truth for agent configuration, credentials, and AI settings
 * 
 * Node.js Context: Model - MongoDB schema for complete agent management
 * 
 * Dependencies:
 * - mongoose (ODM for MongoDB operations)
 * 
 * Dependants:
 * - routes/webhookRoutes.js (agent lookup by instanceId)
 * - modules/messageQueue.js (agent retrieval for message processing)
 * - modules/responsesClient.js (loading agent configuration for OpenAI)
 * - services/* (agent credentials for platform APIs)
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ============================================================================
// Sub-Schemas
// ============================================================================

const ModelConfigSchema = new Schema({
  model: {
    type: String,
    required: true,
    default: 'gpt-5-mini',
    description: 'OpenAI model: gpt-5, gpt-5.1, gpt-5-mini, gpt-4o, etc.'
  },
  maxCompletionTokens: {
    type: Number,
    default: 16000,
    min: 512,
    max: 32000
  },
  temperature: {
    type: Number,
    default: 1.0,
    min: 0,
    max: 2.0,
    description: 'Temperature for non-reasoning models (ignored for gpt-5/5.1 with reasoning)'
  },
  streaming: {
    type: Boolean,
    default: true
  },
  
  // ========================================================================
  // ⭐ REASONING MODEL PARAMETERS (for gpt-5, gpt-5.1)
  // ========================================================================
  
  reasoningEffort: {
    type: String,
    enum: ['none', 'minimal', 'low', 'medium', 'high'],
    default: 'none',
    description: 'Reasoning effort for GPT-5.1 models. Use "none" for fast responses without reasoning tokens. Only applies to reasoning-capable models.'
  },
  verbosity: {
    type: String,
    enum: ['low', 'medium', 'high'],
    default: 'low',
    description: 'Response verbosity for reasoning models. Only applies to gpt-5/5.1.'
  }
}, { _id: false });

// ============================================================================
// Main Agent Schema
// ============================================================================

const AgentSchema = new Schema({
  // === Core Agent Identity (from PostgreSQL Agent) ===
            name: {
    type: String,
    required: true,
    index: true
            },
            type: {
    type: String,
    enum: ['openai', 'wpp-bsp'],
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'paused', 'Ready', 'Active', 'Paused'],  // Support both formats during transition
    default: 'inactive'
  },
  
  // === Platform Integration (from PostgreSQL Agent) ===
            channelId: {
    type: String,
    required: false
            },
            instanceId: {
    type: String,
    required: false,
    index: true,  // Critical for webhook agent lookup
    sparse: true
            },
            token: {
    type: String,
    required: false  // Platform authentication token
  },
  assistantId: {
    type: String,
    required: false  // Legacy OpenAI Assistant ID (not used in Responses API)
  },
  
  // === AI Configuration (from AgentConfig) ===
  systemPrompt: {
    type: String,
    required: true,
    maxlength: 1000000  // 1MB limit for very large prompts
  },
  modelConfig: {
    type: ModelConfigSchema,
    default: () => ({
      model: 'gpt-5-mini',
      maxCompletionTokens: 16000,
      temperature: 1.0,
      streaming: true
    })
  },
  responseSchema: {
    type: Schema.Types.Mixed,  // Full JSON schema object for structured outputs
    required: true
  },
  
  // ========================================================================
  // ⭐ IMAGE OPTIMIZATION CONFIG
  // ========================================================================
  // Controls how historical images are included in OpenAI context
  // 'low' mode saves 95%+ tokens and 2-5s per request with image history
  
  imageContextConfig: {
    type: new Schema({
      historyMode: {
        type: String,
        enum: ['full', 'low', 'none'],
        default: 'low',
        description: `
          full: Include ALL image blobs in OpenAI context (high token cost, ~1000 tokens/image)
          low: Only include blobs AFTER last assistant message, placeholders for older images
          none: Never include historical images, only current message images
        `
      },
      maxHistoricalImages: {
        type: Number,
        default: 20,
        min: 1,
        max: 50,
        description: 'Maximum number of historical images to include (even in full mode)'
      },
      enableAIObservation: {
        type: Boolean,
        default: true,
        description: 'Whether AI should generate visual descriptions for images (enables smart placeholders)'
      }
    }, { _id: false }),
    default: () => ({
      historyMode: 'low',
      maxHistoricalImages: 20,
      enableAIObservation: true
    })
  },
  
  // === Metadata ===
  metadata: {
    version: {
      type: Number,
      default: 1
    },
    category: {
      type: String,
      enum: ['healthcare', 'photography', 'general', 'custom'],
      default: 'general'
    },
    lastModified: {
      type: Date,
      default: Date.now
    },
    modifiedBy: {
      type: String,
      default: 'system'
    },
    notes: String
  }
}, {
  timestamps: true,
  collection: 'agents'
});

// ============================================================================
// Indexes for Performance
// ============================================================================

// Webhook agent lookup (critical path)
AgentSchema.index({ instanceId: 1 }, { sparse: true });

// Agent name search
AgentSchema.index({ name: 1 });

// Status filtering
AgentSchema.index({ status: 1 });

// Type-based queries
AgentSchema.index({ type: 1 });

// ============================================================================
// Middleware
// ============================================================================

// Pre-save middleware to update metadata
AgentSchema.pre('save', function(next) {
  this.metadata.lastModified = new Date();
  if (this.isNew) {
    this.metadata.version = 1;
  } else {
    this.metadata.version += 1;
  }
  
  // Normalize status values during transition
  if (this.status === 'Ready') this.status = 'inactive';
  if (this.status === 'Active') this.status = 'active';
  if (this.status === 'Paused') this.status = 'paused';
  
  next();
});

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Check if agent is active
 * @returns {boolean} True if agent is active
 */
AgentSchema.methods.isActive = function() {
  return this.status === 'active' || this.status === 'Active';
};

/**
 * Get agent credentials for platform API
 * @returns {Object} Credentials object
 */
AgentSchema.methods.getCredentials = function() {
  return {
    instanceId: this.instanceId,
    token: this.token,
    channelId: this.channelId,
    type: this.type
  };
};

/**
 * Get AI configuration for Responses API
 * @returns {Object} AI configuration
 */
AgentSchema.methods.getAIConfig = function() {
  return {
    systemPrompt: this.systemPrompt,
    modelConfig: this.modelConfig,
    responseSchema: this.responseSchema
  };
};

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Find agent by instanceId (webhook lookup)
 * @param {string} instanceId - Platform instance ID
 * @returns {Promise<Object>} Agent document
 */
AgentSchema.statics.findByInstanceId = async function(instanceId) {
  return await this.findOne({ 
    instanceId,
    $or: [
      { status: 'active' },
      { status: 'Active' }
    ]
  });
};

/**
 * Find all active agents
 * @returns {Promise<Array>} Array of active agents
 */
AgentSchema.statics.findActive = async function() {
  return await this.find({
    $or: [
      { status: 'active' },
      { status: 'Active' }
    ]
  });
};

/**
 * Find agent by name
 * @param {string} name - Agent name
 * @returns {Promise<Object>} Agent document
 */
AgentSchema.statics.findByName = async function(name) {
  return await this.findOne({ name });
};

/**
 * Create or update agent configuration
 * @param {Object} agentData - Agent data
 * @returns {Promise<Object>} Created or updated agent
 */
AgentSchema.statics.createOrUpdate = async function(agentData) {
  const { instanceId, name } = agentData;
  
  // Try to find by instanceId first, then by name
  const query = instanceId ? { instanceId } : { name };
  
  const options = {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  };
  
  return await this.findOneAndUpdate(query, agentData, options);
};

/**
 * Legacy compatibility: findByPk (maps to findById)
 * @param {ObjectId|string} id - Agent ID
 * @returns {Promise<Object>} Agent document
 */
AgentSchema.statics.findByPk = async function(id) {
  console.warn('⚠️ Agent.findByPk is deprecated. Use Agent.findById instead.');
  return await this.findById(id);
};

// ============================================================================
// Virtual Properties
// ============================================================================

// Legacy compatibility: map _id to id
AgentSchema.virtual('id').get(function() {
  return this._id.toString();
});

// Ensure virtuals are included in JSON output
AgentSchema.set('toJSON', { virtuals: true });
AgentSchema.set('toObject', { virtuals: true });

// ============================================================================
// Export Model
// ============================================================================

const Agent = mongoose.model('Agent', AgentSchema);

module.exports = Agent;
