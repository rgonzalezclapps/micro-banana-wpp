const { chunkMessage } = require('../utils/messageUtils');
const { downloadAndStoreMedia, hasMediaContent } = require('../utils/fileStorageUtils');

async function processMessage(data, type, conversationId = null, messageQueue = null) {
  const { body, time } = data;
  let messageContent = '';
  let quotedMessage = null;

  if (type === 'ptt' || type === 'audio') {
    messageContent = '';
  } else {
    messageContent = Array.isArray(body) ? body.join('\n\n') : body || '';
  }

  if (data.quotedMsg && Object.keys(data.quotedMsg).length > 0) {
    quotedMessage = {
      content: chunkMessage(data.quotedMsg.body || '').map((chunk, index) => ({ order: index, content: chunk })),
      sender: data.quotedMsg.fromMe ? 'user' : 'ai_agent',
      id: data.quotedMsg.id,
      media: data.quotedMsg.media ? {
        content: 'Media content. Please reference the conversation history through the quoted message id to find the quoted message in regards of the content and type of media.'
      } : undefined
    };
  }

  const chunkedContent = messageContent ? chunkMessage(messageContent) : null;
  // const chunkedAudioTranscription = audioTranscription ? chunkMessage(audioTranscription) : null;

  // ============================================================================
  // Media Storage Processing - Download and store media files securely
  // ============================================================================
  
  let fileStorageResult = { status: 'not_applicable' };
  
  // Check if message contains media content that needs to be stored
  if (hasMediaContent(data)) {
    console.log(`📁 Processing media for message type: ${type}`, {
      messageId: data.id,
      hasMedia: !!data.media,
      filename: data.filename
    });

    try {
      // Set initial status to pending
      fileStorageResult.status = 'pending';

      // Extract original filename from various possible sources
      const originalFilename = data.filename || 
                              (data.media && typeof data.media === 'object' && data.media.filename) ||
                              null;

      // Generate request ID for media tracking
      const mediaRequestId = `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // 🔥 NEW: Register pending media operation if tracking is available
      if (conversationId && messageQueue) {
        messageQueue.addPendingMedia(conversationId, mediaRequestId);
      }
      
      // Download and store media using our secure file storage service
      const storageResult = await downloadAndStoreMedia(data.media, type, originalFilename, mediaRequestId);

      // Update file storage result based on download/upload outcome
      if (storageResult.status === 'success') {
        fileStorageResult = {
          status: 'success',
          fileId: storageResult.fileId,
          filename: storageResult.filename,
          originalFilename: storageResult.originalFilename,
          fileSize: storageResult.fileSize,
          fileSizeHuman: storageResult.fileSizeHuman,
          contentType: storageResult.contentType,
          downloadUrl: storageResult.downloadUrl,
          uploadDate: storageResult.uploadDate,
          requestId: storageResult.requestId
        };

        console.log(`✅ Media storage successful for message ${data.id}`, {
          fileId: fileStorageResult.fileId,
          filename: fileStorageResult.filename,
          fileSize: fileStorageResult.fileSizeHuman
        });

        // 🔥 NEW: Mark media operation as completed if tracking is available
        if (conversationId && messageQueue) {
          messageQueue.completePendingMedia(conversationId, mediaRequestId);
        }

      } else {
        // Storage failed - set error status but continue processing message
        fileStorageResult = {
          status: 'error',
          errorCode: storageResult.errorCode,
          errorMessage: storageResult.errorMessage,
          requestId: storageResult.requestId
        };

        console.error(`❌ Media storage failed for message ${data.id}:`, {
          errorCode: storageResult.errorCode,
          errorMessage: storageResult.errorMessage,
          requestId: storageResult.requestId
        });

        // 🔥 NEW: Mark media operation as completed even if failed (to unblock queue)
        if (conversationId && messageQueue) {
          messageQueue.completePendingMedia(conversationId, mediaRequestId);
        }
      }

    } catch (error) {
      // Unexpected error during media processing
      console.error(`🚨 Unexpected error processing media for message ${data.id}:`, error);
      fileStorageResult = {
        status: 'error',
        errorCode: 'UNEXPECTED_ERROR',
        errorMessage: error.message,
        requestId: `error_${Date.now()}`
      };

      // 🔥 NEW: Mark media operation as completed even on unexpected error (to unblock queue)
      if (conversationId && messageQueue && typeof mediaRequestId !== 'undefined') {
        messageQueue.completePendingMedia(conversationId, mediaRequestId);
      }
    }
  }

  return {
    sender: 'user',
    content: chunkedContent ? chunkedContent.map((chunk, index) => ({ order: index, content: chunk })) : [],
    audioTranscription: {
      status: 'pending',
      text: []
    },
    timestamp: new Date(time * 1000),
    status: 'pending',
    ultraMsgData: data,
    from: data.from,
    to: data.to,
    author: data.author,
    pushname: data.pushname,
    type: data.type,
    body: body,
    quotedMessage: quotedMessage,
    media: data.media,
    filename: data.filename || null,
    hash: data.hash,
    msg_foreign_id: data.id,
    originalIndex: Date.now(),
    // File storage result for media messages
    fileStorage: fileStorageResult
  };
}

module.exports = {
  processMessage
};
