/**
 * externalApiRoutes.js
 * 
 * Description: Simplified external API routes for conversation access by external systems
 * 
 * Role in the system: Provides secure access to conversations by client, agent, participant, or conversation ID
 * 
 * Node.js Context: Route - external API endpoints with API key authentication for chatbot integrations
 * 
 * Endpoints:
 * - GET /conversations/client/:clientId - All conversations for a client
 * - GET /conversations/agent/:agentId - All conversations for an agent  
 * - GET /conversations/participant/:phoneNumber - All conversations for a participant
 * - GET /conversations/:conversationId - Single conversation by ID
 * 
 * Dependencies:
 * - express, externalApiAuth, Conversation, Agent models
 */

const express = require('express');
const router = express.Router();
const { validateExternalApiKey } = require('../externalApiAuth');
const Conversation = require('../models/Conversation');
const { Agent } = require('../models');

// ============================================================================
// External API Middleware - Apply to all external routes
// ============================================================================

// Apply API key authentication to all external API routes
router.use(validateExternalApiKey);

// Add request logging for external API
router.use((req, res, next) => {
    console.log('External API request:', {
        method: req.method,
        path: req.path,
        keyPrefix: req.externalApi?.keyPrefix,
        ip: req.ip,
        timestamp: new Date().toISOString()
    });
    next();
});

// ============================================================================
// Simplified External API Endpoints - Conversation Access
// ============================================================================

/**
 * GET /api/external/conversations/client/:clientId
 * Get all conversations for a specific client
 */
router.get('/conversations/client/:clientId', async (req, res) => {
    try {
        const { clientId } = req.params;
        const { includeMessages = false, limit = 100, offset = 0 } = req.query;

        // Get agents for this client
        const agents = await Agent.findAll({ 
            where: { clientId: parseInt(clientId) },
            attributes: ['id']
        });
        
        const agentIds = agents.map(a => a.id);
        
        // Build query
        const query = { agentId: { $in: agentIds } };
        const projection = includeMessages === 'true' ? {} : { messages: 0 };
        
        const conversations = await Conversation.find(query, projection)
            .sort({ lastMessageTime: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset));

        res.json({
            success: true,
            data: conversations,
                meta: {
                clientId: clientId,
                    total: conversations.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
        
    } catch (error) {
        console.error('Error fetching conversations by client:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch conversations for client'
        });
    }
});

/**
 * GET /api/external/conversations/agent/:agentId
 * Get all conversations for a specific agent
 */
router.get('/conversations/agent/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const { includeMessages = false, limit = 100, offset = 0 } = req.query;

        // Build query
        const query = { agentId: parseInt(agentId) };
        const projection = includeMessages === 'true' ? {} : { messages: 0 };
        
        const conversations = await Conversation.find(query, projection)
            .sort({ lastMessageTime: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset));

        res.json({
            success: true,
            data: conversations,
            meta: {
                agentId: agentId,
                total: conversations.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });

    } catch (error) {
        console.error('Error fetching conversations by agent:', error);
        res.status(500).json({
                success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch conversations for agent'
        });
    }
});

/**
 * GET /api/external/conversations/participant/:phoneNumber
 * Get all conversations for a specific participant (phone number)
 */
router.get('/conversations/participant/:phoneNumber', async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const { includeMessages = false, limit = 100, offset = 0 } = req.query;

        // Build query
        const query = { phoneNumber: phoneNumber };
        const projection = includeMessages === 'true' ? {} : { messages: 0 };
        
        const conversations = await Conversation.find(query, projection)
            .sort({ lastMessageTime: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset));

        res.json({
            success: true,
            data: conversations,
                meta: {
                phoneNumber: phoneNumber,
                total: conversations.length,
                limit: parseInt(limit),
                offset: parseInt(offset)
            }
        });
        
    } catch (error) {
        console.error('Error fetching conversations by participant:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch conversations for participant'
        });
    }
});

/**
 * GET /api/external/conversations/:conversationId
 * Get a single conversation by ID
 */
router.get('/conversations/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { includeMessages = true } = req.query;

        // Build query
        const projection = includeMessages === 'true' ? {} : { messages: 0 };
        
        const conversation = await Conversation.findById(conversationId, projection);
        
        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'CONVERSATION_NOT_FOUND',
                message: 'Conversation not found'
            });
        }

        res.json({
            success: true,
            data: conversation
        });
        
    } catch (error) {
        console.error('Error fetching conversation by ID:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch conversation'
        });
    }
});

// ============================================================================
// Health Check Endpoint
// ============================================================================

/**
 * GET /api/external/health
 * Simple health check for external API
 */
router.get('/health', async (req, res) => {
    try {
        // Test database connections
        const mongoTest = await Conversation.countDocuments({});
        
        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                mongodb: 'connected',
                conversations: mongoTest >= 0 ? 'available' : 'unavailable'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            status: 'unhealthy',
            error: error.message
        });
    }
});

module.exports = router;