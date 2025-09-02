# 📋 Video API Environment Variables Setup

## **Variables Requeridas para Video Generation**

Agregar estas variables a tu archivo `.env` o environment del servidor:

```bash
# ============================================================================
# VIDEO GENERATION API CONFIGURATION
# ============================================================================

# ============================================================================
# 🏠 ENTORNO LOCAL (tu máquina)
# ============================================================================
# Para desarrollo local - usa API externa con autenticación
VIDEO_API_EXTERNAL_URL=https://video.api-ai-mvp.com
VIDEO_API_KEY=AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2

# ============================================================================  
# 🐳 ENTORNO DOCKER (servidor)
# ============================================================================
# Para producción en servidor - usa servicio interno sin autenticación
VIDEO_API_INTERNAL_URL=http://vertex_ai_api:5002
DOCKER_ENV=true
# En Docker NO necesita VIDEO_API_KEY para comunicación interna

# File Storage URL (ya existe, confirmar que está configurada)
FILE_STORAGE_EXTERNAL_URL=https://files.api-ai-mvp.com

# ============================================================================
# OPTIONAL: Advanced video configuration
# ============================================================================

# Timeout para video generation (default: 120000 = 2 minutos)
VIDEO_TIMEOUT_SYNC=120000

# Maximum retries para failed video generation (default: 2)
VIDEO_MAX_RETRIES=2

# Video generation priority en UltraMsg (default: 3)
VIDEO_PRIORITY=3
```

## **🔧 Valores por Defecto**

Si no configuras las variables, el sistema usa estos fallbacks:

```javascript
VIDEO_API_INTERNAL_URL = 'http://vertex_ai_api:5002'        // Docker interno
VIDEO_API_EXTERNAL_URL = 'https://video.api-ai-mvp.com'     // Acceso externo  
VIDEO_API_KEY = process.env.API_KEY_WEBHOOK                  // Usa API key existente
FILE_STORAGE_EXTERNAL_URL = 'https://files.api-ai-mvp.com'  // File storage URL
```

## **✅ Verificación**

Para verificar que las variables están correctas:

```bash
# Test desde terminal del servidor
curl http://vertex_ai_api:5002/health

# Debe retornar:
# {"status":"ok","service":"vertex-ai-video-api","timestamp":"..."}
```

**🚀 Si el health check funciona, el sistema de video está listo para usar!**
