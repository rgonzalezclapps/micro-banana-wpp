/**
 * utils/promptManager.js
 * 
 * Description: Utility for managing agent system prompts with MongoDB storage and Redis caching
 * 
 * Role in the system: Provides CRUD operations for large system prompts (40+ pages) with performance optimization
 * 
 * Node.js Context: Utility - System prompt management and caching
 * 
 * Dependencies:
 * - models/AgentPrompt.js (MongoDB prompt storage)
 * - database/index.js (Redis client for caching)
 * 
 * Dependants:
 * - modules/responsesClient.js (prompt loading)
 * - API routes for prompt management (future)
 */

const AgentPrompt = require('../models/AgentPrompt');
const { redisClient } = require('../database');

class PromptManager {
    constructor() {
        this.cachePrefix = 'agent_prompt:';
        this.cacheTTL = 3600; // 1 hour
        this.maxPromptSize = 1000000; // 1MB limit
    }

    /**
     * Create or update system prompt for agent
     * @param {number} agentId - PostgreSQL Agent ID
     * @param {string} systemPrompt - The system prompt content
     * @param {Object} options - Additional metadata options
     * @returns {Promise<Object>} Created/updated prompt document
     */
    async setAgentPrompt(agentId, systemPrompt, options = {}) {
        try {
            // Validate input
            if (!agentId || !systemPrompt) {
                throw new Error('agentId and systemPrompt are required');
            }

            if (systemPrompt.length > this.maxPromptSize) {
                throw new Error(`System prompt exceeds maximum size of ${this.maxPromptSize} characters`);
            }

            console.log(`📝 Setting system prompt for agent ${agentId}`, {
                characterCount: systemPrompt.length,
                wordCount: systemPrompt.split(/\s+/).length,
                category: options.category || 'general'
            });

            // Create new prompt version
            const newPrompt = await AgentPrompt.createPrompt(agentId, systemPrompt, options);

            // Clear cache to force reload
            await this.clearCache(agentId);

            console.log(`✅ System prompt set for agent ${agentId}`, {
                version: newPrompt.version,
                estimatedTokens: newPrompt.metadata.estimatedTokens
            });

            return newPrompt;

        } catch (error) {
            console.error(`❌ Error setting system prompt for agent ${agentId}:`, error.message);
            throw error;
        }
    }

    /**
     * Get system prompt for agent with caching
     * @param {number} agentId - PostgreSQL Agent ID
     * @returns {Promise<string>} System prompt content
     */
    async getAgentPrompt(agentId) {
        if (!agentId) {
            return this.getDefaultPrompt();
        }

        try {
            // Check cache first
            const cacheKey = `${this.cachePrefix}${agentId}`;
            const cachedPrompt = await redisClient.get(cacheKey);
            
            if (cachedPrompt) {
                console.log(`📦 [Agent ${agentId}] Using cached system prompt`);
                return cachedPrompt;
            }

            // Load from MongoDB
            const agentPrompt = await AgentPrompt.getActivePrompt(agentId);
            
            if (!agentPrompt) {
                console.warn(`⚠️ [Agent ${agentId}] No system prompt found, using default`);
                return this.getDefaultPrompt();
            }

            // Cache for future use (Redis v4+ syntax)
            await redisClient.setEx(cacheKey, this.cacheTTL, agentPrompt.systemPrompt);
            
            console.log(`✅ [Agent ${agentId}] Loaded and cached system prompt`, {
                version: agentPrompt.version,
                characterCount: agentPrompt.metadata.characterCount,
                wordCount: agentPrompt.metadata.wordCount
            });

            return agentPrompt.systemPrompt;

        } catch (error) {
            console.error(`❌ [Agent ${agentId}] Error loading system prompt:`, error.message);
            return this.getDefaultPrompt();
        }
    }

    /**
     * Clear cached prompt for agent
     * @param {number} agentId - PostgreSQL Agent ID
     * @returns {Promise<boolean>} Success status
     */
    async clearCache(agentId) {
        try {
            const cacheKey = `${this.cachePrefix}${agentId}`;
            await redisClient.del(cacheKey);
            console.log(`🗑️ [Agent ${agentId}] Cleared prompt cache`);
            return true;
        } catch (error) {
            console.error(`❌ [Agent ${agentId}] Error clearing cache:`, error.message);
            return false;
        }
    }

    /**
     * Get prompt history for agent
     * @param {number} agentId - PostgreSQL Agent ID
     * @param {number} limit - Maximum versions to return
     * @returns {Promise<Array>} Prompt version history
     */
    async getPromptHistory(agentId, limit = 10) {
        try {
            return await AgentPrompt.getPromptHistory(agentId, limit);
        } catch (error) {
            console.error(`❌ [Agent ${agentId}] Error getting prompt history:`, error.message);
            return [];
        }
    }

    /**
     * Get prompt statistics for agent
     * @param {number} agentId - PostgreSQL Agent ID
     * @returns {Promise<Object>} Prompt statistics
     */
    async getPromptStats(agentId) {
        try {
            const agentPrompt = await AgentPrompt.getActivePrompt(agentId);
            
            if (!agentPrompt) {
                return {
                    exists: false,
                    agentId,
                    message: 'No system prompt configured for this agent'
                };
            }

            return {
                exists: true,
                agentId,
                version: agentPrompt.version,
                metadata: agentPrompt.metadata,
                lastModified: agentPrompt.updatedAt,
                cacheKey: `${this.cachePrefix}${agentId}`,
                isCached: !!(await redisClient.get(`${this.cachePrefix}${agentId}`))
            };

        } catch (error) {
            console.error(`❌ [Agent ${agentId}] Error getting prompt stats:`, error.message);
            return {
                exists: false,
                agentId,
                error: error.message
            };
        }
    }

    /**
     * Bulk cache warming for multiple agents
     * @param {Array} agentIds - Array of agent IDs to warm cache
     * @returns {Promise<Object>} Warming results
     */
    async warmCache(agentIds = []) {
        const results = {
            success: 0,
            failed: 0,
            total: agentIds.length,
            errors: []
        };

        console.log(`🔥 Warming cache for ${agentIds.length} agents`);

        for (const agentId of agentIds) {
            try {
                await this.getAgentPrompt(agentId); // This will cache it
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({ agentId, error: error.message });
            }
        }

        console.log(`✅ Cache warming completed`, results);
        return results;
    }

    /**
     * Get default system prompt
     * @returns {string} Default prompt content
     */
    getDefaultPrompt() {
        return `Eres un asistente de procesamiento de imágenes y servicios digitales profesional.

HERRAMIENTAS DISPONIBLES:
- Procesamiento de imágenes (newRequest, updateRequest, processRequest, etc.)
- Sistema de pagos y créditos (createTopupLink, checkCredits)
- Generación de videos (videoGenerator)
- Creación de sitios web (generateWebsite, updateWebsite)
- Herramientas de healthcare para gestión médica

IMPORTANTE:
- SIEMPRE responde usando el schema JSON enhanced_fotoproducto_response_schema
- Mantén un tono profesional pero amigable en español argentino
- Usa las herramientas apropiadas según las necesidades del usuario
- No expongas nunca información técnica interna`;
    }
}

// Export singleton instance
const promptManager = new PromptManager();

module.exports = promptManager;
