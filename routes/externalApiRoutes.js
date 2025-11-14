/**
 * routes/externalApiRoutes.js
 * 
 * Description: External API routes for conversation access with separated Message collection
 * 
 * Role in the system: Provides secure access to conversations and messages for external systems
 * 
 * Node.js Context: Route - external API endpoints with API key authentication
 * 
 * Dependencies:
 * - express
 * - externalApiAuth (API key validation)
 * - models/Conversation (conversation metadata)
 * - models/Message (separated message storage)
 * - models/Agent (agent lookup)
 * 
 * Dependants:
 * - External integrations and monitoring systems
 */

const express = require('express');
const router = express.Router();
const { validateExternalApiKey } = require('../externalApiAuth');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const Agent = require('../models/Agent');

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
// Conversation Endpoints with Message Pagination
// ============================================================================

/**
 * GET /api/external/conversations/agent/:agentId
 * Get all conversations for a specific agent
 */
router.get('/conversations/agent/:agentId', async (req, res) => {
    try {
        const { agentId } = req.params;
        const { includeMessages = false, messageLimit = 50, messageOffset = 0, limit = 100, offset = 0 } = req.query;

        // Query conversations by agentId (ObjectId)
        const conversations = await Conversation.find({ agentId })
            .sort({ lastMessageTime: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .lean();

        // Optionally include messages from Message collection
        if (includeMessages === 'true') {
            for (const conversation of conversations) {
                const messages = await Message.find({ conversationId: conversation._id })
                    .sort({ timestamp: -1 })
                    .limit(parseInt(messageLimit))
                    .skip(parseInt(messageOffset))
                    .lean();
                
                conversation.messages = messages;
            }
        }

        res.json({
            success: true,
            data: conversations,
            meta: {
                agentId: agentId,
                total: conversations.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
                messagesIncluded: includeMessages === 'true',
                messageLimit: includeMessages === 'true' ? parseInt(messageLimit) : 0
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
        const { includeMessages = false, messageLimit = 50, messageOffset = 0, limit = 100, offset = 0 } = req.query;

        // Query conversations by phoneNumber
        const conversations = await Conversation.find({ phoneNumber })
            .sort({ lastMessageTime: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .lean();

        // Optionally include messages from Message collection
        if (includeMessages === 'true') {
            for (const conversation of conversations) {
                const messages = await Message.find({ conversationId: conversation._id })
                    .sort({ timestamp: -1 })
                    .limit(parseInt(messageLimit))
                    .skip(parseInt(messageOffset))
                    .lean();
                
                conversation.messages = messages;
            }
        }

        res.json({
            success: true,
            data: conversations,
            meta: {
                phoneNumber: phoneNumber,
                total: conversations.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
                messagesIncluded: includeMessages === 'true',
                messageLimit: includeMessages === 'true' ? parseInt(messageLimit) : 0
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
 * Get a single conversation by ID with optional message pagination
 */
router.get('/conversations/:conversationId', async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { includeMessages = true, messageLimit = 100, messageOffset = 0 } = req.query;

        // Get conversation metadata
        const conversation = await Conversation.findById(conversationId).lean();
        
        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'CONVERSATION_NOT_FOUND',
                message: 'Conversation not found'
            });
        }

        // Optionally include messages from Message collection
        if (includeMessages === 'true') {
            const messages = await Message.find({ conversationId: conversation._id })
                .sort({ timestamp: -1 })
                .limit(parseInt(messageLimit))
                .skip(parseInt(messageOffset))
                .lean();
            
            conversation.messages = messages;
        }

        res.json({
            success: true,
            data: conversation,
            meta: {
                messagesIncluded: includeMessages === 'true',
                messageCount: includeMessages === 'true' ? conversation.messages.length : 0,
                messageLimit: parseInt(messageLimit),
                messageOffset: parseInt(messageOffset)
            }
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

/**
 * GET /api/external/conversations/:conversationId/messages
 * Get paginated messages for a specific conversation
 */
router.get('/conversations/:conversationId/messages', async (req, res) => {
    try {
        const { conversationId } = req.params;
        const { limit = 100, offset = 0, sortOrder = 'desc' } = req.query;

        // Verify conversation exists
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) {
            return res.status(404).json({
                success: false,
                error: 'CONVERSATION_NOT_FOUND',
                message: 'Conversation not found'
            });
        }

        // Query messages with pagination
        const sort = sortOrder === 'asc' ? { timestamp: 1 } : { timestamp: -1 };
        const messages = await Message.find({ conversationId })
            .sort(sort)
            .limit(parseInt(limit))
            .skip(parseInt(offset))
            .lean();

        // Get total message count
        const totalCount = await Message.countDocuments({ conversationId });

        res.json({
            success: true,
            data: messages,
            meta: {
                conversationId: conversationId,
                total: totalCount,
                returned: messages.length,
                limit: parseInt(limit),
                offset: parseInt(offset),
                sortOrder: sortOrder,
                hasMore: (parseInt(offset) + messages.length) < totalCount
            }
        });
        
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: 'Failed to fetch messages'
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
        const conversationCount = await Conversation.countDocuments({});
        const messageCount = await Message.countDocuments({});
        const agentCount = await Agent.countDocuments({});
        
        res.json({
            success: true,
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                mongodb: 'connected',
                conversations: conversationCount,
                messages: messageCount,
                agents: agentCount
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
