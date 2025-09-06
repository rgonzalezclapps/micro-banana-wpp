# 🎬 VERTEX AI VIDEO GENERATION API - DOCUMENTACIÓN COMPLETA

## 📍 Información General

| Aspecto            | Configuración                |
|--------------------|------------------------------|
| Dominio Público    | https://video.api-ai-mvp.com |
| Container          | vertex_ai_api (puerto 5002)  |
| Tecnología         | Node.js 20 + Express.js      |
| Modelos Soportados | Veo 2.0, Veo 3.0             |
| Autenticación      | API Key obligatoria          |
| SSL                | HTTPS con Let's Encrypt      |

## 🔐 Autenticación

API Key requerida: `AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2`

**Métodos de autenticación:**
- Header: `X-API-Key: API_KEY`
- Bearer Token: `Authorization: Bearer API_KEY`
- Query Parameter: `?api_key=API_KEY`

## 🎯 Endpoints Disponibles

### 1. POST /generate-video - Generar Video

Descripción: Genera videos usando IA con texto o imagen como entrada.

#### Parámetros del Body (JSON)

| Parámetro        | Tipo          | Requerido | Descripción               | Valores                   |
|------------------|---------------|-----------|---------------------------|---------------------------|
| prompt           | string        | ✅ Sí      | Descripción del video     | Límite: 1255 caracteres   |
| imageFileId      | string        | ✅ Sí      | ID de imagen storage      | 32 caracteres hexadecimal |
| aspectRatio      | string        | ❌ No      | Formato: "9:16", "16:9"   | Auto-detecta del prompt    |
| negativePrompt   | string        | ❌ No      | Elementos a evitar        | Máximo 500 caracteres     |
| modelSelected    | integer       | ❌ No      | Modelo específico: 2 o 3  | Default: Auto-selección    |
| messageToUser    | string        | ❌ No      | Mensaje inmediato         | Feedback procesamiento     |

#### Restricciones de Aspect Ratio

| Modelo | Aspect Ratios Soportados          |
|--------|-----------------------------------|
| Veo 2  | 16:9 (landscape), 9:16 (vertical) |
| Veo 3  | 16:9 (landscape) únicamente       |

#### Límite de Prompt por Modelo

| Modelo | Límite de Caracteres | Estado    |
|--------|----------------------|-----------|
| Veo 2  | 1255 caracteres      | ✅ Ajustado |
| Veo 3  | 1255 caracteres      | ✅ Ajustado |

**Nota:** Prompts de más de 1255 caracteres fallarán con error "Prompt must be 1255 characters or less".

### 2. GET /job/{jobId} - Consultar Estado

Descripción: Consulta el estado de un job de generación de video.

**Respuestas posibles:**
- `processing` - Video en generación
- `completed` - Video listo con URL de descarga
- `failed` - Generación falló

### 3. GET /health - Health Check

Descripción: Verifica el estado del servicio (sin autenticación).

### 4. GET /test-gcloud - Test Google Cloud

Descripción: Prueba la conexión con Google Cloud Vertex AI.

## 📝 Ejemplos de Uso

### Ejemplo 1: Video Simple (Async)

```bash
curl -X POST https://video.api-ai-mvp.com/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2" \
  -d '{
    "prompt": "Una persona profesional saludando con la mano en una oficina moderna",
    "version": 3,
    "mode": "async",
    "aspectRatio": "16:9"
  }'
```

**Respuesta:**
```json
{
  "jobId": "job_1757152636631_139fj427i",
  "status": "processing",
  "mode": "async",
  "message": "Video generation request submitted to Google GenAI",
  "statusUrl": "/job/job_1757152636631_139fj427i",
  "details": {
    "prompt": "Una persona profesional saludando...",
    "aspectRatio": "16:9",
    "duration": 5,
    "version": 3,
    "model": "veo-3.0-generate-preview",
    "hasImage": false
  }
}
```

### Ejemplo 2: Video Vertical con Veo 2

```bash
curl -X POST https://video.api-ai-mvp.com/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2" \
  -d '{
    "prompt": "Un ejecutivo presentando en una pantalla táctil",
    "version": 2,
    "mode": "async",
    "aspectRatio": "9:16"
  }'
```

### Ejemplo 3: Image-to-Video

```bash
curl -X POST https://video.api-ai-mvp.com/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2" \
  -d '{
    "prompt": "La persona sonríe y saluda naturalmente",
    "version": 3,
    "mode": "async",
    "imageUrl": "https://files.api-ai-mvp.com/file/{fileId}?key=API_KEY"
  }'
```

### Ejemplo 4: Modo Sync (Espera hasta completar)

```bash
curl -X POST https://video.api-ai-mvp.com/generate-video \
  -H "Content-Type: application/json" \
  -H "X-API-Key: AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2" \
  -d '{
    "prompt": "Un chef preparando una comida gourmet",
    "version": 2,
    "mode": "sync"
  }'
```

### Ejemplo 5: Consultar Estado del Job

```bash
curl -H "X-API-Key: AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2" \
  https://video.api-ai-mvp.com/job/job_1757152636631_139fj427i
```

**Respuesta completada:**
```json
{
  "jobId": "job_1757152636631_139fj427i",
  "status": "completed",
  "timestamp": "2025-09-06T09:45:30.426Z",
  "message": "Video generation completed successfully",
  "completedAt": "2025-09-06T09:45:26.084Z",
  "videoUrl": "https://files.api-ai-mvp.com/file/abc123def456?key=API_KEY",
  "operationName": "projects/.../operations/..."
}
```

## 🔧 Configuración Técnica

### Modelos Disponibles

| Versión | Modelo ID                | Capacidades                         |
|---------|--------------------------|-------------------------------------|
| Veo 2   | veo-2.0-generate-001     | 16:9, 9:16, Image-to-Video          |
| Veo 3   | veo-3.0-generate-preview | 16:9, Image-to-Video, Mejor calidad |

### Tiempos de Procesamiento

| Modo  | Flujo de Respuesta                    | Timeout   |
|-------|---------------------------------------|-----------|
| Async | Inmediato: {status: "processing"} → Polling requerido | 5 minutos |
| Sync  | Espera hasta completar: {videoUrl: "..."} | 5 minutos |

### Estados de Respuesta Válidos

| Estado     | Significado               | Es Success? |
|------------|---------------------------|-------------|
| processing | Job iniciado (async mode) | ✅ Sí       |
| queued     | Job en cola (async mode)  | ✅ Sí       |
| completed  | Video listo (ambos modos) | ✅ Sí       |
| failed     | Generación falló          | ❌ No       |

### Almacenamiento de Videos

- **Ubicación:** `https://files.api-ai-mvp.com/file/{crypto-id}?key=API_KEY`
- **Formato:** MP4
- **Duración:** 8 segundos (Veo 3), 5-10 segundos (Veo 2)
- **Resolución:** HD automática
- **Seguridad:** IDs criptográficamente seguros

## 🚨 Códigos de Error

| Código | Error                                                                | Descripción                            |
|--------|----------------------------------------------------------------------|----------------------------------------|
| 400    | Prompt is required                                                   | Falta el prompt                        |
| 400    | Prompt must be 1255 characters or less                              | Prompt excede límite de caracteres     |
| 400    | Version is required                                                  | Falta la versión del modelo            |
| 400    | Version must be "2" or "3"                                           | Versión inválida                       |
| 400    | Mode must be "sync" or "async"                                       | Modo inválido                          |
| 400    | Aspect ratio must be one of: 16:9 for model veo-3.0-generate-preview | Aspect ratio no soportado              |
| 401    | Invalid API key                                                      | API key inválida o faltante            |
| 500    | Operation completed but no video was generated                       | Falla en generación (prompt muy largo) |

## 💡 Mejores Prácticas

### Prompts Efectivos

- **Máximo 1255 caracteres** para evitar fallos
- Ser específico sobre personas, objetos, iluminación
- Incluir detalles de cámara y ambiente
- Evitar conceptos abstractos complejos

### Selección de Modelo

- **Veo 3:** Mayor calidad, solo 16:9, más reciente
- **Veo 2:** Más formatos, incluye 9:16 para móviles

### Gestión de Jobs

- **Async recomendado** para integración con sistemas
- **Sync útil** para demos o testing
- **Polling cada 5-10 segundos** para verificar estado

### Image-to-Video

- Usar `imageUrl` para archivos del storage interno
- **Formatos soportados:** JPEG, PNG, WebP, GIF
- **Tamaño máximo:** 20MB por imagen
- **Mejor resultado:** Imágenes con personas claramente visibles

## 📊 Límites y Cuotas

| Límite              | Valor            | Scope          |
|---------------------|------------------|----------------|
| Requests por minuto | 10               | Por proyecto   |
| Videos por request  | 1                | Por llamada    |
| Duración máxima     | 8 segundos       | Veo 3          |
| Prompt máximo       | 1255 caracteres  | Ambos modelos  |
| Imagen máxima       | 20MB             | Image-to-video |

## 🔗 Integración con Otros Servicios

### Con File Storage

```javascript
// Subir imagen primero
const uploadResponse = await fetch('https://files.api-ai-mvp.com/upload?key=API_KEY', {
  method: 'POST',
  body: formData
});

// Usar en video generation
const videoResponse = await fetch('https://video.api-ai-mvp.com/generate-video', {
  method: 'POST',
  headers: { 'X-API-Key': 'API_KEY' },
  body: JSON.stringify({
    prompt: 'La persona sonríe y saluda',
    version: 3,
    imageUrl: `https://files.api-ai-mvp.com/file/${fileId}?key=API_KEY`
  })
});
```

### Con Webhook System

```javascript
// Desde banana-server (container interno)
const response = await fetch('http://vertex_ai_api:5002/generate-video', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(videoParams)
});
```

## 🎥 Integración con AI Agents API

### Desde openaiIntegration.js

El `videoGenerator` tool en `modules/openaiIntegration.js` utiliza esta API internamente con **polling automático**:

```javascript
case "videoGenerator":
  // Smart model selection con respeto a preferencias del usuario
  const detectedAspectRatio = this.detectAspectRatio(prompt, aspectRatio);
  const modelConfig = this.selectOptimalModel(detectedAspectRatio, modelSelected);
  
  // Generación con parámetros inteligentes
  const videoResult = await vertexVideoService.generateVideoWithRetry({
    prompt: parsedArgs.prompt,
    imageFileId: parsedArgs.imageFileId,
    mode: 'async', // Siempre async para mejor UX
    model: modelConfig.model,
    version: modelConfig.version,
    aspectRatio: detectedAspectRatio,
    negativePrompt: parsedArgs.negativePrompt
  });
  
  // ✅ NUEVO: Auto-polling setup para async jobs
  if (videoResult.jobId) {
    await enqueueVideoJob(videoResult.jobId, conversationId);
    // Usuario recibirá video automáticamente cuando esté listo
  }
```

### Parámetros del videoGenerator Tool (Enhanced)

- **`prompt`:** Descripción del video (máximo 1255 caracteres) ✅
- **`imageFileId`:** ID de imagen para image-to-video (formato hexadecimal 32 chars) ✅
- **`aspectRatio`:** "9:16" (vertical) o "16:9" (horizontal) - auto-detecta del prompt 🆕
- **`negativePrompt`:** Elementos a evitar (opcional, máximo 500 chars) 🆕
- **`modelSelected`:** 2 (Veo 2.0) o 3 (Veo 3.0) - respeta preferencia del usuario 🆕
- **`messageToUser`:** Mensaje inmediato sobre procesamiento (requerido) ✅

### Sistema de Polling Automático 🆕

**Flujo Completo para Async Mode:**
1. **Tool Response**: Inmediato con `jobId` y `statusUrl`
2. **Background Polling**: Worker polls cada 10s por 5min máximo
3. **Completion Notification**: Video enviado automáticamente via messaging service original
4. **Error Handling**: Notificación de fallo si timeout o API error

**Endpoints de Polling:**
- **Status Check**: `GET https://video.api-ai-mvp.com/job/{jobId}`
- **Polling Worker**: Background proceso que monitorea todos los jobs async
- **Recovery**: Jobs recuperados después de restart del servidor

**Mensajes de Notificación:**
- **Success**: `🎥 ¡Tu video está listo! Se generó en 65 segundos.` + video nativo
- **Failure**: `😔 Hubo un problema generando tu video: [error]. Por favor intenta nuevamente.`

---

## 🎯 STATUS: API COMPLETAMENTE OPERATIVA

✅ **Características Activas:**
- Soporte completo para Veo 2.0 y Veo 3.0
- Modos sync y async funcionales
- Aspect ratios: 16:9 (ambos), 9:16 (solo Veo 2)
- Image-to-video con file storage integration
- Límite de prompt ajustado a 1255 caracteres
- Autenticación multi-método
- Health checks y monitoring

**🔄 Última Actualización:** Límite de prompt aumentado de 500 a 1255 caracteres para mayor flexibilidad en prompts detallados.
