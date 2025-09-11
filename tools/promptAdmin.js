/**
 * tools/promptAdmin.js
 * 
 * Description: Administrative tool for managing agent system prompts with MongoDB storage
 * 
 * Role in the system: Provides CLI interface for CRUD operations on large system prompts (40+ pages)
 * 
 * Node.js Context: Administrative Tool - System prompt management utility
 * 
 * Dependencies:
 * - utils/promptManager.js (prompt management utilities)
 * - models/Agent.js (PostgreSQL agent validation)
 * - fs/promises (file system operations for prompt import/export)
 * 
 * Usage:
 * - node tools/promptAdmin.js set-prompt --agent 123 --file prompt.txt
 * - node tools/promptAdmin.js get-prompt --agent 123
 * - node tools/promptAdmin.js list-prompts
 * - node tools/promptAdmin.js clear-cache --agent 123
 */

const fs = require('fs').promises;
const path = require('path');
const promptManager = require('../utils/promptManager');
const { Agent } = require('../models');

class PromptAdmin {
    constructor() {
        this.supportedFormats = ['.txt', '.md', '.json'];
    }

    /**
     * Set system prompt for agent from file or text
     * @param {number} agentId - Agent ID
     * @param {string} source - File path or direct text
     * @param {Object} options - Additional options
     */
    async setPrompt(agentId, source, options = {}) {
        try {
            console.log(`📝 Setting system prompt for agent ${agentId}`);

            // Validate agent exists
            const agent = await Agent.findByPk(agentId);
            if (!agent) {
                throw new Error(`Agent ${agentId} not found in database`);
            }

            let promptContent;

            // Check if source is a file path
            if (source.includes('.') && !source.includes('\n')) {
                const filePath = path.resolve(source);
                console.log(`📂 Loading prompt from file: ${filePath}`);
                
                // Validate file extension
                const ext = path.extname(filePath).toLowerCase();
                if (!this.supportedFormats.includes(ext)) {
                    throw new Error(`Unsupported file format: ${ext}. Supported: ${this.supportedFormats.join(', ')}`);
                }

                // Read file content
                promptContent = await fs.readFile(filePath, 'utf8');
                console.log(`✅ File loaded: ${promptContent.length} characters`);

            } else {
                // Direct text input
                promptContent = source;
                console.log(`✅ Direct text input: ${promptContent.length} characters`);
            }

            // Set the prompt
            const result = await promptManager.setAgentPrompt(agentId, promptContent, {
                category: options.category || 'custom',
                tags: options.tags || [],
                modifiedBy: options.modifiedBy || 'admin-tool'
            });

            console.log(`🎉 System prompt set successfully for agent ${agentId}`, {
                agentName: agent.name,
                version: result.version,
                wordCount: result.metadata.wordCount,
                estimatedTokens: result.metadata.estimatedTokens
            });

            return result;

        } catch (error) {
            console.error(`❌ Error setting prompt for agent ${agentId}:`, error.message);
            throw error;
        }
    }

    /**
     * Get system prompt for agent
     * @param {number} agentId - Agent ID
     * @param {boolean} saveToFile - Whether to save to file
     */
    async getPrompt(agentId, saveToFile = false) {
        try {
            console.log(`📥 Getting system prompt for agent ${agentId}`);

            // Validate agent exists
            const agent = await Agent.findByPk(agentId);
            if (!agent) {
                throw new Error(`Agent ${agentId} not found in database`);
            }

            // Get prompt
            const promptContent = await promptManager.getAgentPrompt(agentId);
            const stats = await promptManager.getPromptStats(agentId);

            console.log(`✅ Retrieved system prompt for agent ${agentId}`, {
                agentName: agent.name,
                characterCount: promptContent.length,
                wordCount: promptContent.split(/\s+/).length,
                version: stats.version,
                isCached: stats.isCached
            });

            // Save to file if requested
            if (saveToFile) {
                const filename = `agent_${agentId}_prompt_v${stats.version || 'default'}.txt`;
                const filepath = path.join(process.cwd(), 'temp', filename);
                
                await fs.writeFile(filepath, promptContent, 'utf8');
                console.log(`💾 Prompt saved to file: ${filepath}`);
            }

            return {
                agentId,
                agentName: agent.name,
                promptContent,
                stats
            };

        } catch (error) {
            console.error(`❌ Error getting prompt for agent ${agentId}:`, error.message);
            throw error;
        }
    }

    /**
     * List all agents with their prompt status
     */
    async listPrompts() {
        try {
            console.log(`📋 Listing all agent prompts`);

            const agents = await Agent.findAll({
                attributes: ['id', 'name', 'type', 'status'],
                order: [['id', 'ASC']]
            });

            const results = [];

            for (const agent of agents) {
                const stats = await promptManager.getPromptStats(agent.id);
                results.push({
                    agentId: agent.id,
                    agentName: agent.name,
                    agentType: agent.type,
                    agentStatus: agent.status,
                    hasPrompt: stats.exists,
                    promptVersion: stats.version || null,
                    wordCount: stats.metadata?.wordCount || null,
                    lastModified: stats.lastModified || null,
                    isCached: stats.isCached || false
                });
            }

            console.log(`✅ Found ${results.length} agents`);
            
            // Display summary
            console.table(results.map(r => ({
                ID: r.agentId,
                Name: r.agentName,
                Type: r.agentType,
                Status: r.agentStatus,
                'Has Prompt': r.hasPrompt ? '✅' : '❌',
                Version: r.promptVersion || 'N/A',
                'Word Count': r.wordCount || 'N/A',
                Cached: r.isCached ? '📦' : '❌'
            })));

            return results;

        } catch (error) {
            console.error(`❌ Error listing prompts:`, error.message);
            throw error;
        }
    }

    /**
     * Clear cache for agent or all agents
     * @param {number|string} agentId - Agent ID or 'all'
     */
    async clearCache(agentId) {
        try {
            if (agentId === 'all') {
                console.log(`🗑️ Clearing all prompt caches`);
                
                const agents = await Agent.findAll({ attributes: ['id'] });
                let cleared = 0;
                
                for (const agent of agents) {
                    const success = await promptManager.clearCache(agent.id);
                    if (success) cleared++;
                }
                
                console.log(`✅ Cleared cache for ${cleared}/${agents.length} agents`);
                return { cleared, total: agents.length };

            } else {
                console.log(`🗑️ Clearing cache for agent ${agentId}`);
                const success = await promptManager.clearCache(agentId);
                
                if (success) {
                    console.log(`✅ Cache cleared for agent ${agentId}`);
                } else {
                    console.log(`⚠️ Cache clear failed for agent ${agentId}`);
                }
                
                return { success };
            }

        } catch (error) {
            console.error(`❌ Error clearing cache:`, error.message);
            throw error;
        }
    }

    /**
     * Import prompt from Google Docs export or large text file
     * @param {number} agentId - Agent ID
     * @param {string} filePath - Path to text file (supports .txt, .md)
     * @param {Object} options - Import options
     */
    async importPrompt(agentId, filePath, options = {}) {
        try {
            console.log(`📂 Importing prompt for agent ${agentId} from ${filePath}`);

            // Validate file exists
            const resolvedPath = path.resolve(filePath);
            const stats = await fs.stat(resolvedPath);
            
            if (!stats.isFile()) {
                throw new Error(`Path is not a file: ${resolvedPath}`);
            }

            console.log(`📊 File stats: ${Math.round(stats.size / 1024)}KB`);

            // Read and set prompt
            const result = await this.setPrompt(agentId, resolvedPath, options);
            
            console.log(`🎉 Prompt imported successfully from ${filePath}`);
            return result;

        } catch (error) {
            console.error(`❌ Error importing prompt:`, error.message);
            throw error;
        }
    }

    /**
     * Export prompt to file
     * @param {number} agentId - Agent ID
     * @param {string} outputPath - Output file path (optional)
     */
    async exportPrompt(agentId, outputPath = null) {
        try {
            const result = await this.getPrompt(agentId, false);
            
            const filename = outputPath || `agent_${agentId}_prompt_v${result.stats.version || 'default'}.txt`;
            const filepath = path.resolve(filename);
            
            await fs.writeFile(filepath, result.promptContent, 'utf8');
            
            console.log(`💾 Prompt exported to: ${filepath}`);
            console.log(`📊 Export stats:`, {
                agentName: result.agentName,
                characterCount: result.promptContent.length,
                wordCount: result.promptContent.split(/\s+/).length,
                version: result.stats.version
            });

            return filepath;

        } catch (error) {
            console.error(`❌ Error exporting prompt:`, error.message);
            throw error;
        }
    }
}

// CLI interface
if (require.main === module) {
    const admin = new PromptAdmin();
    const args = process.argv.slice(2);
    const command = args[0];

    (async () => {
        try {
            switch (command) {
                case 'set-prompt':
                    const agentId = args[args.indexOf('--agent') + 1];
                    const source = args[args.indexOf('--file') + 1] || args[args.indexOf('--text') + 1];
                    await admin.setPrompt(parseInt(agentId), source);
                    break;

                case 'get-prompt':
                    const getAgentId = args[args.indexOf('--agent') + 1];
                    const saveFile = args.includes('--save');
                    await admin.getPrompt(parseInt(getAgentId), saveFile);
                    break;

                case 'list-prompts':
                    await admin.listPrompts();
                    break;

                case 'clear-cache':
                    const clearAgentId = args[args.indexOf('--agent') + 1] || 'all';
                    await admin.clearCache(clearAgentId === 'all' ? 'all' : parseInt(clearAgentId));
                    break;

                case 'import-prompt':
                    const importAgentId = args[args.indexOf('--agent') + 1];
                    const filePath = args[args.indexOf('--file') + 1];
                    await admin.importPrompt(parseInt(importAgentId), filePath);
                    break;

                case 'export-prompt':
                    const exportAgentId = args[args.indexOf('--agent') + 1];
                    const outputPath = args[args.indexOf('--output') + 1];
                    await admin.exportPrompt(parseInt(exportAgentId), outputPath);
                    break;

                default:
                    console.log(`
📋 Prompt Admin Tool - Usage:

Set prompt from file:
  node tools/promptAdmin.js set-prompt --agent 123 --file /path/to/prompt.txt

Set prompt from text:
  node tools/promptAdmin.js set-prompt --agent 123 --text "Your system prompt here"

Get prompt:
  node tools/promptAdmin.js get-prompt --agent 123 [--save]

List all prompts:
  node tools/promptAdmin.js list-prompts

Clear cache:
  node tools/promptAdmin.js clear-cache --agent 123
  node tools/promptAdmin.js clear-cache --agent all

Import from file:
  node tools/promptAdmin.js import-prompt --agent 123 --file /path/to/large-prompt.txt

Export to file:
  node tools/promptAdmin.js export-prompt --agent 123 [--output /path/to/output.txt]
                    `);
                    break;
            }
        } catch (error) {
            console.error('❌ Command failed:', error.message);
            process.exit(1);
        }
    })();
}

module.exports = PromptAdmin;
