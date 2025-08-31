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

module.exports = { sendUltraMsg, sendUltraMsgWithRetry };
