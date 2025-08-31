const { chunkMessage } = require('../utils/messageUtils');

async function processMessage(data, type) {
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
      sender: data.quotedMsg.fromMe ? 'ai_agent' : 'user',
      id: data.quotedMsg.id,
      media: data.quotedMsg.media ? {
        type: data.quotedMsg.type,
        content: 'Media content. Please reference the conversation history through the quoted message id to find the quoted message in regards of the content and type of media.'
      } : undefined
    };
  }

  const chunkedContent = messageContent ? chunkMessage(messageContent) : null;
  // const chunkedAudioTranscription = audioTranscription ? chunkMessage(audioTranscription) : null;

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
    originalIndex: Date.now()
  };
}

module.exports = {
  processMessage
};
