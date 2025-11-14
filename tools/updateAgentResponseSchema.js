/**
 * tools/updateAgentResponseSchema.js
 * 
 * Description: Update agent's responseSchema field in MongoDB from JSON file
 * 
 * Usage: node tools/updateAgentResponseSchema.js <agentInstanceId> <schemaFilePath>
 * Example: node tools/updateAgentResponseSchema.js 50151 assistant_tools/response_schema.json
 */

const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// Import Agent model
const Agent = require('../models/Agent');

async function updateAgentResponseSchema(agentId, schemaFilePath) {
    try {
        console.log(`🚀 Starting response schema update for agent ${agentId}`);
        
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agents';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Read schema file
        const fullPath = path.resolve(process.cwd(), schemaFilePath);
        const schemaContent = await fs.readFile(fullPath, 'utf8');
        const schemaObject = JSON.parse(schemaContent);
        
        console.log(`📂 Read schema file: ${schemaFilePath}`);
        console.log(`📋 Schema name: ${schemaObject.name}`);
        console.log(`📊 Schema properties: ${Object.keys(schemaObject.schema.properties).join(', ')}`);
        
        // Find agent by instanceId
        let agent;
        
        if (!isNaN(agentId)) {
            agent = await Agent.findOne({ instanceId: agentId });
        }
        
        if (!agent) {
            const namePatterns = {
                '50151': ['Maxi Prod'],
                '34104': ['Bananon']
            };
            
            const patterns = namePatterns[agentId] || [];
            for (const pattern of patterns) {
                agent = await Agent.findOne({ name: new RegExp(pattern, 'i') });
                if (agent) break;
            }
        }
        
        if (!agent) {
            console.error(`❌ Agent not found with ID/InstanceId ${agentId}`);
            console.log('Available agents:');
            const allAgents = await Agent.find({}, 'name instanceId status');
            allAgents.forEach(a => console.log(`  - ${a.name} (ID: ${a._id}, Instance: ${a.instanceId}, Status: ${a.status})`));
            process.exit(1);
        }
        
        console.log(`✅ Found agent: ${agent.name} (MongoDB ID: ${agent._id})`);
        
        // Update responseSchema
        agent.responseSchema = schemaObject;
        agent.metadata.lastModified = new Date();
        agent.metadata.modifiedBy = 'updateAgentResponseSchema-tool';
        
        await agent.save();
        
        console.log(`🎉 Successfully updated response schema for agent: ${agent.name}`, {
            agentId: agent._id,
            instanceId: agent.instanceId,
            schemaName: schemaObject.name,
            requiredFields: schemaObject.schema.required,
            optionalFields: Object.keys(schemaObject.schema.properties).filter(
                key => !schemaObject.schema.required.includes(key)
            ),
            lastModified: agent.metadata.lastModified
        });
        
        console.log(`\n✅ Response schema updated successfully!`);
        console.log(`⚠️  IMPORTANT: Run clearAgentCache.js to clear Redis cache`);
        
    } catch (error) {
        console.error(`❌ Error updating response schema:`, error.message);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node tools/updateAgentResponseSchema.js <agentInstanceId> <schemaFilePath>');
    console.error('Example: node tools/updateAgentResponseSchema.js 50151 assistant_tools/response_schema.json');
    process.exit(1);
}

const [agentId, schemaFilePath] = args;

// Run update
updateAgentResponseSchema(agentId, schemaFilePath)
    .then(() => {
        console.log('✅ Schema update completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Schema update failed:', error.message);
        process.exit(1);
    });

