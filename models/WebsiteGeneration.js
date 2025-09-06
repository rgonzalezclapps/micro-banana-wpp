/**
 * WebsiteGeneration.js
 * 
 * Description: Sequelize model for website generation job tracking and audit trail
 * 
 * Role in the system: Provides optional database persistence for website generation requests, complementing Redis state management
 * 
 * Node.js Context: Model - PostgreSQL database schema for website generation audit and recovery
 * 
 * Dependencies:
 * - sequelize (ORM for PostgreSQL operations)
 * - DataTypes (Sequelize data type definitions)
 * 
 * Dependants:
 * - services/webGeneratorService.js (optional persistence layer)
 * - modules/openaiIntegration.js (audit trail and recovery)
 */

const { DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const WebsiteGeneration = sequelize.define('WebsiteGeneration', {
    // ============================================================================
    // Primary Key & Identification
    // ============================================================================
    
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        comment: 'Auto-incrementing primary key for website generation records'
    },
    
    requestId: {
        type: DataTypes.STRING(100),
        allowNull: false,
        comment: 'Unique request identifier for Redis state correlation'
    },
    
    externalRequestId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'External API request ID from webs.clapps.io'
    },
    
    projectId: {
        type: DataTypes.STRING(100),
        allowNull: true,
        comment: 'Website project ID from webs.clapps.io (format: site-abc123)'
    },
    
    // ============================================================================
    // Conversation & User Context
    // ============================================================================
    
    conversationId: {
        type: DataTypes.STRING(24),
        allowNull: false,
        comment: 'MongoDB conversation ID for user notifications'
    },
    
    participantId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'Participants',
            key: 'id'
        },
        comment: 'PostgreSQL participant ID for user tracking'
    },
    
    agentId: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
            model: 'Agents',
            key: 'id'
        },
        comment: 'AI agent that initiated the website generation'
    },
    
    // ============================================================================
    // Website Generation Details
    // ============================================================================
    
    prompt: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'Website description prompt provided by user'
    },
    
    templateStyle: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Auto-selected template style (TechFlow, MinimalZen, NeonVibe, etc.)'
    },
    
    // ============================================================================
    // Job Status & Timing
    // ============================================================================
    
    status: {
        type: DataTypes.ENUM('generating', 'processing', 'completed', 'failed', 'timeout'),
        allowNull: false,
        defaultValue: 'generating',
        comment: 'Current generation status'
    },
    
    startTime: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        comment: 'Generation start timestamp'
    },
    
    completedAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Generation completion timestamp'
    },
    
    processingTime: {
        type: DataTypes.INTEGER,
        allowNull: true,
        comment: 'Total processing time in milliseconds'
    },
    
    // ============================================================================
    // URLs & Results
    // ============================================================================
    
    websiteUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Final website URL (https://webs.clapps.io/site-abc123)'
    },
    
    statusUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'Real-time status monitoring URL'
    },
    
    trackingUrl: {
        type: DataTypes.STRING(500),
        allowNull: true,
        comment: 'User-facing tracking URL provided immediately'
    },
    
    // ============================================================================
    // Error Handling & Debugging
    // ============================================================================
    
    errorMessage: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Error message if generation failed'
    },
    
    errorCode: {
        type: DataTypes.STRING(50),
        allowNull: true,
        comment: 'Error code for categorization and debugging'
    },
    
    attemptCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of polling attempts made'
    },
    
    lastPolledAt: {
        type: DataTypes.DATE,
        allowNull: true,
        comment: 'Timestamp of last successful polling attempt'
    },
    
    // ============================================================================
    // Metadata & Audit Trail
    // ============================================================================
    
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Additional metadata including API responses, progress messages, etc.'
    },
    
    notificationSent: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'Whether completion notification was sent to user'
    },
    
    notificationAttempts: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        comment: 'Number of notification delivery attempts'
    }
    
}, {
    // ============================================================================
    // Model Configuration
    // ============================================================================
    
    tableName: 'website_generations',
    underscored: true, // Use snake_case in database, camelCase in JavaScript
    timestamps: true, // Adds createdAt and updatedAt automatically
    
    indexes: [
        {
            fields: ['conversation_id'],
            comment: 'Index for conversation-based queries'
        },
        {
            fields: ['status'],
            comment: 'Index for status filtering and monitoring'
        },
        {
            fields: ['start_time'],
            comment: 'Index for time-based queries and cleanup'
        },
        {
            fields: ['request_id'],
            unique: true,
            comment: 'Unique index for request ID correlation'
        },
        {
            fields: ['project_id'],
            comment: 'Index for project-based lookups'
        },
        {
            fields: ['participant_id'],
            comment: 'Index for user-based website history'
        }
    ],
    
    comment: 'Website generation job tracking with audit trail and recovery capabilities'
});

// ============================================================================
// Model Associations
// ============================================================================

// Note: Associations will be set up in models/index.js to avoid circular dependencies

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Marks the website generation as completed
 * @param {string} websiteUrl - Final website URL
 * @param {Object} metadata - Additional completion metadata
 */
WebsiteGeneration.prototype.markCompleted = async function(websiteUrl, metadata = {}) {
    const completedAt = new Date();
    const processingTime = completedAt.getTime() - this.startTime.getTime();
    
    await this.update({
        status: 'completed',
        websiteUrl,
        completedAt,
        processingTime,
        metadata: {
            ...this.metadata,
            ...metadata,
            completedAt: completedAt.toISOString()
        }
    });
    
    return this;
};

/**
 * Marks the website generation as failed
 * @param {string} errorMessage - Error description
 * @param {string} errorCode - Error code for categorization
 */
WebsiteGeneration.prototype.markFailed = async function(errorMessage, errorCode = 'GENERATION_FAILED') {
    const failedAt = new Date();
    const processingTime = failedAt.getTime() - this.startTime.getTime();
    
    await this.update({
        status: 'failed',
        errorMessage,
        errorCode,
        completedAt: failedAt,
        processingTime,
        metadata: {
            ...this.metadata,
            failedAt: failedAt.toISOString(),
            errorDetails: { errorMessage, errorCode }
        }
    });
    
    return this;
};

/**
 * Increments the attempt counter and updates last polled timestamp
 */
WebsiteGeneration.prototype.incrementAttempts = async function() {
    await this.update({
        attemptCount: this.attemptCount + 1,
        lastPolledAt: new Date()
    });
    
    return this;
};

/**
 * Updates generation status with optional metadata
 * @param {string} status - New status
 * @param {Object} metadata - Additional metadata
 */
WebsiteGeneration.prototype.updateStatus = async function(status, metadata = {}) {
    await this.update({
        status,
        metadata: {
            ...this.metadata,
            ...metadata,
            statusUpdatedAt: new Date().toISOString()
        }
    });
    
    return this;
};

// ============================================================================
// Class Methods
// ============================================================================

/**
 * Finds active website generation jobs that need recovery after server restart
 * @returns {Promise<Array>} Active generation jobs
 */
WebsiteGeneration.findActiveJobs = async function() {
    const activeStatuses = ['generating', 'processing'];
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    
    return await this.findAll({
        where: {
            status: activeStatuses,
            startTime: {
                [require('sequelize').Op.gte]: twentyMinutesAgo
            }
        },
        order: [['startTime', 'ASC']]
    });
};

/**
 * Finds website generation history for a specific conversation
 * @param {string} conversationId - MongoDB conversation ID
 * @param {number} limit - Maximum number of results
 * @returns {Promise<Array>} Website generation history
 */
WebsiteGeneration.findByConversation = async function(conversationId, limit = 10) {
    return await this.findAll({
        where: { conversationId },
        order: [['createdAt', 'DESC']],
        limit
    });
};

/**
 * Cleans up old completed/failed records older than specified days
 * @param {number} daysOld - Number of days to retain (default: 30)
 * @returns {Promise<number>} Number of records deleted
 */
WebsiteGeneration.cleanupOldRecords = async function(daysOld = 30) {
    const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    
    const deletedCount = await this.destroy({
        where: {
            completedAt: {
                [require('sequelize').Op.lt]: cutoffDate
            },
            status: ['completed', 'failed', 'timeout']
        }
    });
    
    return deletedCount;
};

    return WebsiteGeneration;
};
