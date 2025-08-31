// routes/webhookRoutes.js
const express = require('express');
const router = express.Router();
const { redisClient } = require('../database'); // Import Redis client
const { Agent } = require('../models');
const Conversation = require('../models/Conversation');
const openAIIntegration = require('../modules/openaiIntegration');
const { sendUltraMsg, clearUltraMsgQueue } = require('../services/ultramsgService');
const { Op } = require('sequelize');
const mongoose = require('mongoose');
const { processMessage } = require('../modules/messageProcessor');
const { 
  getOrCreateConversation, 
  updateConversationData, 
  formatConversationForList,
  getOrCreateParticipant
} = require('../modules/conversationManager');
const messageQueue = require('../modules/messageQueue');

// Removed healthcare-specific tools for generic chatbot engine
const { detectProvider } = require('../services/providerDetector');
const { normalizeMessage } = require('../services/messageAdapter');

const processedMessageIds = new Map();

// Constants
const AUDIO_TRANSCRIPTION_TIMEOUT = 600000; // 10 minutes in milliseconds
const MAX_STRIKES = 3;
const STRIKE_TIMEOUT = 60000; // 1 minute per strike

router.post('/', async (req, res) => {
  
  const webhookStart = Date.now();
  const requestId = `req_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`\n🚀 [${requestId}] Webhook received from ${req.headers['user-agent'] || 'unknown'}`);

  // TO DO ASAP - Implement supporting Clapps WhatsApp

  try {
    // Detectar el proveedor del mensaje
    const provider = detectProvider(req);
    // Normalizar el mensaje al formato UltraMessage
    let normalizedBody;
    try {
      normalizedBody = normalizeMessage(req, provider);
      console.log(`📨 [${requestId}] Provider: ${provider}, Event: ${normalizedBody.event_type}, MessageID: ${normalizedBody.data?.id}`);
    } catch (adaptationError) {
      console.error(`❌ [${requestId}] Message adaptation error:`, adaptationError.message);
      return res.status(400).json({ 
        message: 'Error adapting message format', 
        error: adaptationError.message 
      });
    }

    // Extraer datos normalizados
    const { event_type, instanceId, data } = normalizedBody;

    // Verificar duplicados con Redis
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      const messageId = data?.id;
      const timestamp = new Date().toISOString();
      
      if (messageId) {
        const redisKey = `processed:${messageId}`;
        const isProcessed = await redisClient.get(redisKey);
        
        if (isProcessed) {
          console.log(`🔄 [${requestId}] Duplicate message detected: ${messageId} (webhook retry)`);
          return res.status(200).json({ message: 'Message already processed' });
        }
        
        await redisClient.set(redisKey, timestamp, { EX: 600 });
        console.log(`✅ [${requestId}] New message: ${messageId}`);
      } else {
        console.log(`⚠️ [${requestId}] No messageId found, skipping duplicate check`);
      }
    } catch (redisError) {
      console.error('Redis error:', redisError);
      // Continuar procesamiento aunque Redis falle
    }
    
    // 🚀 FAST RESPONSE: Respond to webhook immediately to prevent retries
    res.status(200).json({ 
      message: 'Webhook received', 
      messageId: data?.id,
      provider: provider,
      eventType: event_type,
      processingAsync: true
    });

    console.log(`⚡ [${requestId}] Processing message async...`);

    // Continue processing asynchronously (don't await)
    processWebhookAsync(requestId, webhookStart, provider, normalizedBody, event_type, instanceId, data)
      .catch(error => {
        console.error(`❌ [${requestId}] Async processing failed:`, error);
      });
  } catch (error) {
    const webhookEnd = Date.now();
    const processingTime = webhookEnd - webhookStart;
    console.error(`❌ [${requestId}] WEBHOOK ERROR - Processing time: ${processingTime}ms`);
    console.error('Error processing webhook:', error);
    res.status(500).json({ 
      message: 'Error processing webhook', 
      error: error.message 
    });
  }
});

// 🚀 Async processing function to handle webhook after fast response
async function processWebhookAsync(requestId, webhookStart, provider, normalizedBody, event_type, instanceId, data) {
  try {
    console.log(`🔄 [${requestId}] Starting async processing...`);
    
    // Buscar agente basado en instanceId y proveedor
    let agent = null;
    
    // Estrategia de búsqueda específica por proveedor
    if (provider === 'whatsapp-factory') {
      // Para WhatsApp Factory, buscar por tipo 'wpp-bsp' y phoneNumberId
      const phoneNumberId = data?.to?.split('@')[0] || instanceId;
      
      agent = await Agent.findOne({ 
        where: { 
          type: 'wpp-bsp',
          instanceId: phoneNumberId,
          deletedAt: null
        } 
      });
      
      if (!agent) {
        // Fallback: buscar por instanceId original
        agent = await Agent.findOne({ 
          where: { 
            type: 'wpp-bsp',
            instanceId: instanceId,
            deletedAt: null
          } 
        });
      }
    } else {
      // Para UltraMessage, usar búsqueda original
      agent = await Agent.findOne({ 
        where: { 
          instanceId: instanceId,
          deletedAt: null
        } 
      });
    }
    
    if (!agent) {
      console.error(`❌ [${requestId}] Agent not found:`, {
        instanceId,
        provider,
        phoneNumberId: data?.to?.split('@')[0],
        suggestion: provider === 'whatsapp-factory' ? 'Configure wpp-bsp agent' : 'Configure openai agent'
      });
      return; // Just log error, webhook already responded
    }

    // Manejar diferentes tipos de eventos
    switch (event_type) {
      case 'message_received':
        await handleMessageReceived(agent, data, event_type, instanceId, provider);
        break;
      case 'message_create':
        console.log(`📝 [${requestId}] Message create received:`, data);
        break;
      case 'message_ack':
        console.log(`✅ [${requestId}] Message ACK received:`, data);
        break;
      case 'message_reaction':
        console.log(`😊 [${requestId}] Message reaction received:`, data);
        break;
      default:
        console.log(`❓ [${requestId}] Event type not supported:`, event_type);
        break;
    }

    // Track async processing completion
    const webhookEnd = Date.now();
    const processingTime = webhookEnd - webhookStart;
    console.log(`✅ [${requestId}] Message processed successfully - ${processingTime}ms`);
    
  } catch (error) {
    const webhookEnd = Date.now();
    const processingTime = webhookEnd - webhookStart;
    console.error(`❌ [${requestId}] ASYNC PROCESSING ERROR - Total time: ${processingTime}ms`);
    console.error('Async processing error:', error);
  }
}

async function handleMessageReceived(agent, data, event_type, instanceId, provider = 'ultramsg') {
  const { from, pushname } = data;
  const phoneNumber = from.split('@')[0];

  console.log('Processing message from provider:', { provider, phoneNumber, pushname, messageId: data.id });

  const participant = await getOrCreateParticipant(phoneNumber, pushname);
  let conversation = await getOrCreateConversation(participant, agent);

  // BACK TO SIMPLE ORIGINAL APPROACH
  const messageData = await processMessage(data, data.type);
  
  // Agregar información del proveedor al messageData para tracking
  messageData.provider = provider;
  if (provider === 'whatsapp-factory') {
    messageData.whatsappFactorySource = true;
  }

  // Update conversation data and save immediately into database
  conversation = await updateConversationData(conversation, messageData, agent, participant);

  // Pure API - no real-time UI events

  // Pure API - no active conversation UI tracking

  // Add message to queue
  await messageQueue.addMessage(conversation, messageData, agent);

  // Pure API - no real-time conversation updates
  
  console.log(`Message processed successfully from ${provider} provider:`, {
    conversationId: conversation._id,
    messageId: data.id,
    phoneNumber
  });
}

// async function handleMessageAck(data) {
//   const { id, ack } = data;

//   // Find the conversation and message by dataId
//   const conversation = await Conversation.findOne({ 'messages.dataId': id });
//   if (!conversation) {
//     console.log('Conversation not found for message ID:', id);
//     return;
//   }

//   const message = conversation.messages.find(msg => msg.dataId === id);
//   if (!message) {
//     console.log('Message not found in conversation for message ID:', id);
//     return;
//   }

//   // Update message status based on ack value
//   switch (ack) {
//     case 'server':
//       message.status = 'sent';
//       break;
//     case 'device':
//       message.status = 'delivered';
//       break;
//     case 'read':
//       message.status = 'read';
//       break;
//     default:
//       console.log('Unknown ack status:', ack);
//       break;
//   }

//   await conversation.save();

//   // Emit socket event
//   global.socketHandler.emitMessageStatusUpdated({
//     conversationId: conversation._id,
//     messageId: message._id,
//     status: message.status
//   });

//   console.log(`Message ${id} status updated to ${message.status}`);
// }

function cleanupProcessedMessageIds() {
  const now = Date.now();
  for (const [messageId, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > 300000) { // Remove entries older than 5 minutes
      processedMessageIds.delete(messageId);
    }
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupProcessedMessageIds, 300000);

module.exports = router;