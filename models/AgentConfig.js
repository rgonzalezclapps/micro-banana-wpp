/**
 * models/AgentConfig.js
 * 
 * Description: MongoDB model for storing comprehensive AI agent configurations.
 * This includes the system prompt, model settings, response schema, and enabled tools.
 * 
 * Role in the system: Central source of truth for an agent's behavior and capabilities,
 * loaded at runtime to configure the Responses API calls.
 * 
 * Node.js Context: Model - MongoDB schema for agent configuration.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ModelConfigSchema = new Schema({
    model: {
        type: String,
        required: true,
        default: 'gpt-5-mini'
    },
    maxCompletionTokens: {
        type: Number,
        default: 4096,
        min: 512,
        max: 8192
    },
    temperature: {
        type: Number,
        default: 1.0,
        min: 0,
        max: 2.0
    },
    streaming: {
        type: Boolean,
        default: true
    }
}, { _id: false });

const ChannelConfigSchema = new Schema({
    channelType: {
        type: String,
        required: true,
        enum: ['umsg', 'wspb'] // ultramsg, whatsapp business platform
    },
    channelId: { // Formerly instanceId
        type: String,
        required: true,
        index: true
    },
    channelToken: { // Formerly token
        type: String,
        required: false // Not always needed
    }
}, { _id: false });

const AgentConfigSchema = new Schema({
    agentId: {
        type: Number,
        required: true,
        unique: true,
        index: true,
        ref: 'Agent' // Reference to PostgreSQL Agent.id
    },
    agentName: {
        type: String,
        required: true
    },
    status: {
        type: String,
        required: true,
        enum: ['active', 'inactive', 'restricted'],
        default: 'inactive'
    },
    channelConfig: {
        type: ChannelConfigSchema,
        required: true
    },
    systemPrompt: {
        type: String,
        required: true,
        maxlength: 1000000 // 1MB limit for very large prompts
    },
    modelConfig: {
        type: ModelConfigSchema,
        default: () => ({})
    },
    responseSchema: {
        type: Schema.Types.Mixed, // Storing the full JSON schema object
        required: true
    },
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
    collection: 'agentConfigs'
});

// Pre-save middleware to update metadata
AgentConfigSchema.pre('save', function(next) {
    this.metadata.lastModified = new Date();
    if (this.isNew) {
        this.metadata.version = 1;
    } else {
        this.metadata.version += 1;
    }
    next();
});

/**
 * Find the active configuration for a given agentId.
 * @param {number} agentId - The ID of the agent from PostgreSQL.
 * @returns {Promise<Object|null>} The agent configuration document.
 */
AgentConfigSchema.statics.findByAgentId = async function(agentId) {
    return this.findOne({ agentId });
};

/**
 * Create or update an agent's configuration.
 * @param {Object} configData - The configuration data for the agent.
 * @returns {Promise<Object>} The created or updated agent configuration document.
 */
AgentConfigSchema.statics.createOrUpdate = async function(configData) {
    const { agentId } = configData;
    if (!agentId) {
        throw new Error('agentId is required to create or update a configuration.');
    }

    const options = {
        upsert: true,       // Create if not exists
        new: true,          // Return the new document
        setDefaultsOnInsert: true
    };

    return this.findOneAndUpdate({ agentId }, configData, options);
};

const AgentConfig = mongoose.model('AgentConfig', AgentConfigSchema);

module.exports = AgentConfig;
