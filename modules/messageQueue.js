const Conversation = require('../models/Conversation');
const { Agent } = require('../models'); // Add this line
const openAIIntegration = require('./openaiIntegration');
const audioTranscriber = require('./audioTranscriber');
const { chunkMessage } = require('../utils/messageUtils');
const moment = require('moment-timezone');
const { sendUltraMsg, sendUltraMsgSmart, sendUltraMsgVideo } = require('../services/ultramsgService');
const sequentialMessageService = require('../services/sequentialMessageService');
const { sendWhatsAppBusinessMessage } = require('../services/whatsappBusinessService');
const { transcribeAudioWithTimeout } = require('./audioTranscriber');
const { redisClient } = require('../database');
const { saveWithRetry } = require('../utils/dbUtils');
const { getAudioUrl } = require('../services/whatsappFactoryMediaService');

class MessageQueue {
  constructor() {
    this.queues = new Map();
    this.queueTimers = new Map();
    this.activeRuns = new Map();
    this.queueInterval = 2000; // 2 seconds
    this.maxQueueWaitTime = 30000; // 30 seconds
    this.processAudioMessage = false; // Add this line
    this.retryInterval = 1000; // 1 second
  }

  async addMessage(conversation, messageData, agent = null) {
    const conversationId = conversation._id.toString();
    
    if (!this.queues.has(conversationId)) {
      this.queues.set(conversationId, []);
      console.log('Queue created for conversation:', conversationId);
    }

    const queue = this.queues.get(conversationId);

    // Add message to queue
    queue.push(messageData);

    // Handle audio messages
    if (messageData.ultraMsgData.type === 'ptt' || messageData.ultraMsgData.type === 'audio') {
      this.processAudioMessage = true;
      await this.handleAudioMessage(conversation, [...queue], agent);
    } else {
      const queueHasTranscriptionInProgress = queue.some(item => item.transcriptionInProgress === true);
      if (!queueHasTranscriptionInProgress) {
        this.processAudioMessage = false;
      }
    }

    this.resetQueueTimer(conversationId);
  }

  async handleAudioMessage(conversation, queue, agent = null) {
    const placeholder = conversation.messages[conversation.messages.length - 1]

    placeholder.audioTranscription = {
      status: 'processing',
      status_reason: 'handleAudioMessage received a new audio message. Placeholder created.',
      text: { content: "" }
    };

    try {
      const freshConversation = await Conversation.findById(conversation._id);
      
      const messageIndex = freshConversation.messages.findIndex(msg => 
        msg.ultraMsgData && 
        msg.ultraMsgData.id && 
        placeholder.ultraMsgData && 
        placeholder.ultraMsgData.id && 
        msg.ultraMsgData.id.toString() === placeholder.ultraMsgData.id.toString()
      );

      if (messageIndex !== -1) {
        freshConversation.messages[messageIndex] = placeholder;
      } else {
        console.warn('Message not found in conversation. Unable to update.');
      }

      await saveWithRetry(freshConversation);
      conversation = freshConversation;
    } catch (error) {
      console.error('Error updating conversation data:', error);
      throw error;
    }

    placeholder.transcriptionInProgress = true;
    
    // 🚀 NEW FEATURE: Send immediate message to user when audio transcription begins
    try {
      const audioMessages = [
        "Estoy escuchando tu audio 🎧",
        "Recibido. Escuchando y te contesto 🔊",
        "Tu audio se escucha claro, procesando 📱",
        "Dale, escuchando tu mensaje 🎤",
        "Recibido tu audio, ya lo proceso 🎵",
        "Estoy procesando tu mensaje de voz 👂",
        "Tu audio llegó perfecto, escuchando ⚡",
        "Recibido y escuchando tu mensaje 🔄",
        "Estoy escuchando tu audio 🎯",
        "Procesando tu mensaje de voz 🎶",
        "Escuchando lo que me dijiste 🎧",
        "Procesando tu audio 📻",
        "Estoy escuchando tu mensaje 👂",
        "Recibido, estoy escuchando 🎵",
        "Escuchando tu audio 🔊",
        "Escuchando tu mensaje completo 🎤",
        "Estoy procesando lo que me contaste 💫",
        "Escuchando tu audio 🎨",
        "Recibido y procesando tu voz 🌟",
        "Estoy escuchando cada palabra 🎪"
      ];
      
      const randomMessage = audioMessages[Math.floor(Math.random() * audioMessages.length)];
      
      console.log(`📤 Sending immediate audio processing message: "${randomMessage}"`);
      
      // FIX: Use conversation.phoneNumber instead of placeholder.from
      const phoneNumber = conversation.phoneNumber || placeholder.ultraMsgData?.from || placeholder.from;
      
      if (!phoneNumber) {
        throw new Error('Phone number not available for audio notification');
      }
      
      // Get agent info for sending message
      if (agent) {
        // For agent-based messages (WhatsApp Factory)
        const { sendUltraMsg } = require('../services/ultramsgService');
        await sendUltraMsg(agent, phoneNumber, randomMessage);
      } else {
        // For UltraMsg messages, try to get agent from conversation
        const conversationAgent = await Agent.findByPk(conversation.agentId);
        if (conversationAgent) {
          const { sendUltraMsg } = require('../services/ultramsgService');
          await sendUltraMsg(conversationAgent, phoneNumber, randomMessage);
        }
      }
      
      console.log(`✅ Audio processing notification sent to user: ${phoneNumber}`);
      
    } catch (messageError) {
      // Non-blocking: Continue with transcription even if message fails
      console.error(`⚠️ Failed to send audio processing notification (non-blocking):`, {
        error: messageError.message,
        conversationId: conversation._id.toString(),
        phoneNumber: conversation.phoneNumber,
        placeholderFrom: placeholder.from,
        ultraMsgFrom: placeholder.ultraMsgData?.from
      });
    }
    
    // Update the placeholder in the queue
    const placeholderIndex = queue.findIndex(msg => 
      msg.ultraMsgData && 
      msg.ultraMsgData.id && 
      placeholder.ultraMsgData && 
      placeholder.ultraMsgData.id && 
      msg.ultraMsgData.id.toString() === placeholder.ultraMsgData.id.toString()
    );

    if (placeholderIndex !== -1) {
      queue[placeholderIndex] = placeholder;
    } else {
      console.warn('Message not found in queue. Unable to update.');
      queue.push(placeholder);
    }

    try {
      // Determinar si es WhatsApp Factory y necesita descarga especial
      const isWhatsAppFactory = placeholder.provider === 'whatsapp-factory' || 
                              placeholder.whatsappFactorySource === true ||
                              (placeholder.ultraMsgData.media && placeholder.ultraMsgData.media.needsDownload);
      
      let transcription;
      
      if (isWhatsAppFactory && agent && placeholder.ultraMsgData.media && placeholder.ultraMsgData.media.id) {
        console.log('Processing WhatsApp Factory audio with special handling');
        
        // Para WhatsApp Factory, obtener la URL del audio usando el servicio específico
        let audioUrl = placeholder.ultraMsgData.media.url;
        
        // Si la URL es null o 'null' y necesita descarga, usar el servicio de WhatsApp Factory
        if ((!audioUrl || audioUrl === 'null') && placeholder.ultraMsgData.media.needsDownload) {
          console.log('WhatsApp Factory audio needs download, getting URL from service...');
          
          try {
            // Obtener el phoneNumberId del agente
            const phoneNumberId = agent.instanceId;
            
            audioUrl = await getAudioUrl(
              placeholder.ultraMsgData.id,
              phoneNumberId,
              agent.id
            );
            
            console.log('✅ WhatsApp Factory audio URL obtained:', audioUrl ? 'Success' : 'Failed');
          } catch (urlError) {
            console.error('Error getting WhatsApp Factory audio URL:', urlError);
            throw new Error(`Failed to get WhatsApp Factory audio URL: ${urlError.message}`);
          }
        }
        
        // Transcribir usando nuestro nuevo sistema de almacenamiento seguro
        // Para WhatsApp Factory, necesitamos crear un objeto de mensaje temporal con la URL legacy
        const messageDataForTranscription = {
          ...placeholder,
          // Si no hay fileStorage exitoso, usar fallback legacy
          media: audioUrl || placeholder.ultraMsgData.media
        };
        
        transcription = await transcribeAudioWithTimeout(
          messageDataForTranscription,
          agent,
          placeholder.ultraMsgData.media,
          placeholder.ultraMsgData.id
        );
      } else {
        // Para otros proveedores (UltraMessage), usar el método actualizado
        transcription = await transcribeAudioWithTimeout(
          placeholder, // Pasar el mensaje completo con información de fileStorage
          null, // No agent needed for UltraMsg
          null, // No mediaData adicional
          placeholder.ultraMsgData.id // messageId para tracking
        );
      }

      if (transcription && transcription.status === 'completed') {
        placeholder.audioTranscription = {
          status: 'completed',
          status_reason: 'Transcription Complete',
          text: { content: transcription.text || "" }
        };
      } else {
        placeholder.audioTranscription = {
          status: 'failed',
          status_reason: 'Transcription came null',
          text: { content: "[Error: El audio no pudo ser procesado. Hazle saber al usuario, sin interrumpir la conversación, que no pudiste escuchar su audio ya que el equipo se encuentra aplicando mejoras en tu capacidad de escuchar. Dile que vuelva a intentarlo en un momento, o que te lo escriba si vuelve a fallar por favor, y le pides disculpas por el imprevisto. Contesta el resto de los mensajes normalmente.]" }
        };
      }
    } catch (error) {
      console.error('Error handling audio message:', error);
      placeholder.audioTranscription = {
        status: 'failed',
        text: { content: "[Error: El audio no pudo ser procesado. Hazle saber al usuario, sin interrumpir la conversación, que no pudiste escuchar su audio ya que el equipo se encuentra aplicando mejoras en tu capacidad de escuchar. Dile que vuelva a intentarlo en un momento, o que te lo escriba si vuelve a fallar por favor, y le pides disculpas por el imprevisto. Contesta el resto de los mensajes normalmente.]" },
        status_reason: "Error: Audio transcription failed. " + error.message  
      };
    } finally {
      delete placeholder.transcriptionInProgress;
    }

    try {
      const freshConversation = await Conversation.findById(conversation._id);
      
      const messageIndex = freshConversation.messages.findIndex(msg => 
        msg.ultraMsgData && 
        msg.ultraMsgData.id && 
        placeholder.ultraMsgData && 
        placeholder.ultraMsgData.id && 
        msg.ultraMsgData.id.toString() === placeholder.ultraMsgData.id.toString()
      );

      if (messageIndex !== -1) {
        freshConversation.messages[messageIndex] = placeholder;
      } else {
        console.warn('Message not found in conversation. Unable to update.');
      }

      await saveWithRetry(freshConversation);
      conversation = freshConversation;
    } catch (error) {
      console.error('Error updating conversation data:', error);
      throw error;
    }

    // Update the message in the queue
    const conversationQueue = this.queues.get(conversation._id.toString());
    if (conversationQueue && placeholderIndex !== -1) {
      conversationQueue[placeholderIndex] = placeholder;
    }

    const otherActiveTranscriptions = queue.some(item => item.transcriptionInProgress === true);

    if (!otherActiveTranscriptions) {
      this.processAudioMessage = false;
      this.resetQueueTimer(conversation._id.toString());
    }

    console.log('Audio message handling completed');
  }

  resetQueueTimer(conversationId) {
    if (this.queueTimers.has(conversationId)) {
      clearTimeout(this.queueTimers.get(conversationId));
      console.log(`Cleared existing timer for conversation: ${conversationId}`);
    }

    const timer = setTimeout(() => {
      this.processQueue(conversationId);
    }, this.queueInterval);

    this.queueTimers.set(conversationId, timer);
  }

  async processQueue(conversationId) {
    if (await this.shouldProcessQueue(conversationId)) {
      await this.executeQueueProcessing(conversationId);
    } else {
      this.scheduleRetry(conversationId);
    }
  }

  async shouldProcessQueue(conversationId) {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
    const isActiveRun = await redisClient.get(`activeRun:${conversationId}`);
    const activeTimer = this.queueTimers.get(conversationId);
    
    let isTimerActive = false;
    if (activeTimer) {
      isTimerActive = !this.isTimerExpired(activeTimer);
    }

    return !isActiveRun && !this.processAudioMessage && !isTimerActive;
  }

  isTimerExpired(timer) {
    const now = Date.now();
    const expirationTime = timer._idleStart + timer._idleTimeout;
    const isExpired = now >= expirationTime;
    return isExpired;
  }

  async executeQueueProcessing(conversationId) {
    try {
      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      const isSet = await redisClient.set(`activeRun:${conversationId}`, 'true', { NX: true, EX: 300 });
      
      if (!isSet) {
        console.log(`Active run already in progress for conversation: ${conversationId}`);
        return;
      }

      const queue = this.queues.get(conversationId) || [];
      if (queue.length === 0) {
        console.log(`Queue is empty for conversation: ${conversationId}`);
        return;
      }

      // Clear the queue and timer immediately after starting processing
      const processedQueue = [...queue];
      this.queues.delete(conversationId);
      this.queueTimers.delete(conversationId);

      let conversation = await Conversation.findById(conversationId);
      if (!conversation) {
        console.error(`Conversation not found: ${conversationId}`);
        return;
      }

      // ✅ NEW: AI Interrupt Logic - Check for recent agent messages
      const shouldSkipAI = this.checkAgentMessageInterrupt(conversation);
      if (shouldSkipAI) {
        console.log('🚫 AI processing skipped: Recent agent message detected (within 10 minutes)');
        await redisClient.del(`activeRun:${conversationId}`);
        return;
      }

      // TO DO ASAP - Implement fallback with Claude
      const agent = await Agent.findByPk(conversation.agentId);
      if (!agent) {
        console.error(`Agent not found for conversation: ${conversationId}`);
        return;
      }

      if (!agent.assistantId) {
        console.error(`Assistant ID not found for agent: ${agent.id}`);
        return;
      }

      // Prepare messages for OpenAI
      const openAiMessages = processedQueue.map(msg => {
        let audioTranscription = "";
        if ((msg.ultraMsgData.type === 'ptt' || msg.ultraMsgData.type === 'audio') && msg.audioTranscription) {
          if (typeof msg.audioTranscription.text === 'string') {
            audioTranscription = msg.audioTranscription.text;
          } else if (Array.isArray(msg.audioTranscription.text)) {
            audioTranscription = msg.audioTranscription.text.map(chunk => chunk.content).join('');
          }
        }

        // 🔧 DIAGNOSTIC LOG: Check file storage integration  
        console.log('🔍 DIAGNOSTIC - Message processing for OpenAI:', {
          messageId: msg.ultraMsgData.id,
          hasFileStorage: !!msg.fileStorage,
          fileStorageStatus: msg.fileStorage?.status || 'none',
          fileStorageFileId: msg.fileStorage?.fileId || 'none',
          mediaType: msg.ultraMsgData.type
        });

        return {
          timestamp: moment(msg.timestamp).tz('America/Argentina/Buenos_Aires').format(),
          type: msg.ultraMsgData.type,
          content: msg.ultraMsgData.type === 'ptt' || msg.ultraMsgData.type === 'audio' ? "" : msg.content.map(chunk => chunk.content).join(''),
          audio_transcription: audioTranscription,
          quoted_message: msg.ultraMsgData.quotedMsg ? msg.ultraMsgData.quotedMsg : null,
          media_name: msg.media?.filename || null,
          sender: msg.sender,
          message_id: msg.ultraMsgData.id,
          // 🔧 CRITICAL FIX: Include fileStorage information for AI tools
          fileStorage: msg.fileStorage || { status: 'not_applicable' }
        };
      });

      const openAiObject = {
        messages: openAiMessages,
        system_message: JSON.stringify({
          conversation_context: {
            participantName: conversation.participantName || "Unknown"
          }
        })
      };

      // 🧹 CLEAN LOG: Avoid logging large objects with potential blob data
      console.log('📤 OpenAI object prepared:', {
        messageCount: openAiMessages.length,
        participantName: conversation.participantName,
        hasSystemMessage: !!openAiObject.system_message
      });

      // Send queue to OpenAI
      await openAIIntegration.addMessageToThread(conversation.threadId, JSON.stringify(openAiObject));

      // Run the assistant
      const run = await openAIIntegration.runAssistant(agent.assistantId, conversation.threadId);

      // Wait for the run to complete
      const result = await openAIIntegration.waitForRunCompletion(run.id, conversation.threadId, conversationId);

      if (!redisClient.isOpen) {
        await redisClient.connect();
      }
      await redisClient.del(`activeRun:${conversationId}`);
      this.activeRuns.delete(conversationId);

      // Process the AI response
      if (result.type === 'message') {
        const aiResponse = JSON.parse(result.content);
        const { timestamp, thinking, ai_system_message, response } = aiResponse;

        // Create a new message object for the AI response
        const newMessage = {
          sender: 'ai_agent',
          content: chunkMessage(response.message).map((chunk, index) => ({ order: index, content: chunk })),
          timestamp: moment.tz(timestamp, 'America/Argentina/Buenos_Aires').utc().toDate(),
          status: 'pending',
          thinking: thinking,
          aiSystemMessage: ai_system_message,
          recipient: response.recipient,
          type: 'chat'
        };

        // Add the AI response to the conversation
        conversation.messages.push(newMessage);
        conversation.lastMessage = response.message;
        conversation.lastMessageTime = newMessage.timestamp;
        conversation.lastMessageSender = {
          role: 'ai_agent',
          name: conversation.agentName
        };

        try {
          conversation = await saveWithRetry(conversation, 3);
        } catch (error) {
          console.error('Error saving conversation:', error);
        }

        // 🧹 CLEAN LOG: Avoid logging full result object with potential blob data
        console.log('✅ AI processing completed:', {
          type: result.type,
          hasContent: !!result.content,
          contentLength: result.content?.length || 0,
          hasToolResults: !!(result.toolResults && result.toolResults.length > 0),
          toolResultCount: result.toolResults?.length || 0,
          messagesToQuoteCount: result.messagesToQuote?.length || 0
        });

        // Send the message via appropriate service based on agent type
        if (response.recipient === 'user') {
          try {
            let messageResponse;
            
            // Determinar qué servicio usar basado en el tipo de agente
            if (agent.type === 'wpp-bsp') {
              // Usar WhatsApp Factory API
              
              if (result.messagesToQuote && result.messagesToQuote.length > 0) {
                const uniqueMessagesToQuote = [...new Set(result.messagesToQuote)];
                for (let i = 0; i < uniqueMessagesToQuote.length; i++) {
                  const messageToQuote = uniqueMessagesToQuote[i];
                  if (messageToQuote !== undefined) {
                    const isLastMessage = i === uniqueMessagesToQuote.length - 1;
                    const messageContent = isLastMessage ? response.message : "☝🏽";
                    
                    messageResponse = await sendWhatsAppBusinessMessage(agent, conversation.phoneNumber, messageContent, messageToQuote);
                    
                    if (!isLastMessage) {
                      await new Promise(resolve => setTimeout(resolve, 500));
                    }
                  }
                }
              } else {
                // If there are no messages to quote, send the response directly
                messageResponse = await sendWhatsAppBusinessMessage(agent, conversation.phoneNumber, response.message);
              }

              if (messageResponse && messageResponse.success) {
                newMessage.status = 'sent';
                newMessage.whatsappBusinessData = messageResponse.data;
              } else {
                throw new Error('Invalid response from WhatsApp Factory API');
              }
              
            } else {
              // Usar UltraMessage (comportamiento original)
              
              if (result.messagesToQuote && result.messagesToQuote.length > 0) {
                // 🔧 SMART QUOTED RESPONSE: Handle images in quoted responses
                const hasGeneratedImages = result.toolResults && result.toolResults.some(tool => 
                  tool.result && tool.result.generatedImages && tool.result.generatedImages.length > 0
                );

                const uniqueMessagesToQuote = [...new Set(result.messagesToQuote)];
                for (let i = 0; i < uniqueMessagesToQuote.length; i++) {
                  const messageToQuote = uniqueMessagesToQuote[i];
                  if (messageToQuote !== undefined) {
                    const isLastMessage = i === uniqueMessagesToQuote.length - 1;
                    
                    if (isLastMessage && hasGeneratedImages) {
                      // Last message with images - use smart sending
                      const imageToolResult = result.toolResults.find(tool => 
                        tool.result && tool.result.generatedImages && tool.result.generatedImages.length > 0
                      );
                      
                      if (imageToolResult && imageToolResult.result) {
                        const smartContent = {
                          textResponse: response.message,
                          generatedImages: imageToolResult.result.generatedImages
                        };
                        
                        console.log(`📤 [SEQUENTIAL] Using sequential delivery for quoted message with images`);
                        const sequentialResult = await sequentialMessageService.sendMultipleGeminiResults(
                          agent, 
                          conversation.phoneNumber, 
                          smartContent, 
                          `queue-${conversation._id}`
                        );
                        
                        // Format response for compatibility
                        const firstDelivery = sequentialResult[0];
                        messageResponse = firstDelivery?.result || { sent: 'false', message: 'Sequential delivery failed' };
                      } else {
                        messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message, messageToQuote);
                      }
                    } else {
                      // Regular quoted message
                      const messageContent = isLastMessage ? response.message : "☝🏽";
                      messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, messageContent, messageToQuote);
                    }
                    
                    if (!isLastMessage) {
                      await new Promise(resolve => setTimeout(resolve, 500));
                    }
                  }
                }
              } else {
                // 🔧 SMART RESPONSE ROUTING: Check if response contains generated content (images or videos)
                const hasGeneratedImages = result.toolResults && result.toolResults.some(tool => 
                  tool.result && tool.result.generatedImages && tool.result.generatedImages.length > 0
                );
                
                const hasGeneratedVideo = result.toolResults && result.toolResults.some(tool => {
                  console.log('🔍 [VIDEO-TRACE] Checking tool result for video (destructured):', {
                    toolKeys: Object.keys(tool),
                    hasVideoUrl: !!tool.video_url,
                    hasDownloadUrl: !!tool.download_url,
                    success: tool.success,
                    toolCallId: tool.tool_call_id
                  });
                  return tool.video_url || tool.download_url;
                });

                console.log('🔍 [VIDEO-TRACE] Video detection result:', {
                  hasGeneratedVideo: hasGeneratedVideo,
                  toolResultsCount: result.toolResults?.length || 0
                });

                if (hasGeneratedVideo) {
                  console.log(`🎥 [ULTRAMSG] Response contains generated video, using video delivery`);
                  
                  // Extract video content from tool results (destructured format)
                  const videoToolResult = result.toolResults.find(tool => {
                    console.log('🔍 [VIDEO-TRACE] Found video tool result (destructured):', {
                      hasVideoUrl: !!tool.video_url,
                      hasDownloadUrl: !!tool.download_url,
                      videoUrlLength: tool.video_url?.length || 0,
                      downloadUrlLength: tool.download_url?.length || 0
                    });
                    return tool.video_url || tool.download_url;
                  });
                  
                  if (videoToolResult) {
                    try {
                      // Tool result is already destructured, no need to parse
                      const videoUrl = videoToolResult.download_url || videoToolResult.video_url;
                      const videoCaption = response.message || videoToolResult.message || '';
                      
                      console.log(`🎥 [ULTRAMSG] Sending generated video:`, {
                        hasVideoUrl: !!videoUrl,
                        captionLength: videoCaption.length,
                        executionTime: videoToolResult.execution_time
                      });
                      
                      console.log('🎬 [VIDEO-TRACE] About to send video via UltraMsg:', {
                        agentId: agent.id,
                        phoneNumber: conversation.phoneNumber,
                        videoUrl: videoUrl?.substring(0, 80) + (videoUrl?.length > 80 ? '...' : ''),
                        captionLength: videoCaption.length
                      });
                      
                      messageResponse = await sendUltraMsgVideo(
                        agent, 
                        conversation.phoneNumber, 
                        videoUrl,
                        videoCaption,
                        {
                          priority: 3,
                          referenceId: `generated_video_${Date.now()}`
                        }
                      );
                      
                      console.log('✅ [VIDEO-TRACE] Generated video sent successfully via UltraMsg:', {
                        responseId: messageResponse?.data?.id || messageResponse?.id,
                        status: messageResponse?.data?.sent || messageResponse?.sent,
                        hasDataWrapper: !!messageResponse?.data
                      });
                      
                    } catch (videoError) {
                      console.error('❌ Failed to send generated video, falling back to text:', videoError.message);
                      // Fallback to text message
                      messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
                    }
                  }
                  
                } else if (hasGeneratedImages) {
                  console.log(`🖼️ [ULTRAMSG] Response contains generated images, using smart sending`);
                  
                  // Extract image content from tool results
                  const imageToolResult = result.toolResults.find(tool => 
                    tool.result && tool.result.generatedImages && tool.result.generatedImages.length > 0
                  );
                  
                  if (imageToolResult && imageToolResult.result) {
                                      const smartContent = {
                    textResponse: response.message,
                    generatedImages: imageToolResult.result.generatedImages
                  };
                  
                  console.log(`📤 [SEQUENTIAL] Using sequential delivery for multiple outputs`);
                  const sequentialResult = await sequentialMessageService.sendMultipleGeminiResults(
                    agent, 
                    conversation.phoneNumber, 
                    smartContent, 
                    `queue-${conversation._id}`
                  );
                  
                  // Format response for compatibility with existing flow
                  const successfulDeliveries = sequentialResult.filter(d => d.result.sent === 'true');
                  if (successfulDeliveries.length > 0) {
                    messageResponse = successfulDeliveries[0].result;
                  } else {
                    messageResponse = { sent: 'false', message: 'All sequential deliveries failed' };
                  }
                } else {
                  // Fallback to regular text if image extraction fails
                  messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
                }
              } else {
                // No images, send text normally
                console.log(`📝 [ULTRAMSG] Text-only response, using regular sending`);
                messageResponse = await sendUltraMsg(agent, conversation.phoneNumber, response.message);
              }
              }

              if (messageResponse && messageResponse.data) {
                newMessage.status = 'sent';
                newMessage.ultraMsgData = messageResponse.data;
              } else {
                throw new Error('Invalid response from sendUltraMsg');
              }
            }
          } catch (error) {
            console.error(`Failed to send message via ${agent.type === 'wpp-bsp' ? 'WhatsApp Factory API' : 'UltraMessage'}:`, error);
            newMessage.status = 'failed';
            newMessage.errorData = error.message;
          }

          await saveWithRetry(conversation, 3); // Using saveWithRetry with 3 retries

          // Pure API - no real-time AI response events
        }

        // Pure API - no real-time conversation update events
      }

      console.log(`Queue processed successfully for conversation: ${conversationId}`);
    } catch (error) {
      console.error(`Error processing queue for conversation ${conversationId}:`, error);
    } finally {

      if (this.queues.has(conversationId) && this.queues.get(conversationId).length > 0) {
        this.scheduleRetry(conversationId);
      }
    }
  }

  scheduleRetry(conversationId) {
    setTimeout(() => this.processQueue(conversationId), this.retryInterval);
  }

  /**
   * Checks if AI processing should be interrupted due to recent agent message.
   * Agent messages within 10 minutes interrupt AI to allow human agent control.
   * 
   * @param {Object} conversation MongoDB conversation object
   * @returns {boolean} True if AI should be skipped
   */
  checkAgentMessageInterrupt(conversation) {
    try {
      if (!conversation.messages || conversation.messages.length === 0) {
        return false; // No messages, proceed with AI
      }
      
      // ✅ FIX: Find the MOST RECENT agent message (not just last message)
      const agentMessages = conversation.messages.filter(msg => msg.sender === 'agent');
      
      if (agentMessages.length === 0) {
        console.log('✅ TRACE: No agent messages found, AI processing allowed');
        return false; // No agent messages, proceed with AI
      }
      
      // Get the most recent agent message
      const mostRecentAgentMessage = agentMessages[agentMessages.length - 1];
      console.log('🔍 TRACE: Checking most recent agent message for interrupt:', {
        sender: mostRecentAgentMessage.sender,
        timestamp: mostRecentAgentMessage.timestamp,
        agentName: mostRecentAgentMessage.agentName,
        isAgentMessage: mostRecentAgentMessage.isAgentMessage,
        totalAgentMessages: agentMessages.length
      });
      
      // Check if most recent agent message is within 10 minutes
      const now = new Date();
      const messageTime = new Date(mostRecentAgentMessage.timestamp);
      const timeDifference = now - messageTime;
      const tenMinutesInMs = 10 * 60 * 1000; // 10 minutes in milliseconds
      
      const isRecent = timeDifference < tenMinutesInMs;
      const minutesAgo = Math.floor(timeDifference / (60 * 1000));
      
      console.log('🔍 TRACE: Most recent agent message timing analysis:', {
        messageTime: messageTime.toISOString(),
        currentTime: now.toISOString(),
        timeDifferenceMs: timeDifference,
        minutesAgo: minutesAgo,
        isWithin10Minutes: isRecent,
        shouldInterruptAI: isRecent
      });
      
      if (isRecent) {
        console.log(`🚫 AGENT INTERRUPT: Most recent agent message is ${minutesAgo} minutes old (<10 min), skipping AI processing`);
        return true; // Skip AI processing
      } else {
        console.log(`✅ AGENT TIMEOUT: Agent message is ${minutesAgo} minutes old (>10 min), AI processing allowed`);
        return false; // Agent message too old, proceed with AI
      }
      
    } catch (error) {
      console.error('Error checking agent message interrupt:', error.message);
      return false; // On error, proceed with AI (safe default)
    }
  }
}

module.exports = new MessageQueue();