// Core Node.js modules
const dotenv = require("dotenv");
// Third-party dependencies
const axios = require("axios");
const UtilsService = require("./utils.service");

dotenv.config();

/**
 * Base service class providing common database and API operations
 * @class BaseService
 */
class BaseService {
    constructor() {}

    /**
     * Retrieves all records from a given model
     * @async
     * @param {Object} model - Sequelize model
     * @param {Object} [options={}] - Additional Sequelize query options
     * @returns {Promise<Array>} Array of model instances
     * @throws {Error} If database query fails
     */
    async get(model, options = {}) {
        try {
            return await model.findAll({ raw: true, ...options });
        } catch (error) {
            throw new Error(`Error fetching data: ${error.message}`);
        }
    }

    /**
     * Retrieves a single record by its primary key
     * @async
     * @param {Object} model - Sequelize model
     * @param {number|string} id - Primary key value
     * @returns {Promise<Object>} Model instance
     * @throws {Error} If database query fails
     */
    async getById(model, id) {
        try {
            return await model.findByPk(id, { raw: true });
        } catch (error) {
            throw new Error(`Error fetching data by ID: ${error.message}`);
        }
    }

    /**
     * Makes a GET request to an external API
     * @async
     * @param {string} url - API endpoint URL
     * @param {Object} [params] - Query parameters
     * @param {Object} [headers] - Request headers
     * @returns {Promise<any>} API response data
     * @throws {Error} If API request fails
     */
    async getFromApi(url, params, headers) {
        return await UtilsService.retryableRequest(async () => {
            const response = await axios.get(url, {
                params,
                headers,
            });
            return response.data;
        });
    }
}

module.exports = BaseService;
