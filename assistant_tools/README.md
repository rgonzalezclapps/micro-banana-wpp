# OpenAI Assistant Tools Configuration

Este directorio contiene todas las definiciones de tools y configuraciones necesarias para configurar tu OpenAI Assistant con capacidades de procesamiento de imágenes usando Google Gemini.

## 📋 Archivos Incluidos

### Tool Definitions (JSON) - Updated
- `newRequest.json` - Crear solicitud con todas las imágenes consolidadas
- `updateRequest.json` - Actualizar solicitud para refinamientos
- `processRequest.json` - Ejecutar procesamiento con Google Gemini  
- `getRequestStatus.json` - Consultar estado de solicitud
- `listActiveRequests.json` - Listar solicitudes activas
- `cancelRequest.json` - Cancelar solicitud activa

### Configuration Files - V3 Security Optimized
- `enhanced_assistant_prompt_v3_secure.md` - Prompt completo con security rules (RECOMENDADO)
- `simplified_assistant_prompt_v2.md` - Prompt ultra-simple con security rules
- `enhanced_assistant_prompt_v2.md` - Versión anterior (legacy)
- `response_schema.json` - Schema de respuesta JSON
- `README.md` - Este archivo con instrucciones

## 🔧 Cómo Configurar tu OpenAI Assistant

### Paso 1: Configurar Tools
1. Ve a tu OpenAI Assistant configuration
2. En la sección "Tools", añade cada tool copiando el contenido de los archivos JSON
3. Asegúrate de que cada tool tenga `"strict": true`

### Paso 2: Configurar System Prompt  
**RECOMMENDED**: Usa las versiones V3 con seguridad optimizada
1. **Option A**: Copia `simplified_assistant_prompt_v2.md` para UX ultra-simple
2. **Option B**: Copia `enhanced_assistant_prompt_v3_secure.md` para funcionalidad completa + security ← **RECOMMENDED**
3. Pégalo en el campo "Instructions" de tu Assistant
4. **V3 Secure** incluye reglas para NUNCA exponer URLs de file storage al usuario

### Paso 3: Configurar Response Schema
1. En tu Assistant configuration, encuentra "Response format"
2. Selecciona "JSON schema"
3. Copia el contenido de `response_schema.json` y pégalo

### Paso 4: Configurar Model
- Recomendado: **GPT-4** o **GPT-4-turbo** para mejor performance con tools
- Evita: GPT-3.5-turbo (limitado para function calling complejo)

## 🧪 Cómo Probar el Sistema

### Test Básico (Simplified Flow)
```
Usuario: "Hola"
Respuesta Esperada: "¡Hola! Soy tu asistente de Foto Producto con IA. ¿Cómo te llamás?"

Usuario: "Soy Juan"
Respuesta Esperada: "Perfecto Juan. Podés enviarme imágenes para mejorar... ¿Qué necesitás?"
```

### Test de Procesamiento (Con Múltiples Imágenes)
```
Usuario: [Sube 2 imágenes] "Mejorá estos productos profesionalmente"
Expected Behavior: 
1. Saludo: "¡Hola! ¿Cómo te llamás?"
2. "Perfecto [Nombre]. Procesando tus productos..."  
3. ✅ newRequest con initialImages: ["fileId1", "fileId2"] 
4. ✅ processRequest inmediato
5. "¡Resultado profesional listo!"

System Behavior:
- Gemini combina ambas imágenes en UNA composición profesional
- Usuario recibe UN resultado cohesivo, no dos separados
```

### Test de Generación Desde Cero
```
Usuario: "Necesito una foto de zapatillas deportivas"
Respuesta Esperada:
1. Saludo + nombre
2. newRequest con text-to-image → processRequest
3. "¡Acá tenés las zapatillas generadas con IA!"
```

## 📊 Monitoreo y Debugging

### Logs Importantes
Revisa estos elementos en los logs de tu sistema:
- `🔧 Executing function [nombre] for conversation [id]`
- `📋 Creating new request with system prompt`
- `⚡ Processing request [id] with Google Gemini`
- `✅ [requestId] Processing completed successfully`

### Errores Comunes
1. **Missing GEMINI_API_KEY**: Verificar variable de entorno
2. **Multiple requests**: Si Assistant crea múltiples newRequest calls → usar prompts v2 actualizados
3. **Text-only responses**: Si Gemini devuelve solo texto → verificar system prompts incluyen image generation
4. **File not found**: Usuario referencia imagen que no existe en storage  
5. **Request timeout**: Procesamiento tomó más de 60 segundos
6. **Empty results**: Si no se generan imágenes → verificar API key y model availability

### Health Checks
```bash
# Verificar que todas las dependencies estén instaladas
npm list @google/genai

# Verificar que el servidor esté corriendo
curl http://localhost:5001/

# Test de conexión a Gemini (requiere API key configurada)
# Se puede hacer vía logs cuando se use por primera vez
```

## 🎯 Estrategias de Uso

### Para Captación de Leads
- El assistant mantendrá el flujo de captación incluso durante procesamiento
- Usa el tiempo de procesamiento (30-60s) para recolectar datos de contacto
- Posiciona el procesamiento como "muestra gratuita" de capacidades

### Para Demostración Técnica
- Ofrece procesamiento inmediato como diferenciador competitivo
- Usa resultados como proof-of-concept para servicios completos
- Captura leads "calientes" que ven valor inmediato

### Para Servicio al Cliente
- Permite múltiples iteraciones para satisfacción del cliente
- Usa getRequestStatus para gestionar expectativas de tiempo
- listActiveRequests ayuda con conversaciones complejas

## ⚠️ Limitaciones y Consideraciones

### Limitaciones Técnicas
- Máximo 3 imágenes por request (optimal para Gemini)
- Límite de 20MB por imagen (Gemini inline data limit)
- Máximo 10 iteraciones por request (prevenir loops infinitos)
- Timeout de 60 segundos por procesamiento

### Limitaciones Comerciales
- Usar como herramienta de demostración, no reemplazo de servicios completos
- Siempre derivar a equipo humano para trabajos comerciales grandes
- Mantener enfoque en captación de leads como objetivo principal

### Escalación Automática
- Si usuario no satisfecho después de 3 iteraciones → derivar
- Si procesamiento falla múltiples veces → derivar con datos recolectados
- Si usuario pide servicios muy específicos → derivar a especialista

## 🚀 Próximos Pasos

1. **Configurar API Key** en `.env`: `GEMINI_API_KEY=tu_api_key_aquí`
2. **Copiar tools** a OpenAI Assistant configuration
3. **Actualizar prompt** con el contenido mejorado
4. **Probar flujo completo** con imagen de prueba
5. **Monitorear logs** para optimizar y debuggear

¡El sistema está listo para combinar captación de leads con procesamiento de IA de última generación! 🎉
