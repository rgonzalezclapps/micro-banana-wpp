// services/messageAdapter.js
/**
 * Adaptador para normalizar mensajes de diferentes proveedores
 * Convierte mensajes de WhatsApp Factory API al formato esperado por UltraMessage
 */

/**
 * Adapta un mensaje de WhatsApp Factory al formato UltraMessage
 * @param {Object} whatsappFactoryData - Datos del webhook de WhatsApp Factory
 * @returns {Object} - Datos en formato UltraMessage
 */
function adaptWhatsAppFactoryToUltraMsg(whatsappFactoryData) {
  try {
    // Extraer datos del mensaje de WhatsApp Factory
    const { entry, metadata: globalMetadata } = whatsappFactoryData;
    
    if (!entry || !entry[0] || !entry[0].changes || !entry[0].changes[0]) {
      throw new Error('Invalid WhatsApp Factory message structure');
    }
    
    const change = entry[0].changes[0];
    const value = change.value;
    
    // Obtener phoneNumberId del metadata global o del value
    const phoneNumberId = globalMetadata?.phoneNumberId || value.metadata?.phone_number_id;
    
    if (!phoneNumberId) {
      throw new Error('Missing phoneNumberId in WhatsApp Factory message');
    }
    
    // Determinar el tipo de evento basado en lo que contiene el value
    let eventType = 'message_received';
    let data = {};
    
    if (value.messages && value.messages.length > 0) {
      // Es un mensaje recibido
      const message = value.messages[0];
      const contact = value.contacts?.[0];
      
      // Extraer información de media de manera más robusta
      const mediaInfo = extractMediaInfo(message);
      const filename = extractFilename(message);
      const quotedMsg = extractQuotedMessage(message);
      
      data = {
        id: message.id,
        from: `${message.from}@c.us`,
        to: `${phoneNumberId}@c.us`,
        type: message.type,
        body: extractMessageBody(message),
        pushname: contact?.profile?.name || 'Unknown',
        time: parseInt(message.timestamp),
        author: message.from,
        hash: message.id,
        media: mediaInfo,
        filename: filename,
        quotedMsg: quotedMsg
      };
      
      eventType = 'message_received';
      
    } else if (value.statuses && value.statuses.length > 0) {
      // Es un status update (ACK)
      const status = value.statuses[0];
      
      data = {
        id: status.id,
        ack: mapStatusToAck(status.status),
        timestamp: parseInt(status.timestamp),
        recipient_id: status.recipient_id
      };
      
      eventType = 'message_ack';
    }
    
    // Retornar en formato UltraMessage
    return {
      event_type: eventType,
      instanceId: phoneNumberId,
      data: data,
      // Mantener metadata original para debugging
      _originalProvider: 'whatsapp-factory',
      _originalData: whatsappFactoryData
    };
    
  } catch (error) {
    console.error('Error adapting WhatsApp Factory message:', error);
    throw error;
  }
}

/**
 * Extrae el contenido del mensaje según su tipo
 */
function extractMessageBody(message) {
  switch (message.type) {
    case 'text':
      return message.text?.body || '';
    
    case 'image':
      return message.image?.caption || '[Image]';
    
    case 'document':
      return message.document?.caption || `[Document: ${message.document?.filename || 'Unknown'}]`;
    
    case 'audio':
    case 'voice':
      return '[Audio Message]';
    
    case 'video':
      return message.video?.caption || '[Video]';
    
    case 'sticker':
      return '[Sticker]';
    
    case 'location':
      const loc = message.location;
      return loc ? `📍 Location: ${loc.latitude}, ${loc.longitude}` : '[Location]';
    
    case 'contacts':
      const contacts = message.contacts;
      return contacts && contacts.length > 0 ? `👤 Contact: ${contacts[0].name?.formatted_name || 'Unknown'}` : '[Contact]';
    
    case 'interactive':
      const interactive = message.interactive;
      if (interactive?.type === 'button_reply') {
        return interactive.button_reply?.title || '[Button Response]';
      } else if (interactive?.type === 'list_reply') {
        return interactive.list_reply?.title || '[List Response]';
      }
      return '[Interactive Message]';
    
    case 'reaction':
      const reaction = message.reaction;
      return `${reaction?.emoji || '👍'} (reaction to ${reaction?.message_id || 'message'})`;
    
    default:
      return `[${message.type.toUpperCase()} Message]`;
  }
}

/**
 * Extrae información de media del mensaje de manera más robusta
 */
function extractMediaInfo(message) {
  const mediaTypes = ['image', 'document', 'audio', 'video', 'voice', 'sticker'];
  
  for (const type of mediaTypes) {
    if (message[type]) {
      const mediaData = message[type];
      
      // Para WhatsApp Factory, la URL puede estar en diferentes lugares
      let mediaUrl = null;
      let needsDownload = false;
      
      // Intentar obtener la URL del media
      if (mediaData.url) {
        mediaUrl = mediaData.url;
      } else if (mediaData.link) {
        mediaUrl = mediaData.link;
      } else if (mediaData.uri) {
        mediaUrl = mediaData.uri;
      } else if (mediaData.id) {
        // WhatsApp Factory entrega solo ID, necesitamos descargarlo
        needsDownload = true;
        mediaUrl = null;
      }
      
      return {
        type: type,
        id: mediaData.id,
        mime_type: mediaData.mime_type,
        sha256: mediaData.sha256,
        size: mediaData.file_size || mediaData.fileSize,
        url: mediaUrl,
        needsDownload: needsDownload, // Flag para indicar que necesita descarga
        voice: mediaData.voice // Para audio de voz de WhatsApp
      };
    }
  }
  
  return null;
}

/**
 * Extrae el nombre del archivo si existe
 */
function extractFilename(message) {
  if (message.document) {
    return message.document.filename || null;
  }
  return null;
}

/**
 * Extrae mensaje citado si existe
 */
function extractQuotedMessage(message) {
  if (message.context && message.context.quoted) {
    return {
      id: message.context.quoted.id,
      body: message.context.quoted.body || '',
      type: message.context.quoted.type || 'text',
      fromMe: false // Por defecto, asumimos que no es nuestro
    };
  }
  return null;
}

/**
 * Mapea el status de WhatsApp Factory al formato ACK de UltraMessage
 */
function mapStatusToAck(status) {
  switch (status) {
    case 'sent':
      return 'server';
    case 'delivered':
      return 'device';
    case 'read':
      return 'read';
    case 'failed':
      return 'failed';
    default:
      return 'server';
  }
}

/**
 * Normaliza datos de cualquier proveedor al formato UltraMessage
 * @param {Object} req - Request object
 * @param {string} provider - Proveedor detectado
 * @returns {Object} - Datos normalizados
 */
function normalizeMessage(req, provider) {
  if (provider === 'whatsapp-factory') {
    return adaptWhatsAppFactoryToUltraMsg(req.body);
  }
  
  // Si es UltraMessage, devolver tal como está
  return req.body;
}

module.exports = {
  adaptWhatsAppFactoryToUltraMsg,
  normalizeMessage,
  extractMessageBody,
  extractMediaInfo,
  mapStatusToAck
};