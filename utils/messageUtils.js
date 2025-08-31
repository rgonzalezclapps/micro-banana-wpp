const MAX_CHUNK_SIZE = 600; // Adjust this value as needed

function chunkMessage(message) {
  if (typeof message !== 'string') {
    return [message];
  }

  if (message.length <= MAX_CHUNK_SIZE) {
    return [message];
  }

  const chunks = [];
  let start = 0;

  while (start < message.length) {
    let end = start + MAX_CHUNK_SIZE;
    
    // If we're not at the end of the message, try to break at a space
    if (end < message.length) {
      while (end > start && message[end] !== ' ') {
        end--;
      }
      // If we couldn't find a space, just break at MAX_CHUNK_SIZE
      if (end === start) {
        end = start + MAX_CHUNK_SIZE;
      }
    }

    chunks.push(message.slice(start, end));
    start = end + 1; // Skip the space we broke on
  }

  return chunks;
}

module.exports = {
  chunkMessage
};
