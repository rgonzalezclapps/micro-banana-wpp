/**
 * utils/performanceTracker.js
 * 
 * Description: Centralized performance tracking utility with microsecond precision
 *              for measuring request timing and identifying bottlenecks
 * 
 * Role in the system: Provides consistent performance measurement across all modules
 *                     with detailed checkpoint tracking and timeline logging
 * 
 * Node.js Context: Utility - Performance measurement and bottleneck analysis
 * 
 * Dependencies:
 * - Node.js performance API (performance.now())
 * 
 * Dependants:
 * - modules/messageQueue.js (message processing tracking)
 * - modules/responsesClient.js (OpenAI request tracking)
 * - modules/openaiIntegration.js (API call tracking)
 */

/**
 * PerformanceTracker - High-precision timing tracker for request lifecycle
 */
class PerformanceTracker {
  constructor(identifier) {
    this.identifier = identifier;
    this.startTime = performance.now();
    this.checkpoints = [];
    this.metadata = {};
  }
  
  /**
   * Add a checkpoint with name and optional metadata
   * @param {string} name - Checkpoint name
   * @param {Object} metadata - Optional metadata to log
   */
  checkpoint(name, metadata = {}) {
    const now = performance.now();
    const elapsed = now - this.startTime;
    
    const checkpoint = {
      name,
      timestamp: now,
      elapsed: Math.round(elapsed),
      metadata
    };
    
    this.checkpoints.push(checkpoint);
    
    return checkpoint;
  }
  
  /**
   * Get elapsed time since start
   * @returns {number} Milliseconds elapsed
   */
  elapsed() {
    return Math.round(performance.now() - this.startTime);
  }
  
  /**
   * Get duration between two checkpoints
   * @param {string} from - From checkpoint name
   * @param {string} to - To checkpoint name
   * @returns {number} Duration in milliseconds
   */
  duration(from, to) {
    const fromCheckpoint = this.checkpoints.find(c => c.name === from);
    const toCheckpoint = this.checkpoints.find(c => c.name === to);
    
    if (!fromCheckpoint || !toCheckpoint) {
      return 0;
    }
    
    return toCheckpoint.elapsed - fromCheckpoint.elapsed;
  }
  
  /**
   * Add metadata to tracker
   * @param {string} key - Metadata key
   * @param {*} value - Metadata value
   */
  addMetadata(key, value) {
    this.metadata[key] = value;
  }
  
  /**
   * Get formatted log prefix with elapsed time
   * @returns {string} Formatted prefix like "[+123ms]"
   */
  prefix() {
    return `[+${this.elapsed()}ms]`;
  }
  
  /**
   * Log checkpoint with formatted message
   * @param {string} name - Checkpoint name
   * @param {string} message - Log message
   * @param {Object} metadata - Optional metadata
   */
  log(name, message, metadata = {}) {
    const checkpoint = this.checkpoint(name, metadata);
    console.log(`${this.prefix()} ${message}`, Object.keys(metadata).length > 0 ? metadata : '');
    return checkpoint;
  }
  
  /**
   * Get complete timeline summary
   * @returns {Object} Timeline summary
   */
  getSummary() {
    return {
      identifier: this.identifier,
      totalElapsed: this.elapsed(),
      checkpoints: this.checkpoints.map(c => ({
        name: c.name,
        elapsed: c.elapsed,
        metadata: c.metadata
      })),
      metadata: this.metadata
    };
  }
  
  /**
   * Log complete timeline to console
   */
  logTimeline() {
    console.log(`\n📊 PERFORMANCE TIMELINE: ${this.identifier}`);
    console.log(`⏱️  Total: ${this.elapsed()}ms`);
    console.log(`📈 Checkpoints:`);
    
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      const delta = i > 0 ? cp.elapsed - this.checkpoints[i-1].elapsed : cp.elapsed;
      
      console.log(`  [+${cp.elapsed}ms] ${cp.name} (+${delta}ms from previous)`);
      
      if (Object.keys(cp.metadata).length > 0) {
        console.log(`    Metadata:`, cp.metadata);
      }
    }
    
    if (Object.keys(this.metadata).length > 0) {
      console.log(`🏷️  Request Metadata:`, this.metadata);
    }
    
    console.log(''); // Empty line for readability
  }
  
  /**
   * Export data for AIRequest model
   * @returns {Object} Data formatted for AIRequest timestamps and durations
   */
  exportForAIRequest() {
    const timestamps = {};
    const durations = {};
    
    // Map checkpoints to AIRequest timestamp fields
    const checkpointMap = {
      'queue_start': 'queueStart',
      'processing_start': 'processingStart',
      'openai_request_start': 'openaiRequestStart',
      'openai_response_received': 'openaiResponseReceived',
      'message_send_start': 'messageSendStart',
      'message_send_complete': 'messageSendComplete',
      'cancelled': 'cancelled',
      'completed': 'completed'
    };
    
    for (const cp of this.checkpoints) {
      if (checkpointMap[cp.name]) {
        timestamps[checkpointMap[cp.name]] = new Date(Date.now() - (this.elapsed() - cp.elapsed));
      }
    }
    
    // Calculate durations
    if (timestamps.processingStart && timestamps.queueStart) {
      durations.queueWait = timestamps.processingStart - timestamps.queueStart;
    }
    
    if (timestamps.openaiResponseReceived && timestamps.openaiRequestStart) {
      durations.openaiProcessing = timestamps.openaiResponseReceived - timestamps.openaiRequestStart;
    }
    
    if (timestamps.messageSendComplete && timestamps.messageSendStart) {
      durations.messageSending = timestamps.messageSendComplete - timestamps.messageSendStart;
    }
    
    if (timestamps.completed && timestamps.queueStart) {
      durations.total = timestamps.completed - timestamps.queueStart;
    } else if (timestamps.cancelled && timestamps.queueStart) {
      durations.total = timestamps.cancelled - timestamps.queueStart;
    }
    
    return { timestamps, durations };
  }
}

/**
 * Create a new performance tracker
 * @param {string} identifier - Unique identifier (e.g., conversationId)
 * @returns {PerformanceTracker} New tracker instance
 */
function createTracker(identifier) {
  return new PerformanceTracker(identifier);
}

/**
 * Format elapsed time for logging
 * @param {number} startTime - Start time from performance.now()
 * @returns {string} Formatted like "[+123ms]"
 */
function formatElapsed(startTime) {
  const elapsed = Math.round(performance.now() - startTime);
  return `[+${elapsed}ms]`;
}

// ============================================================================
// Export
// ============================================================================

module.exports = {
  PerformanceTracker,
  createTracker,
  formatElapsed
};

