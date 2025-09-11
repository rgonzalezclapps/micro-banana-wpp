/**
 * tools/toolExecutor.js
 * 
 * Description: Central tool executor that loads and executes tools dynamically
 * 
 * Role in the system: Orchestrates tool execution with modular implementations
 */

const path = require('path');

class ToolExecutor {
    constructor() {
        this.toolCache = new Map();
    }

    /**
     * Execute a tool by name with arguments
     * @param {string} toolName - Name of the tool to execute
     * @param {Object} parsedArgs - Parsed tool arguments
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<Object>} Tool execution result
     */
    async executeTool(toolName, parsedArgs, conversationId) {
        try {
            // Load tool implementation
            const toolImplementation = await this.loadToolImplementation(toolName);
            
            if (!toolImplementation) {
                return {
                    success: false,
                    status: "not_implemented",
                    message: `Tool ${toolName} implementation not found`,
                    function_name: toolName
                };
            }

            // Execute tool
            return await toolImplementation.execute(parsedArgs, conversationId);

        } catch (error) {
            console.error(`❌ Error executing tool ${toolName}:`, error.message);
            return {
                success: false,
                status: "error",
                error: error.message,
                function_name: toolName
            };
        }
    }

    /**
     * Load tool implementation dynamically
     * @param {string} toolName - Name of the tool
     * @returns {Promise<Object>} Tool implementation instance
     */
    async loadToolImplementation(toolName) {
        // Check cache first
        if (this.toolCache.has(toolName)) {
            return this.toolCache.get(toolName);
        }

        // Map tool names to file paths
        const toolPaths = {
            // Image processing tools
            'newRequest': './implementations/image/newRequest.js',
            'updateRequest': './implementations/image/updateRequest.js',
            'processRequest': './implementations/image/processRequest.js',
            'getRequestStatus': './implementations/image/getRequestStatus.js',
            'listActiveRequests': './implementations/image/listActiveRequests.js',
            'cancelRequest': './implementations/image/cancelRequest.js',
            
            // Payment tools
            'createTopupLink': './implementations/payment/createTopupLink.js',
            'checkCredits': './implementations/payment/checkCredits.js',
            
            // Video tools
            'videoGenerator': './implementations/video/videoGenerator.js',
            
            // Website tools
            'generateWebsite': './implementations/website/generateWebsite.js',
            'updateWebsite': './implementations/website/updateWebsite.js'
        };

        const toolPath = toolPaths[toolName];
        if (!toolPath) {
            console.warn(`⚠️ No implementation path found for tool: ${toolName}`);
            return null;
        }

        try {
            const ToolClass = require(toolPath);
            const toolInstance = new ToolClass();
            
            // Cache the instance
            this.toolCache.set(toolName, toolInstance);
            
            console.log(`✅ Loaded implementation for tool: ${toolName}`);
            return toolInstance;

        } catch (loadError) {
            console.error(`❌ Failed to load implementation for ${toolName}:`, loadError.message);
            return null;
        }
    }

    /**
     * Clear tool cache (useful for development/testing)
     */
    clearCache() {
        this.toolCache.clear();
        console.log('🗑️ Tool implementation cache cleared');
    }
}

// Export singleton instance
const toolExecutor = new ToolExecutor();
module.exports = toolExecutor;
