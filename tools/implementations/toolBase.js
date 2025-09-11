/**
 * tools/implementations/toolBase.js
 * 
 * Description: Base class for all tool implementations with common functionality
 * 
 * Role in the system: Provides standard structure, validation, and error handling for tools
 */

class ToolBase {
    constructor(toolName) {
        this.toolName = toolName;
    }

    /**
     * Execute the tool with parsed arguments
     * @param {Object} parsedArgs - Parsed tool arguments
     * @param {string} conversationId - Conversation ID for context
     * @returns {Promise<Object>} Tool execution result
     */
    async execute(parsedArgs, conversationId) {
        try {
            console.log(`🔧 [${conversationId}] Executing ${this.toolName}`);
            
            // Validate arguments
            await this.validateArgs(parsedArgs);
            
            // Execute implementation
            const result = await this.implementation(parsedArgs, conversationId);
            
            // Ensure result has required structure
            return this.formatResult(result);
            
        } catch (error) {
            console.error(`❌ [${conversationId}] ${this.toolName} failed:`, error.message);
            return this.formatError(error);
        }
    }

    /**
     * Validate tool arguments (override in subclasses)
     * @param {Object} parsedArgs - Tool arguments
     */
    async validateArgs(parsedArgs) {
        // Override in subclasses
        return true;
    }

    /**
     * Tool implementation (override in subclasses)
     * @param {Object} parsedArgs - Tool arguments
     * @param {string} conversationId - Conversation ID
     * @returns {Promise<Object>} Implementation result
     */
    async implementation(parsedArgs, conversationId) {
        throw new Error(`Implementation method not defined for ${this.toolName}`);
    }

    /**
     * Format successful result
     * @param {Object} result - Raw result
     * @returns {Object} Formatted result
     */
    formatResult(result) {
        return {
            success: true,
            status: 'completed',
            ...result,
            function_name: this.toolName
        };
    }

    /**
     * Format error result
     * @param {Error} error - Error object
     * @returns {Object} Formatted error
     */
    formatError(error) {
        return {
            success: false,
            status: 'error',
            error: error.message,
            function_name: this.toolName
        };
    }
}

module.exports = ToolBase;
