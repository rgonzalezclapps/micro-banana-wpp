/**
 * models/AIRequest.js
 * 
 * Description: MongoDB model for comprehensive AI request tracking with token counting, 
 *              timing analysis, cancellation tracking, and performance metrics
 * 
 * Role in the system: Enterprise-grade audit trail for every OpenAI API call with 
 *                     microsecond-precision timing and complete token accounting
 * 
 * Node.js Context: Model - AI request analytics and performance monitoring
 * 
 * Dependencies:
 * - mongoose (ODM for MongoDB operations)
 * - Conversation model (for conversationId reference)
 * - Agent model (for agentId reference)
 * - Message model (for message references)
 * 
 * Dependants:
 * - modules/messageQueue.js (request creation and updates)
 * - modules/responsesClient.js (token tracking)
 * - analytics/aiRequestAnalytics.js (future analytics queries)
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ============================================================================
// Sub-Schemas for Structured Data
// ============================================================================

const TokenDetailsSchema = new Schema({
  prompt_tokens: { type: Number, default: 0 },
  cached_tokens: { type: Number, default: 0 },
  audio_tokens: { type: Number, default: 0 }
}, { _id: false });

const TokenOutputSchema = new Schema({
  completion_tokens: { type: Number, default: 0 },
  reasoning_tokens: { type: Number, default: 0 },
  audio_tokens: { type: Number, default: 0 }
}, { _id: false });

const TokenTrackingSchema = new Schema({
  input: { type: TokenDetailsSchema, default: () => ({}) },
  output: { type: TokenOutputSchema, default: () => ({}) },
  total: { type: Number, default: 0 }
}, { _id: false });

const TimestampsSchema = new Schema({
  queueStart: { type: Date, required: true },          // When message added to queue
  processingStart: { type: Date },                     // When executeQueueProcessing started
  openaiRequestStart: { type: Date },                  // When OpenAI request sent
  openaiResponseReceived: { type: Date },              // When OpenAI response received
  messageSendStart: { type: Date },                    // When started sending to user
  messageSendComplete: { type: Date },                 // When user received message
  cancelled: { type: Date },                           // If/when request was cancelled
  completed: { type: Date }                            // When fully completed
}, { _id: false });

const DurationsSchema = new Schema({
  queueWait: { type: Number },           // ms from queue to processing start
  openaiProcessing: { type: Number },    // ms for OpenAI to respond
  messageSending: { type: Number },      // ms to send to user
  total: { type: Number }                // Total end-to-end time in ms
}, { _id: false });

const ToolUsageSchema = new Schema({
  name: { type: String, required: true },
  executionTime: { type: Number },       // ms to execute tool
  success: { type: Boolean, default: true },
  error: String
}, { _id: false });

// ============================================================================
// Main AIRequest Schema
// ============================================================================

const AIRequestSchema = new Schema({
  // === Request Identification ===
  conversationId: {
    type: Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  agentId: {
    type: Schema.Types.ObjectId,
    ref: 'Agent',
    required: true,
    index: true
  },
  
  // === Message References ===
  userMessageIds: [{
    type: Schema.Types.ObjectId,
    ref: 'Message',
    description: 'Array of user message IDs included in this request'
  }],
  aiMessageId: {
    type: Schema.Types.ObjectId,
    ref: 'Message',
    required: false,
    description: 'Reference to AI response message (if generated and saved)'
  },
  
  // === Request Configuration ===
  model: {
    type: String,
    required: true,
    description: 'OpenAI model used (e.g., gpt-5-mini, gpt-5)'
  },
  streaming: {
    type: Boolean,
    default: false,
    description: 'Whether streaming mode was enabled'
  },
  maxCompletionTokens: {
    type: Number,
    description: 'Max tokens configured for this request'
  },
  temperature: {
    type: Number,
    description: 'Temperature setting used'
  },
  
  // === Token Tracking (High Precision) ===
  tokens: {
    type: TokenTrackingSchema,
    default: () => ({}),
    description: 'Complete token usage breakdown from OpenAI response'
  },
  
  // === Timing (Microsecond Precision) ===
  timestamps: {
    type: TimestampsSchema,
    required: true,
    description: 'Complete timeline of request lifecycle'
  },
  
  // === Performance Metrics ===
  durations: {
    type: DurationsSchema,
    default: () => ({}),
    description: 'Calculated duration metrics in milliseconds'
  },
  
  // === Status Tracking ===
  status: {
    type: String,
    enum: ['queued', 'processing', 'completed', 'cancelled', 'failed'],
    default: 'queued',
    index: true,
    description: 'Current status of the AI request'
  },
  
  // === Cancellation Details ===
  cancelReason: {
    type: String,
    enum: ['new_message_arrived', 'abort_signal', 'timeout', 'error', 'user_abort'],
    required: function() { return this.status === 'cancelled'; },
    description: 'Why the request was cancelled'
  },
  cancelledAt: {
    type: String,
    enum: ['before_mongodb', 'before_openai', 'during_openai', 'after_openai_before_send', 'during_send'],
    required: function() { return this.status === 'cancelled'; },
    description: 'At which stage the cancellation occurred'
  },
  
  // === Error Tracking ===
  error: {
    message: { type: String },
    code: { type: String },
    stack: { type: String },
    timestamp: { type: Date }
  },
  
  // === Tool Usage ===
  toolsUsed: [{
    type: ToolUsageSchema,
    description: 'Array of tools called during this request'
  }],
  
  // === OpenAI Response Metadata ===
  openaiResponseId: {
    type: String,
    description: 'OpenAI response ID (e.g., chatcmpl-xxxxx)'
  },
  finishReason: {
    type: String,
    enum: ['stop', 'length', 'tool_calls', 'content_filter', 'aborted'],
    description: 'How OpenAI completed the response'
  },
  
  // === Context Metadata ===
  messageCount: {
    type: Number,
    description: 'Number of messages in conversation context sent to OpenAI'
  },
  hasImages: {
    type: Boolean,
    default: false,
    description: 'Whether images were included in the request'
  },
  imageCount: {
    type: Number,
    default: 0,
    description: 'Number of images included (blobs, not placeholders)'
  },
  
  // === Cost Calculation ===
  estimatedCostUSD: {
    type: Number,
    description: 'Estimated cost based on token usage and model pricing'
  }
  
}, {
  timestamps: true,  // Adds createdAt and updatedAt
  collection: 'ai_requests'
});

// ============================================================================
// Indexes for Performance
// ============================================================================

// Primary query patterns
AIRequestSchema.index({ conversationId: 1, 'timestamps.queueStart': -1 });
AIRequestSchema.index({ agentId: 1, status: 1 });
AIRequestSchema.index({ status: 1, 'timestamps.queueStart': -1 });

// Analytics queries
AIRequestSchema.index({ status: 1, createdAt: -1 });
AIRequestSchema.index({ 'tokens.total': -1 }); // Find expensive requests
AIRequestSchema.index({ cancelReason: 1, status: 1 }, { sparse: true }); // Cancellation analysis

// ============================================================================
// Instance Methods
// ============================================================================

/**
 * Calculate and update all duration metrics
 */
AIRequestSchema.methods.calculateDurations = function() {
  const ts = this.timestamps;
  
  if (ts.processingStart && ts.queueStart) {
    this.durations.queueWait = ts.processingStart - ts.queueStart;
  }
  
  if (ts.openaiResponseReceived && ts.openaiRequestStart) {
    this.durations.openaiProcessing = ts.openaiResponseReceived - ts.openaiRequestStart;
  }
  
  if (ts.messageSendComplete && ts.messageSendStart) {
    this.durations.messageSending = ts.messageSendComplete - ts.messageSendStart;
  }
  
  if (ts.completed && ts.queueStart) {
    this.durations.total = ts.completed - ts.queueStart;
  } else if (ts.cancelled && ts.queueStart) {
    this.durations.total = ts.cancelled - ts.queueStart;
  }
  
  return this.durations;
};

/**
 * Estimate cost based on token usage
 * @param {Object} pricing - Model pricing object { input: X, output: Y }
 */
AIRequestSchema.methods.estimateCost = function(pricing = { input: 0.001, output: 0.003 }) {
  const inputCost = (this.tokens.input.prompt_tokens || 0) * pricing.input / 1000;
  const outputCost = (this.tokens.output.completion_tokens || 0) * pricing.output / 1000;
  
  this.estimatedCostUSD = inputCost + outputCost;
  return this.estimatedCostUSD;
};

/**
 * Mark request as cancelled with reason and stage
 */
AIRequestSchema.methods.markCancelled = async function(reason, stage) {
  this.status = 'cancelled';
  this.cancelReason = reason;
  this.cancelledAt = stage;
  this.timestamps.cancelled = new Date();
  
  // Calculate durations up to cancellation point
  this.calculateDurations();
  
  await this.save();
  
  return this;
};

/**
 * Mark request as completed and calculate all metrics
 */
AIRequestSchema.methods.markCompleted = async function(tokensData, openaiResponseId, finishReason) {
  this.status = 'completed';
  this.timestamps.completed = new Date();
  
  // Update token data if provided
  if (tokensData) {
    this.tokens = tokensData;
    this.estimateCost();
  }
  
  if (openaiResponseId) {
    this.openaiResponseId = openaiResponseId;
  }
  
  if (finishReason) {
    this.finishReason = finishReason;
  }
  
  // Calculate all durations
  this.calculateDurations();
  
  await this.save();
  
  return this;
};

// ============================================================================
// Static Methods
// ============================================================================

/**
 * Get analytics for conversation
 */
AIRequestSchema.statics.getConversationAnalytics = async function(conversationId) {
  const requests = await this.find({ conversationId }).sort({ createdAt: -1 });
  
  const analytics = {
    totalRequests: requests.length,
    completed: requests.filter(r => r.status === 'completed').length,
    cancelled: requests.filter(r => r.status === 'cancelled').length,
    failed: requests.filter(r => r.status === 'failed').length,
    totalTokens: requests.reduce((sum, r) => sum + (r.tokens?.total || 0), 0),
    avgDuration: 0,
    totalCost: requests.reduce((sum, r) => sum + (r.estimatedCostUSD || 0), 0)
  };
  
  const completedDurations = requests
    .filter(r => r.durations?.total)
    .map(r => r.durations.total);
  
  if (completedDurations.length > 0) {
    analytics.avgDuration = completedDurations.reduce((a, b) => a + b, 0) / completedDurations.length;
  }
  
  return analytics;
};

/**
 * Find requests that should be cleaned up (old cancelled/failed requests)
 */
AIRequestSchema.statics.findStaleRequests = async function(daysOld = 30) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  return await this.find({
    status: { $in: ['cancelled', 'failed'] },
    createdAt: { $lt: cutoffDate }
  });
};

// ============================================================================
// Export Model
// ============================================================================

const AIRequest = mongoose.model('AIRequest', AIRequestSchema);

module.exports = AIRequest;

