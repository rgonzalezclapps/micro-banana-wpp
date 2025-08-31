/**
 * Utility service that provides common reusable functions
 * @class UtilsService
 */
class UtilsService {
    /**
     * Creates an instance of UtilsService
     * @constructor
     */
    constructor() {
        /**
         * Default number of retry attempts
         * @type {number}
         */
        this.retries = 3;

        /**
         * Default delay between retries in milliseconds
         * @type {number}
         */
        this.delay = 3000;
    }

    /**
     * Executes a function with automatic retries and exponential backoff
     * @async
     * @param {Function} requestFn - Function to execute with retries
     * @param {number} [retries=3] - Maximum number of retry attempts
     * @param {number} [delay=3000] - Initial delay between retries in milliseconds
     * @returns {Promise<any>} Result of the executed function
     * @throws {Error} If all retry attempts fail
     * 
     * @example
     * // Example usage with an async function
     * const result = await utilsService.retryableRequest(
     *   async () => await api.getData(),
     *   3,
     *   1000
     * );
     */
    async retryableRequest(requestFn, retries = this.retries, delay = this.delay) {
        let attempt = 0;
        while (attempt < retries) {
            try {
                const result = await requestFn();
                // Check if result is an empty array (considered as error)
                if (
                    result?.items &&
                    Array.isArray(result.items) &&
                    result.items.length === 0
                ) {
                    throw new Error("Empty items array");
                }
                return result;
            } catch (error) {
                console.error(error);
                attempt++;
                if (attempt < retries) {
                    console.log(
                        `Retrying request... ${attempt + 1} of ${retries}`
                    );
                    // Wait with exponential backoff before next attempt
                    await new Promise((r) => setTimeout(r, delay));
                }
            }
        }
        return null;
    }
}

module.exports = new UtilsService();
