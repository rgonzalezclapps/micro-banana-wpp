/**
 * fileStorageUtils.js
 * 
 * Description: Utility for downloading media from external sources (UltraMsg S3, WhatsApp Factory) and uploading to our crypto-secure file storage server
 * 
 * Role in the system: Bridge between external media sources and our secure file storage infrastructure
 * 
 * Node.js Context: Utility - Media download and secure storage integration
 * 
 * Dependencies:
 * - axios (HTTP client for downloading and uploading)
 * - path (file extension handling)
 * - crypto (file validation)
 * 
 * Dependants:
 * - modules/messageProcessor.js (media processing integration)
 * - modules/audioTranscriber.js (will be adapted to use stored files)
 */

const axios = require('axios');
const path = require('path');
const crypto = require('crypto');

// File storage server configuration from server.md
const FILE_STORAGE_BASE_URL = process.env.FILE_STORAGE_BASE_URL || 'https://files.api-ai-mvp.com';
const FILE_STORAGE_API_KEY = process.env.API_KEY_WEBHOOK; // Using same API key as documented
const FILE_SIZE_LIMIT = parseInt(process.env.FILE_SIZE_LIMIT || '25') * 1024 * 1024; // Convert MB to bytes

// Supported media types and extensions from server.md security specifications
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'pdf', 'txt', 'doc', 'docx', 'gif', 'mp3', 'mp4', 'wav', 'ogg', 'webm'];
const MEDIA_TYPE_MAPPING = {
  'image': ['jpg', 'jpeg', 'png', 'webp', 'gif'],
  'audio': ['mp3', 'wav', 'ogg', 'webm'],
  'video': ['mp4', 'webm'],
  'document': ['pdf', 'txt', 'doc', 'docx'],
  'ptt': ['mp3', 'wav', 'ogg'], // Push-to-talk audio
  'voice': ['mp3', 'wav', 'ogg'], // Voice messages
  'sticker': ['webp', 'gif']
};

/**
 * Downloads media from external source and uploads to our secure file storage
 * @param {Object} mediaData - Media information from webhook (UltraMsg or WhatsApp Factory)
 * @param {string} messageType - Type of message (image, audio, video, document, ptt, etc.)
 * @param {string} originalFilename - Original filename if available
 * @returns {Object} Storage result with success/error status and file information
 */
async function downloadAndStoreMedia(mediaData, messageType, originalFilename = null) {
  const requestId = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  console.log(`🗂️ [${requestId}] Starting media download and storage process`, {
    messageType,
    originalFilename,
    mediaData: mediaData ? 'present' : 'null'
  });

  try {
    // Validate input parameters
    if (!mediaData) {
      return createErrorResult('INVALID_INPUT', 'Missing media data', requestId);
    }

    // Extract media URL - handle both UltraMsg and WhatsApp Factory formats
    const mediaUrl = extractMediaUrl(mediaData, messageType);
    if (!mediaUrl) {
      return createErrorResult('NO_MEDIA_URL', 'No downloadable media URL found', requestId);
    }

//    console.log(`📥 [${requestId}] Media URL extracted: ${mediaUrl}`);

    // Download media with retry logic
    const downloadResult = await downloadMediaWithRetry(mediaUrl, requestId);
    if (!downloadResult.success) {
      return downloadResult; // Already formatted as error result
    }

    // Validate file size
    if (downloadResult.buffer.length > FILE_SIZE_LIMIT) {
      return createErrorResult('FILE_TOO_LARGE', 
        `File size ${(downloadResult.buffer.length / 1024 / 1024).toFixed(2)}MB exceeds limit ${FILE_SIZE_LIMIT / 1024 / 1024}MB`, 
        requestId);
    }

    // Determine file extension and validate
    const fileExtension = determineFileExtension(downloadResult.contentType, originalFilename, messageType);
    if (!fileExtension || !ALLOWED_EXTENSIONS.includes(fileExtension.toLowerCase())) {
      return createErrorResult('INVALID_FILE_TYPE', 
        `File type ${fileExtension} not allowed`, 
        requestId);
    }

    // Generate secure filename
    const secureFilename = generateSecureFilename(originalFilename, fileExtension);

    // Upload to our file storage server
    const uploadResult = await uploadToFileStorage(downloadResult.buffer, secureFilename, downloadResult.contentType, requestId);
    
    if (!uploadResult.success) {
      return uploadResult; // Already formatted as error result
    }

    // Create success result
    const successResult = {
      status: 'success',
      fileId: uploadResult.fileId,
      filename: secureFilename,
      originalFilename: originalFilename,
      fileSize: downloadResult.buffer.length,
      fileSizeHuman: `${(downloadResult.buffer.length / 1024 / 1024).toFixed(2)}MB`,
      contentType: downloadResult.contentType,
      downloadUrl: uploadResult.downloadUrl,
      externalUrl: uploadResult.externalUrl,
      uploadDate: new Date().toISOString(),
      requestId: requestId
    };

    console.log(`✅ [${requestId}] Media storage completed successfully`, {
      fileId: successResult.fileId,
      filename: successResult.filename,
      fileSize: successResult.fileSizeHuman
    });

    return successResult;

  } catch (error) {
    console.error(`❌ [${requestId}] Unexpected error in media storage:`, error);
    return createErrorResult('UNEXPECTED_ERROR', error.message, requestId);
  }
}

/**
 * Extracts media URL from different webhook formats
 */
function extractMediaUrl(mediaData, messageType) {
  // UltraMsg format - S3 URL directly in media data
  if (typeof mediaData === 'string' && (mediaData.startsWith('http://') || mediaData.startsWith('https://'))) {
    return mediaData;
  }

  // 🔧 CRITICAL FIX: Handle data URLs from Gemini generated images
  if (typeof mediaData === 'string' && mediaData.startsWith('data:')) {
    console.log('📊 Data URL detected for generated image processing');
    return mediaData;
  }

  // Object format with URL property
  if (mediaData && typeof mediaData === 'object') {
    // Try different possible URL fields
    if (mediaData.url) return mediaData.url;
    if (mediaData.link) return mediaData.link;
    if (mediaData.uri) return mediaData.uri;
    if (mediaData.src) return mediaData.src;
    
    // WhatsApp Factory might need special handling (future enhancement)
    if (mediaData.id && !mediaData.url) {
      console.log('🔄 WhatsApp Factory media ID detected - requires API download (not implemented yet)');
      return null;
    }
  }

  return null;
}

/**
 * Downloads media from URL with retry logic
 */
async function downloadMediaWithRetry(mediaUrl, requestId, maxRetries = 2) {
  let lastError;
  
  // 🔧 CRITICAL FIX: Handle data URLs directly without HTTP download
  if (mediaUrl.startsWith('data:')) {
    console.log(`🎨 [${requestId}] Processing data URL (generated image)`);
    try {
      // Parse data URL: data:image/png;base64,iVBORw0KGgo...
      const [header, base64Data] = mediaUrl.split(',');
      if (!header || !base64Data) {
        throw new Error('Invalid data URL format');
      }
      
      // Extract MIME type from header: data:image/png;base64
      const mimeTypeMatch = header.match(/data:([^;]+)/);
      const contentType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';
      
      // Convert base64 to buffer
      const buffer = Buffer.from(base64Data, 'base64');
      
      console.log(`✅ [${requestId}] Data URL processed successfully`, {
        contentType: contentType,
        sizeKB: Math.round(buffer.length / 1024)
      });
      
      return {
        success: true,
        buffer: buffer,
        contentType: contentType
      };
      
    } catch (error) {
      console.error(`❌ [${requestId}] Data URL processing failed:`, error.message);
      return createErrorResult('DATA_URL_PROCESSING_FAILED', error.message, requestId);
    }
  }
  
  // HTTP URL processing (existing logic)
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📥 [${requestId}] Download attempt ${attempt}/${maxRetries}: ${mediaUrl}`);
      
      const response = await axios({
        method: 'get',
        url: mediaUrl,
        responseType: 'arraybuffer',
        timeout: 30000, // 30 second timeout
        headers: {
          'User-Agent': 'Micro-Banana-MediaDownloader/1.0'
        },
        maxContentLength: FILE_SIZE_LIMIT,
        maxBodyLength: FILE_SIZE_LIMIT
      });

      if (response.status !== 200) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      console.log(`✅ [${requestId}] Download successful`, {
        contentType: response.headers['content-type'],
        contentLength: response.headers['content-length'],
        actualSize: response.data.length
      });

      return {
        success: true,
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'application/octet-stream'
      };

    } catch (error) {
      lastError = error;
      console.error(`❌ [${requestId}] Download attempt ${attempt} failed:`, error.message);
      
      // Don't retry on certain types of errors
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || 
          (error.response && error.response.status === 404)) {
        break;
      }
      
      // Wait before retry (exponential backoff)
      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`⏳ [${requestId}] Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  return createErrorResult('DOWNLOAD_FAILED', 
    `Failed to download after ${maxRetries} attempts: ${lastError.message}`, 
    requestId);
}

/**
 * Uploads file to our secure file storage server
 */
async function uploadToFileStorage(buffer, filename, contentType, requestId) {
  try {
    console.log(`☁️ [${requestId}] Uploading to file storage server`, {
      filename,
      contentType,
      size: `${(buffer.length / 1024 / 1024).toFixed(2)}MB`
    });

    const FormData = require('form-data');
    const form = new FormData();
    
    // Create a stream from buffer
    form.append('file', buffer, {
      filename: filename,
      contentType: contentType
    });

    const response = await axios({
      method: 'post',
      url: `${FILE_STORAGE_BASE_URL}/upload?key=${FILE_STORAGE_API_KEY}`,
      data: form,
      headers: {
        ...form.getHeaders(),
        'User-Agent': 'Micro-Banana-MediaUploader/1.0'
      },
      timeout: 60000, // 60 second timeout for uploads
      maxContentLength: FILE_SIZE_LIMIT,
      maxBodyLength: FILE_SIZE_LIMIT
    });

    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Upload failed: ${response.data.error || 'Unknown error'}`);
    }

    console.log(`✅ [${requestId}] Upload successful`, {
      fileId: response.data.file_id,
      downloadUrl: response.data.download_url
    });

    // Use our URL generation instead of server-returned path
    const internalDownloadUrl = createDownloadUrl(response.data.file_id);
    const externalDownloadUrl = createExternalDownloadUrl(response.data.file_id);
    
    return {
      success: true,
      fileId: response.data.file_id,
      downloadUrl: internalDownloadUrl,
      externalUrl: externalDownloadUrl
    };

  } catch (error) {
    console.error(`❌ [${requestId}] Upload failed:`, error.message);
    return createErrorResult('UPLOAD_FAILED', error.message, requestId);
  }
}

/**
 * Determines appropriate file extension based on content type and filename
 */
function determineFileExtension(contentType, originalFilename, messageType) {
  // Try to extract from original filename first
  if (originalFilename) {
    const ext = path.extname(originalFilename).toLowerCase().replace('.', '');
    if (ext && ALLOWED_EXTENSIONS.includes(ext)) {
      return ext;
    }
  }

  // Map content type to extension
  const contentTypeMap = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
  };

  if (contentType && contentTypeMap[contentType.toLowerCase()]) {
    return contentTypeMap[contentType.toLowerCase()];
  }

  // Fallback based on message type
  const typeDefaults = {
    'image': 'jpg',
    'audio': 'mp3',
    'ptt': 'mp3',
    'voice': 'mp3',
    'video': 'mp4',
    'document': 'pdf',
    'sticker': 'webp'
  };

  return typeDefaults[messageType] || 'bin';
}

/**
 * Generates secure filename with original name preservation
 */
function generateSecureFilename(originalFilename, fileExtension) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const randomHash = crypto.randomBytes(8).toString('hex');
  
  if (originalFilename) {
    // Sanitize original filename
    const baseName = path.basename(originalFilename, path.extname(originalFilename))
      .replace(/[^a-zA-Z0-9\-_\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
    
    return `${timestamp}_${randomHash}_${baseName}.${fileExtension}`;
  }
  
  return `${timestamp}_${randomHash}_media.${fileExtension}`;
}

/**
 * Creates standardized error result object
 */
function createErrorResult(errorCode, errorMessage, requestId) {
  return {
    status: 'error',
    errorCode: errorCode,
    errorMessage: errorMessage,
    requestId: requestId,
    timestamp: new Date().toISOString()
  };
}

/**
 * Creates download URL for accessing stored file (internal Docker network)
 */
function createDownloadUrl(fileId) {
  return `${FILE_STORAGE_BASE_URL}/file/${fileId}?key=${FILE_STORAGE_API_KEY}`;
}

/**
 * Creates external download URL for third-party services like UltraMsg
 */
function createExternalDownloadUrl(fileId) {
  return `https://files.api-ai-mvp.com/file/${fileId}?key=${FILE_STORAGE_API_KEY}`;
}

/**
 * Helper function to check if message has media content
 */
function hasMediaContent(data) {
  const mediaTypes = ['image', 'audio', 'video', 'document', 'ptt', 'voice', 'sticker'];
  
  // Check if message type indicates media
  if (data.type && mediaTypes.includes(data.type)) {
    return true;
  }

  // Check if media data is present
  if (data.media) {
    return true;
  }

  // Check specific media fields
  for (const type of mediaTypes) {
    if (data[type]) {
      return true;
    }
  }

  return false;
}

module.exports = {
  downloadAndStoreMedia,
  hasMediaContent,
  createDownloadUrl,
  createExternalDownloadUrl,
  ALLOWED_EXTENSIONS,
  MEDIA_TYPE_MAPPING
};
