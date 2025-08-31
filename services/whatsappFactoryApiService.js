/**
 * whatsappFactoryApiService.js
 * 
 * Description: Servicio centralizado para todas las llamadas a WhatsApp Factory API
 * 
 * Role in the system: Proporciona una interfaz unificada para todas las operaciones con WhatsApp Factory API
 * 
 * Node.js Context: Service - external API integration
 * 
 * Dependencies:
 * - axios (HTTP client)
 * - Agent model para obtener configuración
 * 
 * Dependants:
 * - services/whatsappBusinessService.js (reemplazará llamadas directas)
 * - services/whatsappFactoryMediaService.js (reemplazará llamadas directas)
 * - modules/audioTranscriber.js (reemplazará llamadas directas)
 */

const axios = require('axios');
const { Agent } = require('../models');

// Configuración de la API
const API_BASE_URL = process.env.WHATSAPP_FACTORY_API_URL || 'https://api.whatsapp.dev.clapps.io';

/**
 * Cliente HTTP configurado para WhatsApp Factory API
 * @param {string} token - Token de autenticación
 * @returns {Object} Cliente axios configurado
 */
function createApiClient(token) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'x-api-key': token,
      'Content-Type': 'application/json',
      'accept': '*/*'
    },
    timeout: Number(process.env.WHATSAPP_FACTORY_TIMEOUT_MS || 15000)
  });
}

/**
 * Cliente HTTP para descarga de media (con responseType arraybuffer)
 * @param {string} token - Token de autenticación
 * @returns {Object} Cliente axios configurado para media
 */
function createMediaClient(token) {
  return axios.create({
    baseURL: API_BASE_URL,
    headers: {
      'x-api-key': token,
      'accept': '*/*'
    },
    responseType: 'arraybuffer',
    timeout: Number(process.env.MEDIA_DOWNLOAD_TIMEOUT_MS || 15000),
    validateStatus: (status) => status >= 200 && status < 300
  });
}

/**
 * Envía un mensaje de texto usando WhatsApp Factory API
 * @param {Object} agent - Agente configurado con token y instanceId
 * @param {string} to - Número de teléfono destino (formato: 1234567890)
 * @param {string} message - Mensaje a enviar
 * @param {Object} messageToQuote - Mensaje a citar (opcional)
 * @returns {Promise<Object>} Respuesta de la API
 */
async function sendTextMessage(agent, to, message, messageToQuote = null) {
  try {
    if (!agent.token) {
      throw new Error('WhatsApp Factory API token not configured');
    }

    if (!agent.instanceId) {
      throw new Error('WhatsApp Factory phone number not configured');
    }

    // Formatear número de teléfono (remover @c.us si existe)
    const formattedTo = to.replace('@c.us', '');
    
    // Construir payload para WhatsApp Factory API
    const payload = {
      to: formattedTo,
      text: message
    };

    // Agregar contexto de mensaje citado si existe
    if (messageToQuote && messageToQuote.id) {
      payload.quotedMessageId = messageToQuote.id;
    }

    const client = createApiClient(agent.token);
    const response = await client.post(
      `/v1/api/whatsapp/${agent.instanceId}/send/text`,
      payload
    );

    return {
      success: true,
      data: response.data,
      messageId: response.data.messageId || response.data.id
    };

  } catch (error) {
    console.error('❌ Error sending WhatsApp Factory message:', {
      error: error.message,
      response: error.response?.data,
      status: error.response?.status
    });

    throw new Error(`WhatsApp Factory API error: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Obtiene información del número de WhatsApp Factory
 * @param {Object} agent - Agente configurado
 * @returns {Promise<Object>} Información del número
 */
async function getNumberInfo(agent) {
  try {
    if (!agent.token) {
      throw new Error('WhatsApp Factory API token not configured');
    }

    if (!agent.instanceId) {
      throw new Error('WhatsApp Factory phone number not configured');
    }

    const client = createApiClient(agent.token);
    const response = await client.get(`/v1/api/whatsapp/${agent.instanceId}/info`);

    return {
      success: true,
      data: response.data
    };

  } catch (error) {
    console.error('Error getting WhatsApp Factory number info:', error.message);
    throw new Error(`Failed to get number info: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Descarga media usando WhatsApp Factory API
 * @param {string} waId - ID del mensaje de WhatsApp
 * @param {string} phoneNumberId - ID del número de teléfono
 * @param {string} agentId - ID del agente
 * @returns {Promise<{buffer: Buffer, contentType: string}>} Buffer y tipo de contenido
 */
async function downloadMedia(waId, phoneNumberId, agentId) {
  // Validaciones tempranas
  if (!waId || typeof waId !== 'string') {
    throw new Error('Parámetro inválido: waId debe ser string no vacío');
  }
  if (!phoneNumberId || typeof phoneNumberId !== 'string') {
    throw new Error('Parámetro inválido: phoneNumberId debe ser string no vacío');
  }
  if (!agentId) {
    throw new Error('Parámetro inválido: agentId es requerido');
  }

  const agent = await Agent.findByPk(agentId);
  if (!agent) {
    throw new Error(`No se encontró agente con ID: ${agentId}`);
  }
  
  if (!agent.token) {
    throw new Error('Access token no disponible para el agente');
  }

  const endpoint = `/v1/api/whatsapp/${encodeURIComponent(phoneNumberId)}/messages/media`;
  const url = new URL(API_BASE_URL + endpoint);
  url.searchParams.set('id', waId);

  const client = createMediaClient(agent.token);
  
  try {
    const response = await client.get(url.toString());
    
    const buffer = Buffer.from(response.data);
    const contentTypeHeader = response.headers['content-type'];
    const contentType = contentTypeHeader || 'application/octet-stream';

    return { buffer, contentType };
    
  } catch (error) {
    console.error('❌ Error downloading media from WhatsApp Factory:', {
      error: error.message,
      status: error.response?.status,
      waId,
      phoneNumberId
    });
    
    throw new Error(`Failed to download media: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Descarga media con reintentos
 * @param {Object} params
 * @param {string} params.waId
 * @param {string} params.phoneNumberId
 * @param {string} params.agentId
 * @returns {Promise<{buffer: Buffer, contentType: string}>}
 */
async function downloadMediaWithRetry({ waId, phoneNumberId, agentId }) {
  const maxRetries = Number(process.env.MEDIA_DOWNLOAD_MAX_RETRIES || 3);
  const retryDelayMs = Number(process.env.MEDIA_DOWNLOAD_RETRY_DELAY_MS || 3000);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const isLast = attempt === maxRetries;
    try {
      if (attempt > 1) {
        console.log(`↻ Reintento ${attempt}/${maxRetries} en ${retryDelayMs}ms…`);
        await new Promise((r) => setTimeout(r, retryDelayMs));
      }

      console.log(`🔄 Descargando (intento ${attempt}/${maxRetries})`);
      
      const result = await downloadMedia(waId, phoneNumberId, agentId);
      console.log('✅ Media descargado correctamente');
      return result;
      
    } catch (err) {
      console.error(`❌ Error en intento ${attempt}/${maxRetries}: ${err.message}`);

      if (isLast) {
        throw new Error(`Error al descargar media después de ${maxRetries} intentos: ${err.message}`);
      }
    }
  }

  // No debería alcanzarse
  throw new Error('Fallo desconocido al descargar media.');
}

/**
 * Verifica la configuración del agente para WhatsApp Factory API
 * @param {Object} agent - Agente a verificar
 * @returns {Object} Estado de la configuración
 */
function validateAgent(agent) {
  const issues = [];
  
  if (!agent.token) {
    issues.push('Missing WhatsApp Factory API token');
  }
  
  if (!agent.instanceId) {
    issues.push('Missing WhatsApp Factory phone number (instanceId)');
  }
  
  if (agent.type !== 'wpp-bsp') {
    issues.push('Agent type must be wpp-bsp for WhatsApp Factory API');
  }
  
  return {
    isValid: issues.length === 0,
    issues: issues
  };
}

module.exports = {
  // Funciones principales
  sendTextMessage,
  getNumberInfo,
  downloadMedia,
  downloadMediaWithRetry,
  validateAgent,
  
  // Utilidades
  createApiClient,
  createMediaClient,
  
  // Constantes
  API_BASE_URL
};
