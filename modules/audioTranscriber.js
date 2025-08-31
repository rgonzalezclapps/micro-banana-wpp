const axios = require('axios');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
ffmpeg.setFfmpegPath(ffmpegPath);
const { openai } = require('../modules/openaiIntegration');
const tmp = require('tmp');
const { getAudioUrl } = require('../services/whatsappFactoryMediaService');
const { createMediaClient } = require('../services/whatsappFactoryApiService');

const AUDIO_TRANSCRIPTION_TIMEOUT = 600000; // 10 minutes in milliseconds

async function downloadAndSaveAudio(url, agent = null) {
  // Solo mostrar el tipo de URL para evitar logs con base64
  const urlType = url.startsWith('data:') ? 'data URL (base64)' : url;
  console.log('Downloading audio from:', urlType);
  
  // Verificar si es una data URL
  if (url.startsWith('data:audio/')) {
    console.log('Processing data URL audio content');
    
    // Extraer el contenido base64 de la data URL
    const base64Data = url.split(',')[1];
    if (!base64Data) {
      throw new Error('Invalid data URL format');
    }
    
    // Convertir base64 a buffer
    const buffer = Buffer.from(base64Data, 'base64');
    console.log('Data URL audio content size:', buffer.length, 'bytes');
    
    // Guardar en archivo temporal
    const tempFile = tmp.fileSync({ prefix: 'audio_', postfix: '.tmp' }).name;
    await fsPromises.writeFile(tempFile, buffer);
    console.log('Data URL audio saved to temporary file:', tempFile);
    return tempFile;
  }
  
  // Procesar como URL HTTP normal
  let requestConfig = { responseType: 'arraybuffer' };
  
  // Si tenemos un agente y la URL es de WhatsApp Factory, usar el cliente centralizado
  if (agent && url.includes('api.whatsapp.dev.clapps.io')) {
    const mediaClient = createMediaClient(agent.token);
    console.log('Using WhatsApp Factory authentication for audio download');
    
    // Usar el cliente centralizado en lugar de axios directo
    const response = await mediaClient.get(url);
    console.log('Audio download completed, size:', response.data.length, 'bytes');
    const buffer = Buffer.from(response.data, 'binary');
    const tempFile = tmp.fileSync({ prefix: 'audio_', postfix: '.tmp' }).name;
    await fsPromises.writeFile(tempFile, buffer);
    console.log('Audio saved to temporary file:', tempFile);
    return tempFile;
  }
  
  // Procesar como URL HTTP normal (no WhatsApp Factory)
  const response = await axios.get(url, requestConfig);
  console.log('Audio download completed, size:', response.data.length, 'bytes');
  const buffer = Buffer.from(response.data, 'binary');
  const tempFile = tmp.fileSync({ prefix: 'audio_', postfix: '.tmp' }).name;
  await fsPromises.writeFile(tempFile, buffer);
  console.log('Audio saved to temporary file:', tempFile);
  return tempFile;
}

async function getAudioFormat(filePath) {
  return new Promise((resolve, reject) => {
    execFile(ffprobePath, ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath], (error, stdout, stderr) => {
      if (error) {
        console.error('FFprobe error:', error);
        reject(error);
      } else {
        try {
          const metadata = JSON.parse(stdout);
          console.log('FFprobe metadata:', metadata);
          resolve(metadata.format.format_name);
        } catch (parseError) {
          console.error('Error parsing FFprobe output:', parseError);
          reject(parseError);
        }
      }
    });
  });
}

async function convertToMp3(inputPath) {
  const outputPath = tmp.fileSync({ prefix: 'audio_', postfix: '.mp3' }).name;
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .on('error', (err) => {
        console.error('Error converting file:', err);
        reject(err);
      })
      .on('end', () => {
        console.log('Conversion finished');
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

async function transcribeAudio(url, agent = null, mediaInfo = null, messageId = null) {
  let tempFile = null;
  let convertedFile = null;
  
  try {
    console.log('Starting audio transcription for:', url);
    
    // Descargar y guardar el audio
    tempFile = await downloadAndSaveAudio(url, agent);
    console.log('Audio downloaded to:', tempFile);
    
    // Obtener el formato del audio
    let audioFormat;
    try {
      audioFormat = await getAudioFormat(tempFile);
      console.log('Audio format detected:', audioFormat);
    } catch (error) {
      console.log('Could not detect audio format, assuming OGG:', error.message);
      audioFormat = 'ogg';
    }
    
    // Convertir a MP3 si es necesario
    if (audioFormat && !audioFormat.includes('mp3')) {
      console.log('Converting audio to MP3 format');
      convertedFile = await convertToMp3(tempFile);
      console.log('Audio converted to:', convertedFile);
    } else {
      convertedFile = tempFile;
      console.log('Using original audio file (already MP3 or compatible)');
    }
    
    // Transcribir con OpenAI
    console.log('Sending audio to OpenAI for transcription');
        const transcription = await openai.audio.transcriptions.create({
          file: fs.createReadStream(convertedFile),
      model: 'whisper-1',
      language: 'es',
      response_format: 'text'
    });
    
    console.log('Transcription completed successfully');
        return {
      status: 'success',
      text: transcription,
      original_url: url,
      audio_format: audioFormat
    };
    
      } catch (error) {
    console.error('Error in audio transcription:', error);
    
    // Determinar el tipo de error
    let statusReason = 'Unknown error occurred during transcription';
    
    if (error.message.includes('Invalid data URL format')) {
      statusReason = 'Invalid audio data format received';
    } else if (error.message.includes('timeout')) {
      statusReason = 'Audio download timed out';
    } else if (error.message.includes('ENOENT')) {
      statusReason = 'Audio file not found or inaccessible';
    } else if (error.message.includes('FFprobe error')) {
      statusReason = 'Audio format detection failed';
    } else if (error.message.includes('Error converting file')) {
      statusReason = 'Audio conversion to MP3 failed';
    } else if (error.message.includes('OpenAI API')) {
      statusReason = 'OpenAI transcription service error';
    }
    
    return {
      status: 'failed',
      status_reason: statusReason,
      error: error.message,
      original_url: url
    };
    
  } finally {
    // Limpiar archivos temporales
    try {
      if (tempFile && tempFile !== convertedFile) {
        await fsPromises.unlink(tempFile);
        console.log('Temporary audio file cleaned up:', tempFile);
      }
      if (convertedFile) {
        await fsPromises.unlink(convertedFile);
        console.log('Converted audio file cleaned up:', convertedFile);
      }
    } catch (cleanupError) {
      console.error('Error cleaning up temporary files:', cleanupError);
    }
  }
}

/**
 * Función de transcripción con timeout para compatibilidad con messageQueue
 * @param {string|Object} mediaInfo - URL del audio o información del media
 * @param {Object} agent - Agente para autenticación (opcional)
 * @param {Object} mediaData - Información adicional del media (opcional)
 * @param {string} messageId - ID del mensaje (opcional)
 * @returns {Promise<Object>} - Resultado de la transcripción
 */
async function transcribeAudioWithTimeout(mediaInfo, agent = null, mediaData = null, messageId = null) {
  try {
    let audioUrl = mediaInfo;
    
    // Si mediaInfo es un objeto (como en UltraMsg), extraer la URL
    if (typeof mediaInfo === 'object' && mediaInfo.url) {
      audioUrl = mediaInfo.url;
    }
    
    // Si tenemos mediaData y agent, es un mensaje de WhatsApp Factory
    if (mediaData && agent && messageId) {
      console.log('Processing WhatsApp Factory audio with waId:', messageId);
      audioUrl = await getAudioUrl(messageId, agent.instanceId, agent.id);
      console.log('✅ WhatsApp Factory audio URL obtained:', audioUrl ? 'Success' : 'Failed');
    }
    
    console.log('Transcribing audio with timeout:', audioUrl);
    
    // Usar la función de transcripción principal
    const result = await transcribeAudio(audioUrl, agent, mediaData, messageId);
    
    // Convertir el resultado al formato esperado por messageQueue
    if (result.status === 'success') {
      return {
        status: 'completed',
        text: result.text
      };
    } else {
      return {
        status: 'failed',
        text: '',
        error: result.status_reason || result.error
      };
    }
    
  } catch (error) {
    console.error('Error in transcribeAudioWithTimeout:', error);
    return {
      status: 'failed',
      text: '',
      error: error.message || 'Unknown error occurred'
    };
  }
}

module.exports = {
  transcribeAudio,
  transcribeAudioWithTimeout,
  downloadAndSaveAudio,
  getAudioFormat,
  convertToMp3
};