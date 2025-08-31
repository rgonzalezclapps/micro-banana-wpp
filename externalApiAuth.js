/**
 * externalApiAuth.js
 * 
 * Description: Authentication middleware for external API access using API key validation
 * 
 * Role in the system: Provides secure access control for external systems accessing conversation data
 * 
 * Node.js Context: Middleware - API key authentication and rate limiting for external endpoints
 * 
 * Dependencies:
 * - process.env.API_KEY_ADAM (environment variable for API key)
 * 
 * Dependants:
 * - routes/externalApiRoutes.js (uses this middleware for authentication)
 */

/**
 * Validates API key for external system access.
 * Checks X-API-Key header or Authorization Bearer token against configured API key.
 * 
 * @param {Object} req Express request object
 * @param {Object} res Express response object  
 * @param {Function} next Express next middleware function
 * @returns {void} Calls next() if valid, returns 401 if invalid
 */
const validateExternalApiKey = (req, res, next) => {
    try {
        // Extract API key from headers (support both formats)
        const apiKey = req.headers['x-api-key'] || 
                      (req.headers['authorization'] && req.headers['authorization'].startsWith('Bearer ') 
                        ? req.headers['authorization'].replace('Bearer ', '') 
                        : null);
        
        // Validate API key presence
        if (!apiKey) {
            console.warn('External API access attempt without API key:', {
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path,
                timestamp: new Date().toISOString()
            });
            
            return res.status(401).json({
                success: false,
                error: 'UNAUTHORIZED',
                message: 'API key required. Provide via X-API-Key header or Authorization Bearer token.',
                timestamp: new Date().toISOString()
            });
        }
        
        // Validate API key value
        const validApiKey = process.env.API_KEY_ADAM;
        if (!validApiKey) {
            console.error('API_KEY_ADAM environment variable not configured');
            return res.status(500).json({
                success: false,
                error: 'SERVER_CONFIGURATION_ERROR',
                message: 'External API not properly configured',
                timestamp: new Date().toISOString()
            });
        }
        
        if (apiKey !== validApiKey) {
            console.warn('External API access attempt with invalid API key:', {
                providedKey: apiKey.substring(0, 8) + '...',
                ip: req.ip,
                userAgent: req.get('User-Agent'),
                path: req.path,
                timestamp: new Date().toISOString()
            });
            
            return res.status(401).json({
                success: false,
                error: 'INVALID_API_KEY',
                message: 'Invalid API key provided',
                timestamp: new Date().toISOString()
            });
        }
        
        // API key valid - add info to request for logging
        req.externalApi = {
            keyPrefix: apiKey.substring(0, 8) + '...',
            accessTime: new Date().toISOString(),
            clientIp: req.ip
        };
        
        console.log('External API access granted:', {
            keyPrefix: req.externalApi.keyPrefix,
            path: req.path,
            method: req.method,
            ip: req.ip
        });
        
        next();
        
    } catch (error) {
        console.error('Error in external API authentication:', error.message);
        return res.status(500).json({
            success: false,
            error: 'AUTHENTICATION_ERROR',
            message: 'Error validating API key',
            timestamp: new Date().toISOString()
        });
    }
};

module.exports = {
    validateExternalApiKey
};
