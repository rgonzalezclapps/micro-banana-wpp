/**
 * tools/updateAgentModelFull.js
 * 
 * Description: Update agent's complete model configuration including reasoning parameters
 * 
 * Usage: node tools/updateAgentModelFull.js <agentInstanceId> <model> [reasoningEffort] [verbosity] [streaming] [maxTokens]
 * Examples:
 *   node tools/updateAgentModelFull.js 50151 gpt-5.1 none low false 4096
 *   node tools/updateAgentModelFull.js 50151 gpt-5-mini - - false 4096
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Agent = require('../models/Agent');

async function updateAgentModelFull(agentId, model, reasoningEffort, verbosity, streaming, maxTokens) {
    try {
        console.log(`🚀 Starting FULL model config update for agent ${agentId}`);
        
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agents';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Find agent
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
            process.exit(1);
        }
        
        console.log(`✅ Found agent: ${agent.name}`);
        console.log(`📋 Current config:`, {
            model: agent.modelConfig.model,
            reasoningEffort: agent.modelConfig.reasoningEffort,
            verbosity: agent.modelConfig.verbosity,
            streaming: agent.modelConfig.streaming,
            maxCompletionTokens: agent.modelConfig.maxCompletionTokens,
            temperature: agent.modelConfig.temperature
        });
        
        // Update model
        agent.modelConfig.model = model;
        console.log(`✅ Model: ${model}`);
        
        // Update reasoning_effort if provided (not "-")
        if (reasoningEffort && reasoningEffort !== '-') {
            agent.modelConfig.reasoningEffort = reasoningEffort;
            console.log(`✅ Reasoning effort: ${reasoningEffort}`);
        }
        
        // Update verbosity if provided (not "-")
        if (verbosity && verbosity !== '-') {
            agent.modelConfig.verbosity = verbosity;
            console.log(`✅ Verbosity: ${verbosity}`);
        }
        
        // Update streaming if provided
        if (streaming && streaming !== '-') {
            agent.modelConfig.streaming = streaming === 'true' || streaming === true;
            console.log(`✅ Streaming: ${agent.modelConfig.streaming}`);
        }
        
        // Update maxTokens if provided
        if (maxTokens && !isNaN(maxTokens)) {
            agent.modelConfig.maxCompletionTokens = parseInt(maxTokens);
            console.log(`✅ Max tokens: ${maxTokens}`);
        }
        
        agent.metadata.lastModified = new Date();
        agent.metadata.modifiedBy = 'updateAgentModelFull-tool';
        
        await agent.save();
        
        console.log(`\n🎉 Successfully updated FULL model config for: ${agent.name}`, {
            model: agent.modelConfig.model,
            reasoningEffort: agent.modelConfig.reasoningEffort,
            verbosity: agent.modelConfig.verbosity,
            streaming: agent.modelConfig.streaming,
            maxTokens: agent.modelConfig.maxCompletionTokens
        });
        
        console.log(`\n⚠️  IMPORTANT: Run clearAgentCache.js to clear Redis cache`);
        
    } catch (error) {
        console.error(`❌ Error updating model config:`, error.message);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node tools/updateAgentModelFull.js <agentId> <model> [reasoningEffort] [verbosity] [streaming] [maxTokens]');
    console.error('');
    console.error('Examples:');
    console.error('  # GPT-5.1 with no reasoning (FAST)');
    console.error('  node tools/updateAgentModelFull.js 50151 gpt-5.1 none low false 4096');
    console.error('');
    console.error('  # GPT-5-mini (FASTEST)');
    console.error('  node tools/updateAgentModelFull.js 50151 gpt-5-mini - - false 4096');
    console.error('');
    console.error('  # GPT-5 with minimal reasoning');
    console.error('  node tools/updateAgentModelFull.js 50151 gpt-5.1 minimal low false 4096');
    console.error('');
    console.error('Parameters:');
    console.error('  model: gpt-5, gpt-5.1, gpt-5-mini, gpt-4o');
    console.error('  reasoningEffort: none, minimal, low, medium, high (or - to skip)');
    console.error('  verbosity: low, medium, high (or - to skip)');
    console.error('  streaming: true, false (or - to skip)');
    console.error('  maxTokens: number (or - to skip)');
    process.exit(1);
}

const [agentId, model, reasoningEffort, verbosity, streaming, maxTokens] = args;

updateAgentModelFull(agentId, model, reasoningEffort, verbosity, streaming, maxTokens)
    .then(() => {
        console.log('✅ Model update completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Update failed:', error.message);
        process.exit(1);
    });

