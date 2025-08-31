// services/ultramsgService.js
const axios = require('axios');

// Use environment variable directly (consistent with rest of codebase)
const ULTRAMSG_BASE_URL = process.env.ULTRAMSG_BASE_URL || 'https://api.ultramsg.com/instance';

async function sendUltraMsg(agent, to, message, messageToQuote) {
  console.log('messageToQuote', messageToQuote);
  console.log('Received agent object');
  
  // 🔧 Enhanced validation to prevent undefined errors
  if (!agent || typeof agent !== 'object') {
    console.error('Invalid agent object:', agent);
    throw new Error('Invalid agent object');
  }
  if (!agent.instanceId) {
    console.error('Missing instanceId in agent object:', agent);
    throw new Error('Missing instanceId in agent object');
  }
  if (!to) {
    console.error('Missing "to" parameter (phone number):', to);
    throw new Error('Missing "to" parameter - phone number is required');
  }
  if (!message) {
    console.error('Missing message content:', message);
    throw new Error('Missing message content');
  }

  // Convert instanceId to string if it's a number
  const instanceId = typeof agent.instanceId === 'number' ? agent.instanceId.toString() : agent.instanceId;

  const dynamicApiEndpoint = '/messages/chat';
  const instanceUrl = `${ULTRAMSG_BASE_URL}${instanceId}${dynamicApiEndpoint}`;
  
  // Ensure 'to' is a string and clean it properly
  const cleanTo = String(to).replace('@c.us', '');
  console.log(`[ULTRAMSG] Sending to: ${cleanTo} (original: ${to})`);
  
  const data = JSON.stringify({
    "token": agent.token,
    "to": cleanTo,
    "body": message,
    "priority": 1,
    "referenceId": "",
    "msgId": messageToQuote || "",
    "mentions": ""
  });

  const config = {
    method: 'post',
    url: `${instanceUrl}`,
    headers: { 
      'Content-Type': 'application/json'
    },
    data: data
  };

  try {
    const response = await axios(config);
    console.log('UltraMsg API response:', response.data);
    return { sent: 'true', message: 'Message sent successfully', data: response.data };
  } catch (error) {
    console.error('Error sending message via UltraMsg:', error.response ? error.response.data : error.message);
    return { sent: 'false', message: 'Failed to send message', error: error.response ? error.response.data : error.message };
  }
}

async function sendUltraMsgWithRetry(agent, to, message, maxRetries = 3, retryDelay = 3000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await sendUltraMsg(agent, to, message);
      if (result.sent === 'true') {
        return result;
      }
      throw new Error(result.message || 'Failed to send message');
    } catch (error) {
      console.error(`Attempt ${attempt} failed: ${error.message}`);
      if (attempt === maxRetries) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
}

/**
 * Send image message via UltraMsg API
 * @param {Object} agent - Agent configuration with instanceId and token
 * @param {string} to - Phone number to send to
 * @param {string} imageUrl - HTTP URL or base64 data of the image
 * @param {string} caption - Optional caption text for the image
 * @param {string} messageToQuote - Optional message ID to quote
 * @returns {Object} Send result
 */
async function sendUltraMsgImage(agent, to, imageUrl, caption = '', messageToQuote = '') {
  console.log(`[ULTRAMSG] Sending image to: ${to}`);
  
  // Enhanced validation
  if (!agent || typeof agent !== 'object') {
    console.error('Invalid agent object:', agent);
    throw new Error('Invalid agent object');
  }
  if (!agent.instanceId) {
    console.error('Missing instanceId in agent object:', agent);
    throw new Error('Missing instanceId in agent object');
  }
  if (!to) {
    console.error('Missing "to" parameter (phone number):', to);
    throw new Error('Missing "to" parameter - phone number is required');
  }
  if (!imageUrl) {
    console.error('Missing imageUrl parameter:', imageUrl);
    throw new Error('Missing imageUrl parameter - image is required');
  }

  // Convert instanceId to string if it's a number
  const instanceId = typeof agent.instanceId === 'number' ? agent.instanceId.toString() : agent.instanceId;

  const dynamicApiEndpoint = '/messages/image';
  const instanceUrl = `${ULTRAMSG_BASE_URL}${instanceId}${dynamicApiEndpoint}`;
  
  // Ensure 'to' is a string and clean it properly
  const cleanTo = String(to).replace('@c.us', '');
  console.log(`[ULTRAMSG] Sending image to: ${cleanTo}, caption: ${caption ? 'yes' : 'no'}`);
  
  const requestData = {
    "token": agent.token,
    "to": cleanTo,
    "image": imageUrl,
    "caption": caption || '',
    "priority": 1,
    "referenceId": "",
    "msgId": messageToQuote || "",
    "mentions": ""
  };

  const config = {
    method: 'post',
    url: instanceUrl,
    headers: { 
      'Content-Type': 'application/json'
    },
    data: JSON.stringify(requestData)
  };

  try {
    console.log(`📤 [ULTRAMSG] Sending image request:`, {
      endpoint: dynamicApiEndpoint,
      to: cleanTo,
      hasCaption: !!caption,
      imageType: imageUrl.startsWith('data:') ? 'base64' : 'url'
    });

    const response = await axios(config);
    console.log('UltraMsg Image API response:', response.data);
    return { sent: 'true', message: 'Image sent successfully', data: response.data };
  } catch (error) {
    console.error('Error sending image via UltraMsg:', error.response ? error.response.data : error.message);
    return { sent: 'false', message: 'Failed to send image', error: error.response ? error.response.data : error.message };
  }
}

/**
 * Determine optimal UltraMsg sending method based on content
 * @param {Object} agent - Agent configuration
 * @param {string} to - Phone number
 * @param {Object} content - Content object with text and/or images
 * @param {string} messageToQuote - Optional message to quote
 * @returns {Object} Send result
 */
async function sendUltraMsgSmart(agent, to, content, messageToQuote = '') {
  try {
    const { textResponse, generatedImages } = content;
    
    console.log(`📤 [ULTRAMSG] Smart sending analysis:`, {
      hasText: !!textResponse,
      hasImages: generatedImages && generatedImages.length > 0,
      imageCount: generatedImages ? generatedImages.length : 0
    });

    // Case 1: Only text, no images
    if ((!generatedImages || generatedImages.length === 0) && textResponse) {
      console.log(`📝 [ULTRAMSG] Sending text-only message`);
      return await sendUltraMsg(agent, to, textResponse, messageToQuote);
    }

    // Case 2: Images with or without text
    if (generatedImages && generatedImages.length > 0) {
      console.log(`🖼️ [ULTRAMSG] Sending image with ${textResponse ? 'caption' : 'no caption'}`);
      
      // Send the first generated image (most common case)
      const primaryImage = generatedImages[0];
      const imageUrl = primaryImage.externalUrl || primaryImage.downloadUrl;
      const caption = textResponse || '';
      
      return await sendUltraMsgImage(agent, to, imageUrl, caption, messageToQuote);
    }

    // Case 3: No content (fallback)
    console.warn(`⚠️ [ULTRAMSG] No content to send, using fallback message`);
    return await sendUltraMsg(agent, to, 'Procesamiento completado', messageToQuote);

  } catch (error) {
    console.error(`❌ [ULTRAMSG] Smart sending failed:`, error.message);
    // Fallback to regular text message
    const fallbackMessage = content.textResponse || 'Hubo un problema procesando tu solicitud';
    return await sendUltraMsg(agent, to, fallbackMessage, messageToQuote);
  }
}

module.exports = { 
  sendUltraMsg, 
  sendUltraMsgWithRetry, 
  sendUltraMsgImage,
  sendUltraMsgSmart 
};
