/**
 * tools/updateAgentPrompt.js
 * 
 * Description: Quick utility to update agent system prompt directly in MongoDB
 * 
 * Usage: node tools/updateAgentPrompt.js <agentId> <promptFilePath>
 * Example: node tools/updateAgentPrompt.js 1 agent-1.md
 */

const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config();

// Import Agent model
const Agent = require('../models/Agent');

async function updateAgentPrompt(agentId, promptFilePath) {
    try {
        console.log(`🚀 Starting prompt update for agent ${agentId}`);
        
        // Connect to MongoDB
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-agents';
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Read prompt file
        const fullPath = path.resolve(process.cwd(), promptFilePath);
        const promptContent = await fs.readFile(fullPath, 'utf8');
        console.log(`📂 Read prompt file: ${promptFilePath} (${promptContent.length} characters)`);
        
        // Find agent by name or instanceId
        let agent;
        
        // Try to find by instanceId first (most reliable)
        if (!isNaN(agentId)) {
            agent = await Agent.findOne({ instanceId: agentId });
        }
        
        // If not found, try by name patterns
        if (!agent) {
            const namePatterns = {
                '1': ['Foto Producto', 'Maxi Prod', 'Foto AI'],
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
        
        console.log(`✅ Found agent: ${agent.name}`);
        
        // Update system prompt
        agent.systemPrompt = promptContent;
        agent.metadata.lastModified = new Date();
        agent.metadata.modifiedBy = 'updateAgentPrompt-tool';
        
        await agent.save();
        
        console.log(`🎉 Successfully updated system prompt for agent: ${agent.name}`, {
            agentId: agent._id,
            promptLength: promptContent.length,
            wordCount: promptContent.split(/\s+/).length,
            lastModified: agent.metadata.lastModified
        });
        
    } catch (error) {
        console.error(`❌ Error updating prompt:`, error.message);
        throw error;
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
    console.error('Usage: node tools/updateAgentPrompt.js <agentId> <promptFilePath>');
    console.error('Example: node tools/updateAgentPrompt.js 1 agent-1.md');
    process.exit(1);
}

const [agentId, promptFilePath] = args;

// Run update
updateAgentPrompt(agentId, promptFilePath)
    .then(() => {
        console.log('✅ Update completed successfully');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Update failed:', error.message);
        process.exit(1);
    });

