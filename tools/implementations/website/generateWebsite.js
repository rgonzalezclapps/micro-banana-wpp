/**
 * tools/implementations/website/generateWebsite.js
 * 
 * Description: Implementation of generateWebsite tool for website generation
 */

const ToolBase = require('../toolBase');

class GenerateWebsiteTool extends ToolBase {
    constructor() {
        super('generateWebsite');
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`🌐 Generating website for conversation ${conversationId}`);
        
        // Send immediate message to user about processing time
        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
            try {
                const ResponsesClient = require('../../../modules/responsesClient');
                const responsesClient = new ResponsesClient();
                await responsesClient.sendImmediateMessageToUser(conversationId, parsedArgs.messageToUser.trim());
            } catch (messageError) {
                console.error(`⚠️ Failed to send immediate message (non-blocking):`, messageError.message);
            }
        }
        
        try {
            const { webGeneratorService } = require('../../../services/webGeneratorService');
            const { prompt } = parsedArgs;
            
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('Missing required parameter: prompt is required and must be a string');
            }
            
            const generationResult = await webGeneratorService.initiateGeneration(
                prompt.trim(),
                conversationId
            );
            
            if (generationResult.success) {
                return {
                    success: true,
                    message: generationResult.message,
                    tracking_url: generationResult.trackingUrl,
                    project_id: generationResult.projectId,
                    request_id: generationResult.requestId,
                    seed: generationResult.seed
                };
            } else {
                return {
                    success: false,
                    error: generationResult.error || 'Error initiating website generation',
                    message: generationResult.message || 'No se pudo iniciar la generación del sitio web'
                };
            }
            
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Error generating website',
                message: 'Hubo un error generando tu sitio web'
            };
        }
    }
}

module.exports = GenerateWebsiteTool;
