/**
 * config/responsesConfig.js
 * 
 * Description: Configuration for OpenAI Responses API integration
 * 
 * Role in the system: Centralized configuration for Responses API client
 * 
 * Node.js Context: Configuration - Environment variables and API settings
 * 
 * Dependencies:
 * - process.env (Environment variables)
 * 
 * Dependants:
 * - modules/responsesClient.js (API client configuration)
 */

module.exports = {
    // OpenAI API Configuration
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL || 'gpt-5-mini',
    OPENAI_MAX_TOKENS: parseInt(process.env.OPENAI_MAX_TOKENS) || 4000,
    OPENAI_TEMPERATURE: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.1,
    
    // Streaming Configuration
    OPENAI_STREAMING: process.env.OPENAI_STREAMING === 'true' || true,
    
    // Response Configuration
    OPENAI_RESPONSE_FORMAT: 'json_schema',
    OPENAI_SCHEMA_STRICT: true,
    
    // Tool Configuration
    TOOLS_ENABLED: process.env.TOOLS_ENABLED === 'false' ? false : true,
    MAX_TOOL_CALLS: parseInt(process.env.MAX_TOOL_CALLS) || 10,
    
    // Timeout Configuration
    REQUEST_TIMEOUT: parseInt(process.env.OPENAI_REQUEST_TIMEOUT) || 60000, // 60 seconds
    STREAM_TIMEOUT: parseInt(process.env.OPENAI_STREAM_TIMEOUT) || 120000,  // 2 minutes
    
    // Validation
    validate() {
        const errors = [];
        
        if (!this.OPENAI_API_KEY) {
            errors.push('OPENAI_API_KEY is required');
        }
        
        if (!this.OPENAI_MODEL) {
            errors.push('OPENAI_MODEL is required');
        }
        
        if (this.OPENAI_MAX_TOKENS < 100 || this.OPENAI_MAX_TOKENS > 8000) {
            errors.push('OPENAI_MAX_TOKENS must be between 100 and 8000');
        }
        
        if (this.OPENAI_TEMPERATURE < 0 || this.OPENAI_TEMPERATURE > 2) {
            errors.push('OPENAI_TEMPERATURE must be between 0 and 2');
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
        
        return true;
    }
};
