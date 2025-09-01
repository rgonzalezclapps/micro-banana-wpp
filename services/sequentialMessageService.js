/**
 * services/sequentialMessageService.js
 * 
 * Description: Sequential message delivery service for multiple Gemini outputs via UltraMsg
 * 
 * Role in the system: Handles sequential delivery of multiple images + text responses from Gemini to WhatsApp
 * 
 * Node.js Context: Service - Specialized service for multi-part message delivery with proper timing
 * 
 * Dependencies:
 * - services/ultramsgService.js (WhatsApp message sending)
 * - Delays and rate limiting for optimal UltraMsg delivery
 * 
 * Dependants:
 * - modules/messageQueue.js (processes Gemini results)
 * - modules/openaiIntegration.js (handles tool outputs)
 */

const ultramsgService = require('./ultramsgService');

class SequentialMessageService {
  constructor() {
    // Delivery configuration
    this.MESSAGE_DELAY = 1500; // 1.5 seconds between messages to avoid rate limiting
    this.MAX_RETRIES = 2; // Retry failed messages
    this.RETRY_DELAY = 3000; // 3 seconds delay before retry
  }

  /**
   * Send multiple Gemini results sequentially via UltraMsg
   * @param {Object} agent - Agent with UltraMsg credentials
   * @param {string} phoneNumber - Target phone number
   * @param {Object} geminiResults - Results from Gemini with multiple images/text
   * @param {string} requestId - Request ID for logging
   * @returns {Array} Array of delivery results
   */
  async sendMultipleGeminiResults(agent, phoneNumber, geminiResults, requestId) {
    console.log(`📤 [${requestId}] Starting sequential delivery`, {
      phoneNumber,
      agentId: agent.id,
      imageCount: geminiResults.generatedImages.length,
      hasTextResponse: !!geminiResults.textResponse,
      totalParts: geminiResults.conversationParts?.length || 0
    });

    const deliveries = [];
    
    try {
      // Strategy 1: Text-only response (no images)
      if ((!geminiResults.generatedImages || geminiResults.generatedImages.length === 0) && geminiResults.textResponse) {
        console.log(`📝 [${requestId}] Sending text-only response`);
        
        const result = await this.sendWithRetry(
          () => ultramsgService.sendUltraMsg(agent, phoneNumber, geminiResults.textResponse),
          requestId,
          'text-only'
        );
        
        deliveries.push({ 
          type: 'text', 
          content: geminiResults.textResponse,
          result,
          order: 0 
        });
        
        return deliveries;
      }

      // Strategy 2: Images with sequential delivery
      if (geminiResults.generatedImages && geminiResults.generatedImages.length > 0) {
        console.log(`🖼️ [${requestId}] Sending ${geminiResults.generatedImages.length} images sequentially`);
        
        // Sort images by responseOrder to maintain correct sequence
        const sortedImages = [...geminiResults.generatedImages].sort((a, b) => 
          (a.responseOrder || 0) - (b.responseOrder || 0)
        );
        
        for (const [index, generatedImage] of sortedImages.entries()) {
          try {
            // Determine caption for this image
            let caption = '';
            
            if (index === 0 && geminiResults.textResponse) {
              // First image gets the main text response as caption
              caption = geminiResults.textResponse;
            } else if (generatedImage.associatedText) {
              // Image has specific associated text
              caption = generatedImage.associatedText;
            }
            
            // Use external URL for UltraMsg (better for WhatsApp delivery)
            const imageUrl = generatedImage.externalUrl || generatedImage.downloadUrl;
            
            console.log(`📸 [${requestId}] Sending image ${index + 1}/${sortedImages.length}`, {
              fileId: generatedImage.fileId,
              hasCaption: !!caption,
              captionLength: caption.length,
              responseOrder: generatedImage.responseOrder
            });
            
            const result = await this.sendWithRetry(
              () => ultramsgService.sendUltraMsgImage(agent, phoneNumber, imageUrl, caption),
              requestId,
              `image-${index + 1}`
            );
            
            deliveries.push({ 
              type: 'image',
              imageFileId: generatedImage.fileId,
              imageUrl,
              caption,
              responseOrder: generatedImage.responseOrder,
              result,
              order: index
            });
            
            // Delay between messages (except for the last one)
            if (index < sortedImages.length - 1) {
              console.log(`⏳ [${requestId}] Waiting ${this.MESSAGE_DELAY}ms before next image...`);
              await new Promise(resolve => setTimeout(resolve, this.MESSAGE_DELAY));
            }
            
          } catch (imageError) {
            console.error(`❌ [${requestId}] Failed to send image ${index + 1}:`, imageError.message);
            
            deliveries.push({ 
              type: 'image',
              imageFileId: generatedImage.fileId,
              error: imageError.message,
              result: { sent: 'false', error: imageError.message },
              order: index
            });
          }
        }
      }

      // Strategy 3: Handle text that wasn't associated with images
      if (geminiResults.textResponse && geminiResults.generatedImages.length === 0) {
        console.log(`📝 [${requestId}] Sending remaining text response`);
        
        const result = await this.sendWithRetry(
          () => ultramsgService.sendUltraMsg(agent, phoneNumber, geminiResults.textResponse),
          requestId,
          'remaining-text'
        );
        
        deliveries.push({ 
          type: 'text', 
          content: geminiResults.textResponse,
          result,
          order: deliveries.length 
        });
      }

      const successCount = deliveries.filter(d => d.result.sent === 'true').length;
      console.log(`✅ [${requestId}] Sequential delivery completed`, {
        totalDeliveries: deliveries.length,
        successful: successCount,
        failed: deliveries.length - successCount
      });
      
      return deliveries;

    } catch (error) {
      console.error(`❌ [${requestId}] Sequential delivery failed:`, error.message);
      
      deliveries.push({
        type: 'error',
        error: error.message,
        result: { sent: 'false', error: error.message },
        order: 0
      });
      
      return deliveries;
    }
  }

  /**
   * Send single message with retry logic
   * @param {Function} sendFunction - Function that sends the message
   * @param {string} requestId - Request ID for logging
   * @param {string} messageType - Type of message for logging
   * @returns {Object} Send result
   */
  async sendWithRetry(sendFunction, requestId, messageType) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`📤 [${requestId}] Sending ${messageType} (attempt ${attempt})`);
        
        const result = await sendFunction();
        
        if (result.sent === 'true') {
          console.log(`✅ [${requestId}] ${messageType} sent successfully on attempt ${attempt}`);
          return result;
        } else {
          throw new Error(result.message || 'Unknown send error');
        }
        
      } catch (error) {
        lastError = error;
        console.warn(`⚠️ [${requestId}] ${messageType} failed on attempt ${attempt}:`, error.message);
        
        if (attempt <= this.MAX_RETRIES) {
          console.log(`⏳ [${requestId}] Waiting ${this.RETRY_DELAY}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY));
        }
      }
    }
    
    // All retries failed
    console.error(`❌ [${requestId}] ${messageType} failed after ${this.MAX_RETRIES + 1} attempts:`, lastError.message);
    return { sent: 'false', message: lastError.message, error: lastError.message };
  }

  /**
   * Send simple text message (helper for backward compatibility)
   * @param {Object} agent - Agent with UltraMsg credentials
   * @param {string} phoneNumber - Target phone number
   * @param {string} textMessage - Text message to send
   * @param {string} requestId - Request ID for logging
   * @returns {Object} Send result
   */
  async sendSimpleText(agent, phoneNumber, textMessage, requestId) {
    console.log(`📤 [${requestId}] Sending simple text message`, {
      phoneNumber,
      messageLength: textMessage.length
    });
    
    return await this.sendWithRetry(
      () => ultramsgService.sendUltraMsg(agent, phoneNumber, textMessage),
      requestId,
      'simple-text'
    );
  }

  /**
   * Health check for sequential message service
   */
  healthCheck() {
    return {
      status: 'healthy',
      messageDelay: this.MESSAGE_DELAY,
      maxRetries: this.MAX_RETRIES,
      retryDelay: this.RETRY_DELAY,
      timestamp: new Date().toISOString()
    };
  }
}

// Export singleton instance
const sequentialMessageService = new SequentialMessageService();

module.exports = sequentialMessageService;
