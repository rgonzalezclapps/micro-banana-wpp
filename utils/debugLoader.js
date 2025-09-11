/**
 * utils/debugLoader.js
 * 
 * Description: Debug loader for AI prompts, schemas, and tools from local files
 * 
 * Role in the system: Provides debugging capabilities by loading from local files instead of MongoDB
 */

const fs = require('fs').promises;
const path = require('path');

class DebugLoader {
    constructor() {
        this.debugDir = path.join(__dirname, '..', 'ai_debugging');
        this.promptsDir = path.join(this.debugDir, 'prompts');
        this.schemasDir = path.join(this.debugDir, 'schemas');
        this.toolsDir = path.join(this.debugDir, 'tools');
    }

    /**
     * Check if debug mode is enabled for any component
     */
    isDebugMode() {
        return process.env.PROMPT_DEBUG === 'true' || 
               process.env.SCHEMA_DEBUG === 'true' || 
               process.env.TOOLS_DEBUG === 'true';
    }

    /**
     * Load debug prompt for agent
     * @param {number} agentId - Agent ID
     * @returns {Promise<string>} Debug prompt content
     */
    async loadDebugPrompt(agentId) {
        if (process.env.PROMPT_DEBUG !== 'true') {
            return null;
        }

        try {
            const promptFile = path.join(this.promptsDir, `agent_${agentId}.md`);
            const promptContent = await fs.readFile(promptFile, 'utf8');
            
            console.log(`🐛 [DEBUG] Loaded prompt from file: agent_${agentId}.md (${promptContent.length} chars)`);
            return promptContent;

        } catch (error) {
            console.warn(`⚠️ [DEBUG] Could not load debug prompt for agent ${agentId}:`, error.message);
            console.log(`🔄 [DEBUG] Falling back to MongoDB prompt for agent ${agentId}`);
            return null; // Return null to fallback to MongoDB
        }
    }

    /**
     * Load debug schema
     * @returns {Promise<Object>} Debug schema object
     */
    async loadDebugSchema() {
        if (process.env.SCHEMA_DEBUG !== 'true') {
            return null;
        }

        try {
            const schemaFile = path.join(this.schemasDir, 'debug_schema.json');
            const schemaContent = await fs.readFile(schemaFile, 'utf8');
            const schema = JSON.parse(schemaContent);
            
            console.log(`🐛 [DEBUG] Loaded schema from file: debug_schema.json`);
            return schema;

        } catch (error) {
            console.warn(`⚠️ [DEBUG] Could not load debug schema:`, error.message);
            console.log(`🔄 [DEBUG] Falling back to MongoDB schema`);
            return null; // Return null to fallback to MongoDB
        }
    }

    /**
     * Load debug tools (all available tools for any agent)
     * @returns {Promise<Array>} Debug tools array from individual files
     */
    async loadDebugTools() {
        if (process.env.TOOLS_DEBUG !== 'true') {
            return null;
        }

        try {
            // Read all .json files in tools directory
            const toolFiles = await fs.readdir(this.toolsDir);
            const jsonFiles = toolFiles.filter(file => file.endsWith('.json') && file !== 'debug_tools.json');
            
            const tools = [];
            
            for (const toolFile of jsonFiles) {
                try {
                    const toolPath = path.join(this.toolsDir, toolFile);
                    const toolContent = await fs.readFile(toolPath, 'utf8');
                    const tool = JSON.parse(toolContent);
                    tools.push(tool);
                    
                    console.log(`🐛 [DEBUG] Loaded tool: ${tool.function.name} from ${toolFile}`);
                } catch (toolError) {
                    console.warn(`⚠️ [DEBUG] Failed to load tool from ${toolFile}:`, toolError.message);
                }
            }
            
            console.log(`🐛 [DEBUG] Total debug tools loaded: ${tools.length} (ALL tools available to ANY agent)`);
            return tools;

        } catch (error) {
            console.warn(`⚠️ [DEBUG] Could not load debug tools directory:`, error.message);
            console.log(`🔄 [DEBUG] Falling back to MongoDB tools`);
            return null; // Return null to fallback to MongoDB
        }
    }

    /**
     * Get debug status summary
     */
    getDebugStatus() {
        return {
            prompt_debug: process.env.PROMPT_DEBUG === 'true',
            schema_debug: process.env.SCHEMA_DEBUG === 'true',
            tools_debug: process.env.TOOLS_DEBUG === 'true',
            any_debug: this.isDebugMode()
        };
    }
}

// Export singleton
const debugLoader = new DebugLoader();
module.exports = debugLoader;
