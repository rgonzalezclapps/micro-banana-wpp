/**
 * tools/updateAgentModel.js
 * 
 * Description: Update agent's model configuration in MongoDB
 * 
 * Usage: node tools/updateAgentModel.js <agentInstanceId> <model> [streaming] [maxTokens]
 * Example: node tools/updateAgentModel.js 50151 gpt-5-mini false 4096
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Import Agent model
const Agent = require('../models/Agent');

async function updateAgentModel(agentId, model, streaming = null, maxTokens = null) {
    try {
        console.log(`🚀 Starting model config update for agent ${agentId}`);
        
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agents';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
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
            const allAgents = await Agent.find({}, 'name instanceId status modelConfig');
            allAgents.forEach(a => console.log(`  - ${a.name} (Instance: ${a.instanceId}, Model: ${a.modelConfig?.model})`));
            process.exit(1);
        }
        
        console.log(`✅ Found agent: ${agent.name} (MongoDB ID: ${agent._id})`);
        console.log(`📋 Current config:`, {
            model: agent.modelConfig.model,
            streaming: agent.modelConfig.streaming,
            maxCompletionTokens: agent.modelConfig.maxCompletionTokens,
            temperature: agent.modelConfig.temperature
        });
        
        // Update model config
        agent.modelConfig.model = model;
        
        if (streaming !== null) {
            agent.modelConfig.streaming = streaming === 'true' || streaming === true;
        }
        
        if (maxTokens !== null && !isNaN(maxTokens)) {
            agent.modelConfig.maxCompletionTokens = parseInt(maxTokens);
        }
        
        agent.metadata.lastModified = new Date();
        agent.metadata.modifiedBy = 'updateAgentModel-tool';
        
        await agent.save();
        
        console.log(`\n🎉 Successfully updated model config for agent: ${agent.name}`, {
            agentId: agent._id,
            instanceId: agent.instanceId,
            newModel: agent.modelConfig.model,
            streaming: agent.modelConfig.streaming,
            maxTokens: agent.modelConfig.maxCompletionTokens,
            lastModified: agent.metadata.lastModified
        });
        
        console.log(`\n✅ Model config updated successfully!`);
        console.log(`⚠️  IMPORTANT: Run clearAgentCache.js to clear Redis cache`);
        
    } catch (error) {
        console.error(`❌ Error updating model config:`, error.message);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node tools/updateAgentModel.js <agentInstanceId> <model> [streaming] [maxTokens]');
    console.error('Examples:');
    console.error('  node tools/updateAgentModel.js 50151 gpt-5-mini');
    console.error('  node tools/updateAgentModel.js 50151 gpt-5-mini true');
    console.error('  node tools/updateAgentModel.js 50151 gpt-5-mini false 2048');
    console.error('');
    console.error('Available models:');
    console.error('  - gpt-5-mini (fast, no reasoning tokens, < 10s)');
    console.error('  - gpt-5 (slow, with reasoning tokens, ~30s)');
    console.error('  - gpt-4o (balanced)');
    process.exit(1);
}

const [agentId, model, streaming, maxTokens] = args;

// Run update
updateAgentModel(agentId, model, streaming, maxTokens)
    .then(() => {
        console.log('✅ Model update completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Model update failed:', error.message);
        process.exit(1);
    });

