/**
 * models/ToolSchema.js
 * 
 * Description: MongoDB model for storing definitions of tools (functions) available to AI agents.
 * 
 * Role in the system: Acts as a central repository for all possible tools. Agents can be configured
 * to use a subset of these tools by referencing them.
 * 
 * Node.js Context: Model - MongoDB schema for tool definitions.
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ToolSchemaSchema = new Schema({
    toolName: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    toolDefinition: {
        type: Schema.Types.Mixed, // Storing the full OpenAI tool definition object
        required: true
    },
    enabledForAgents: [{
        type: Number, // Array of PostgreSQL Agent IDs
        ref: 'Agent'
    }],
    metadata: {
        category: {
            type: String,
            enum: ['image_processing', 'payment', 'healthcare', 'video', 'website', 'general'],
            default: 'general'
        },
        version: {
            type: Number,
            default: 1
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
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    collection: 'toolSchemas'
});

// Index for efficient lookup of an agent's active tools
ToolSchemaSchema.index({ enabledForAgents: 1, isActive: 1 });

/**
 * Find all active tools enabled for a specific agent.
 * @param {number} agentId - The ID of the agent from PostgreSQL.
 * @returns {Promise<Array>} An array of tool definition objects.
 */
ToolSchemaSchema.statics.findActiveToolsForAgent = async function(agentId) {
    return this.find({
        enabledForAgents: agentId,
        isActive: true
    }).select('toolDefinition -_id'); // Return only the definition object
};

/**
 * Create or update a tool definition.
 * @param {Object} toolData - The tool definition and metadata.
 * @returns {Promise<Object>} The created or updated tool document.
 */
ToolSchemaSchema.statics.createOrUpdate = async function(toolData) {
    const { toolName } = toolData;
    if (!toolName) {
        throw new Error('toolName is required.');
    }

    const options = {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
    };

    return this.findOneAndUpdate({ toolName }, toolData, options);
};

const ToolSchema = mongoose.model('ToolSchema', ToolSchemaSchema);

module.exports = ToolSchema;
