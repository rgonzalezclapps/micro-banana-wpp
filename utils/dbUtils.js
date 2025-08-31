const MAX_RETRIES = 3;

async function saveWithRetry(document, maxRetries = MAX_RETRIES) {
  let retries = maxRetries;
  while (retries > 0) {
    try {
      await document.save();
      return document; // Return the saved document
    } catch (error) {
      if (error.name === 'VersionError' && retries > 1) {
        console.log(`Optimistic concurrency conflict, retrying... (${retries - 1} attempts left)`);
        retries--;
        document = await document.constructor.findById(document._id);
      } else {
        throw error;
      }
    }
  }
  return document; // Optionally return the document after all retries
}

module.exports = {
  saveWithRetry
};
