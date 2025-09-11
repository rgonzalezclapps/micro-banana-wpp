/**
 * tools/implementations/video/videoGenerator.js
 * 
 * Description: Implementation of videoGenerator tool for Vertex AI video generation
 */

const ToolBase = require('../toolBase');

class VideoGeneratorTool extends ToolBase {
    constructor() {
        super('videoGenerator');
    }

    async implementation(parsedArgs, conversationId) {
        console.log(`🎬 Generating video using Vertex AI Veo 3.0 for conversation ${conversationId}`);
        
        // Send immediate message to user about video processing time
        if (parsedArgs.messageToUser && parsedArgs.messageToUser.trim()) {
            try {
                const ResponsesClient = require('../../../modules/responsesClient');
                const responsesClient = new ResponsesClient();
                await responsesClient.sendImmediateMessageToUser(conversationId, parsedArgs.messageToUser.trim());
            } catch (messageError) {
                console.error(`⚠️ Failed to send immediate video message (non-blocking):`, messageError.message);
            }
        }
        
        try {
            const { vertexVideoService } = require('../../../services/vertexVideoService');
            const { enqueueVideoJob } = require('../../../services/videoPollingWorker');
            
            const { prompt, imageFileId, aspectRatio, negativePrompt, modelSelected, version } = parsedArgs;
            
            if (!prompt || typeof prompt !== 'string') {
                throw new Error('Missing required parameter: prompt is required and must be a string');
            }
            
            if (!imageFileId || typeof imageFileId !== 'string') {
                throw new Error('Missing required parameter: imageFileId is required for video generation');
            }
            
            const generationOptions = {
                prompt: prompt,
                imageFileId: imageFileId,
                mode: 'async',
                modelSelected: modelSelected || 2,
                aspectRatio: aspectRatio || '16:9'
            };
            
            if (negativePrompt && negativePrompt.trim()) {
                generationOptions.negativePrompt = negativePrompt.trim();
            }
            
            const videoResult = await vertexVideoService.generateVideoWithRetry(generationOptions);
            
            if (videoResult.success) {
                if (generationOptions.mode === 'async' && videoResult.jobId) {
                    await enqueueVideoJob(videoResult.jobId, conversationId);
                }
                
                return {
                    success: true,
                    message: `Generación de video solicitada exitosamente`,
                    video_url: videoResult.videoUrl,
                    download_url: videoResult.downloadUrl,
                    job_id: videoResult.jobId,
                    execution_time: videoResult.executionTime
                };
            } else {
                return {
                    success: false,
                    error: videoResult.error || 'Error generating video',
                    message: 'No se pudo generar el video'
                };
            }
            
        } catch (error) {
            return {
                success: false,
                error: error.message || 'Error generating video',
                message: 'Hubo un error generando tu video'
            };
        }
    }
}

module.exports = VideoGeneratorTool;
