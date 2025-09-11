/**
 * tools/exportToDebugFiles.js
 *
 * Description: Export schema and tools from MongoDB to ai_debugging files
 */

const fs = require('fs').promises;
const path = require('path');
const AgentConfig = require('../models/AgentConfig');
const ToolSchema = require('../models/ToolSchema');
const { mongoose } = require('../database');

async function exportToDebugFiles() {
    console.log('🚀 Exporting MongoDB data to ai_debugging files...');

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ MongoDB connected.');

        // 1. Export schema from Agent 1 configuration
        console.log('\n📋 Exporting response schema...');
        const agent1Config = await AgentConfig.findByAgentId(1);
        
        if (agent1Config && agent1Config.responseSchema) {
            const schemaPath = path.join(__dirname, '..', 'ai_debugging', 'schemas', 'debug_schema.json');
            await fs.writeFile(schemaPath, JSON.stringify(agent1Config.responseSchema, null, 2));
            console.log(`✅ Schema exported to: ai_debugging/schemas/debug_schema.json`);
            console.log(`   Schema name: ${agent1Config.responseSchema.name}`);
        } else {
            console.warn('⚠️ No schema found for Agent 1');
        }

        // 2. Export all tools individually
        console.log('\n🔧 Exporting tools...');
        const allTools = await ToolSchema.find({ isActive: true });
        
        for (const toolDoc of allTools) {
            const toolName = toolDoc.toolName;
            const toolDefinition = toolDoc.toolDefinition;
            
            const toolPath = path.join(__dirname, '..', 'ai_debugging', 'tools', `${toolName}.json`);
            await fs.writeFile(toolPath, JSON.stringify(toolDefinition, null, 2));
            
            console.log(`✅ Tool exported: ${toolName}.json`);
            console.log(`   Category: ${toolDoc.metadata.category}`);
            console.log(`   Enabled for agents: [${toolDoc.enabledForAgents.join(', ')}]`);
        }

        console.log(`\n🎉 Export complete! ${allTools.length} tools exported.`);

        // 3. Summary
        console.log('\n📊 Summary:');
        console.log(`- Schema: ai_debugging/schemas/debug_schema.json`);
        console.log(`- Tools: ${allTools.length} files in ai_debugging/tools/`);
        console.log(`- Prompts: Already available in ai_debugging/prompts/`);
        
        console.log('\n🐛 To enable debugging, add to your .env:');
        console.log('PROMPT_DEBUG=true');
        console.log('SCHEMA_DEBUG=true');
        console.log('TOOLS_DEBUG=true');

    } catch (error) {
        console.error('\n❌ Export failed:', error);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 MongoDB disconnected.');
    }
}

// Run the export
exportToDebugFiles();
