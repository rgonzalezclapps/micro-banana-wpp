/**
 * routes/webhookRoutes.js
 * 
 * Description: Unified webhook handling with MongoDB Agent queries
 * 
 * Role in the system: Entry point for all external platform webhooks (WhatsApp, MercadoPago, etc.)
 * 
 * Node.js Context: Route - webhook processing with provider detection and authentication
 * 
 * Dependencies:
 * - express
 * - database/index.js (Redis client)
 * - models/Agent (MongoDB)
 * - models/Conversation (MongoDB)
 * - modules/* (message processing and queue)
 * 
 * Dependants:
 * - External platforms (WhatsApp, UltraMsg, Botmaker, MercadoPago, WhatsApp Factory)
 */

const express = require('express');
const router = express.Router();
const { redisClient } = require('../database');
const Agent = require('../models/Agent');
const Conversation = require('../models/Conversation');
const openAIIntegration = require('../modules/openaiIntegration');
const { sendUltraMsg, clearUltraMsgQueue } = require('../services/ultramsgService');
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

  try {
    // 🔍 STEP 1: Detect provider FIRST to determine authentication method
    const provider = detectProvider(req);
    console.log(`🔍 [${requestId}] Provider detected: ${provider}`);

    // 🔧 CRITICAL: Extract MercadoPago dataId ONCE for entire request scope
    let mpDataId = null;
    if (provider === 'mercadopago') {
      mpDataId = req.query['data.id'] ||  // Query param: ?data.id=123456 (payment webhooks)
                 req.body?.data?.id ||     // Body: {"data": {"id": "123456"}} (payment webhooks)
                 req.query.id ||           // Query param: ?id=33652629180 (Feed v2.0 + merchant_order)
                 req.body?.id ||           // Body: {"id": "123456"} (alternative format)
                 req.params?.id;           // URL param fallback
    }

    // 🔒 STEP 2: Apply provider-specific authentication
    if (provider === 'mercadopago') {
      console.log(`🔐 [${requestId}] Applying MercadoPago X-Signature authentication...`);
      
      // MercadoPago uses X-Signature validation
      const signature = req.headers['x-signature'];
      const xRequestId = req.headers['x-request-id'];
      
      console.log(`🔍 [${requestId}] MercadoPago auth - Headers: {
        hasSignature: ${!!signature},
        hasRequestId: ${!!xRequestId},
        dataId: ${mpDataId || 'NOT_FOUND'},
        queryDataId: ${req.query['data.id'] || 'NOT_FOUND'},
        bodyDataId: ${req.body?.data?.id || 'NOT_FOUND'},
        queryId: ${req.query.id || 'NOT_FOUND'},
        bodyId: ${req.body?.id || 'NOT_FOUND'},
        webhookType: ${req.body?.type || req.body?.topic || req.query?.topic || 'NOT_FOUND'},
        hasSecretKey: ${!!process.env.MP_SECRET_KEY}
      }`);
      
      // 🔍 DEEP TRACE: Log complete request details for failed webhooks
      if (!mpDataId) {
        console.log(`🔍 [${requestId}] DEEP TRACE - Complete request analysis:`);
        console.log(`   📄 Query params:`, JSON.stringify(req.query, null, 2));
        console.log(`   📄 Body content:`, JSON.stringify(req.body, null, 2));
        console.log(`   📄 Headers relevant:`, {
          'user-agent': req.headers['user-agent'],
          'content-type': req.headers['content-type'],
          'x-signature': req.headers['x-signature']?.substring(0, 20) + '...',
          'x-request-id': req.headers['x-request-id']
        });
      }

      // Validate required MP webhook elements (signature always required)
      if (!signature || !xRequestId) {
        const missing = [];
        if (!signature) missing.push('x-signature');
        if (!xRequestId) missing.push('x-request-id');
        
        console.warn(`🚫 [${requestId}] Authentication failed for mercadopago: missing_${missing.join('_')}`);
        return res.status(401).json({ 
          error: 'MERCADOPAGO_AUTH_FAILED',
          message: `Missing required MercadoPago headers: ${missing.join(', ')}` 
        });
      }
      
      // 🔧 ARCHITECTURAL FIX: Handle different webhook types  
      const webhookType = req.body?.type || req.body?.topic || req.query?.topic || 'payment'; // Default to payment for Feed webhooks
      
      // 🔧 STRATEGIC FIX: Handle merchant_order webhooks separately  
      if (webhookType === 'merchant_order') {
        console.log(`ℹ️ [${requestId}] merchant_order webhook - acknowledged without strict processing`);
        console.log(`📄 [${requestId}] merchant_order details: id=${req.query.id || mpDataId}, resource=${req.body?.resource}`);
        
        // merchant_order webhooks are informational - acknowledge but don't process credits
        return res.status(200).json({ 
          message: 'merchant_order webhook acknowledged',
          type: 'merchant_order',
          id: req.query.id || mpDataId,
          note: 'merchant_order notifications are informational and do not trigger credit processing'
        });
      }
      
      if (!mpDataId) {
        console.warn(`🚫 [${requestId}] Authentication failed for mercadopago: missing_data_id for ${webhookType || 'unknown'} webhook`);
        return res.status(401).json({ 
          error: 'MERCADOPAGO_AUTH_FAILED',
          message: `Missing data.id for ${webhookType || 'unknown'} webhook` 
        });
      }

      // MercadoPago signature validation will be done in the MP handler
      console.log(`✅ [${requestId}] MercadoPago authentication elements validated for ${webhookType} webhook`);
      
    } else {
      console.log(`🔐 [${requestId}] Applying standard API Key authentication for provider: ${provider}`);
      
      // Standard providers use API Key authentication  
  const providedApiKey = req.headers['x-api-key'] || 
                        req.headers['authorization']?.replace('Bearer ', '') ||
                        req.query.api_key ||
                        req.query.key;
  const expectedApiKey = process.env.API_KEY_WEBHOOK;
  
  if (!expectedApiKey) {
    console.error(`❌ [${requestId}] API_KEY_WEBHOOK not configured in environment`);
    return res.status(500).json({ 
      error: 'WEBHOOK_MISCONFIGURED',
      message: 'Webhook authentication not configured' 
    });
  }
  
  if (!providedApiKey || providedApiKey !== expectedApiKey) {
    console.warn(`🚫 [${requestId}] Unauthorized webhook attempt from ${req.ip} - Invalid API key`);
    return res.status(401).json({ 
      error: 'UNAUTHORIZED',
      message: 'Valid API key required. Provide via X-API-Key header, Authorization Bearer token, or ?api_key= query parameter.' 
    });
  }
  
      console.log(`✅ [${requestId}] API key authenticated successfully for ${provider}`);
    }
    
    // Manejar MercadoPago webhooks separadamente
    if (provider === 'mercadopago') {
      console.log(`💳 [${requestId}] Processing authenticated MercadoPago webhook`);
      
      const mercadopagoService = require('../services/mercadopagoService');
      const ultramsgService = require('../services/ultramsgService');
      
      // Use dataId already extracted in auth section (lines 69-73)
      // No need to re-extract - prevents Feed v2.0 bug
      const signature = req.headers['x-signature'];
      const xRequestId = req.headers['x-request-id'];
      // dataId already available from auth section
      
      console.log(`🔐 [${requestId}] MercadoPago webhook details:`, {
        type: req.body.type,
        action: req.body.action,
        dataIdFromQuery: req.query['data.id'],
        dataIdFromBody: req.body.data?.id,
        dataIdFromQueryId: req.query.id,  // Feed v2.0 uses this
        finalDataId: mpDataId,  // Reusing extracted value from auth section
        liveMode: req.body.live_mode,
        userId: req.body.user_id,
        hasSignature: !!signature,
        hasRequestId: !!xRequestId,
        mpSecretConfigured: !!process.env.MP_SECRET_KEY
      });
      
      // Procesar notificación de MercadoPago con signature validation
      // For Feed v2.0 webhooks, augment empty body with type
      const webhookPayload = req.body && Object.keys(req.body).length > 0 
        ? req.body 
        : { type: webhookType, id: mpDataId }; // Minimal payload for Feed webhooks
      
      const result = await mercadopagoService.processWebhookNotification(
        webhookPayload,
        signature,
        xRequestId,
        mpDataId  // Use the dataId from auth section (includes req.query.id)
      );
      
      console.log(`📊 [${requestId}] MercadoPago processing result:`, result);
      
      // Enviar mensaje de confirmación o rechazo
      if (result.success && (result.action === 'credited' || result.action === 'rejected')) {
        try {
          console.log(`📨 [${requestId}] Sending payment confirmation message...`);
          
          // Find active agent for this participant using MongoDB
          const Participant = require('../models/Participant');
          const participant = await Participant.findById(result.participantId);
          
          if (participant) {
            // Find conversation with active agent
            const conversation = await Conversation.findOne({
              participantId: result.participantId
            }).sort({ lastMessageTime: -1 });
            
            if (conversation) {
              const agent = await Agent.findOne({
                _id: conversation.agentId,
                $or: [{ status: 'active' }, { status: 'Active' }]
              });
              
              if (agent) {
                let notificationMessage;
                
                if (result.action === 'credited') {
                  notificationMessage = `✅ ¡Pago confirmado!\n\nHemos registrado tu pago por $${result.amount} ARS y acreditado ${result.creditsAdded} créditos a tu cuenta.\n\n💰 Saldo actual: ${result.newBalance} créditos`;
                } else if (result.action === 'rejected') {
                  notificationMessage = `❌ Pago rechazado\n\nTu intento de pago por $${result.amount} ARS no fue aprobado.\n\nMotivo: ${result.reason || 'No especificado'}\n\nPodés intentar nuevamente cuando quieras. Si tenés dudas, preguntame.`;
                }
                
                await ultramsgService.sendUltraMsg(
                  agent,
                  result.phoneNumber,
                  notificationMessage
                );
                
                console.log(`✅ [${requestId}] Payment ${result.action} notification sent successfully`);
              } else {
                console.warn(`⚠️ [${requestId}] No active agent found for conversation`);
              }
            } else {
              console.warn(`⚠️ [${requestId}] No conversation found for participant ${result.participantId}`);
            }
          } else {
            console.warn(`⚠️ [${requestId}] Participant ${result.participantId} not found`);
          }
          
        } catch (messageError) {
          console.error(`❌ [${requestId}] Error sending payment confirmation:`, messageError);
          // No fallar el webhook por error de mensaje
        }
      }
      
      // Responder OK a MercadoPago
      return res.status(200).json({ 
        message: 'MercadoPago webhook processed',
        result: result.success ? 'success' : 'failed'
      });
    }
    
    // Normalizar el mensaje al formato UltraMessage para otros proveedores
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
    
    // Buscar agente basado en instanceId y proveedor (MongoDB)
    let agent = null;
    
    // Estrategia de búsqueda específica por proveedor
    if (provider === 'whatsapp-factory') {
      // Para WhatsApp Factory, buscar por tipo 'wpp-bsp' y phoneNumberId
      const phoneNumberId = data?.to?.split('@')[0] || instanceId;
      
      agent = await Agent.findOne({ 
        type: 'wpp-bsp',
        instanceId: phoneNumberId
      });
      
      if (!agent) {
        // Fallback: buscar por instanceId original
        agent = await Agent.findOne({ 
          type: 'wpp-bsp',
          instanceId: instanceId
        });
      }
    } else {
      // Para UltraMessage, usar búsqueda original
      agent = await Agent.findOne({ 
        instanceId: instanceId
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

  // ====================================================================
  // ⭐ ABORT FIRST - Before ANY processing
  // ====================================================================
  // If this conversation is currently processing, abort immediately
  // This ensures we always process the most recent messages
  
  if (messageQueue.isProcessing(conversation._id.toString())) {
    console.log(`🚫 [${conversation._id}] Conversation is processing - aborting to handle new message`);
    await messageQueue.abortCurrentProcessing(conversation._id.toString(), 'new_webhook_received');
  }

  // 🔥 NEW: Enhanced approach with media completion tracking
  const messageData = await processMessage(data, data.type, conversation._id.toString(), messageQueue);
  
  // ====================================================================
  // ⭐ ADD ORIGINAL TIMESTAMP for chronological ordering
  // ====================================================================
  // This ensures messages maintain their order even with async operations
  messageData.originalTimestamp = messageData.timestamp;
  
  // Agregar información del proveedor al messageData para tracking
  messageData.provider = provider;
  if (provider === 'whatsapp-factory') {
    messageData.whatsappFactorySource = true;
  }

  // Update conversation data and save immediately into database
  // ⭐ Returns { conversation, messageMongoId }
  const updateResult = await updateConversationData(conversation, messageData, agent, participant);
  
  // ====================================================================
  // ⭐ CRITICAL: Add MongoDB _id to messageData for placeholder system
  // ====================================================================
  messageData._id = updateResult.messageMongoId;
  conversation = updateResult.conversation;

  // 🔍 TRACE: Log messageData right before adding to queue
  console.log(`[TRACE - handleMessageReceived] messageData for queue:`, {
    messageId: messageData.msg_foreign_id,
    hasFileStorage: !!messageData.fileStorage,
    fileStorageStatus: messageData.fileStorage?.status,
    fileId: messageData.fileStorage?.fileId
  });

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

// ============================================================================
// MercadoPago Return URLs - Basic endpoints to prevent 404s
// ============================================================================

router.get('/payment-success', (req, res) => {
  console.log('✅ MercadoPago payment success return:', req.query);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Pago Exitoso</title><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
      <h1 style="color: #00a650;">¡Pago Exitoso!</h1>
      <p>Tu pago ha sido procesado correctamente.</p>
      <p>Recibirás una confirmación por WhatsApp en breve.</p>
      <p><small>Puedes cerrar esta ventana.</small></p>
    </body>
    </html>
  `);
});

router.get('/payment-failure', (req, res) => {
  console.log('❌ MercadoPago payment failure return:', req.query);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Error en el Pago</title><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
      <h1 style="color: #d32f2f;">Error en el Pago</h1>
      <p>Hubo un problema procesando tu pago.</p>
      <p>Por favor, intenta nuevamente más tarde.</p>
      <p><small>Puedes cerrar esta ventana.</small></p>
    </body>
    </html>
  `);
});

router.get('/payment-pending', (req, res) => {
  console.log('⏳ MercadoPago payment pending return:', req.query);
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Pago Pendiente</title><meta charset="utf-8"></head>
    <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
      <h1 style="color: #ff9800;">Pago Pendiente</h1>
      <p>Tu pago está siendo procesado.</p>
      <p>Te notificaremos por WhatsApp cuando se confirme.</p>
      <p><small>Puedes cerrar esta ventana.</small></p>
    </body>
    </html>
  `);
});

module.exports = router;