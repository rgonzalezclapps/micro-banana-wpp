# Configuración
  API_URL="http://206.189.172.229:3000/api/generate-site"
  API_KEY="AIA_7h9j2k8m4n6p1q3r5s7t9u2w4x6y8z0a2b4c6d8e0f2g4h6i8j0k2l4m6n8o0p2q4r6s8t0u2v4w6x8y0z2"
  TIMEOUT=960 # 16 minutes (1 minute más que el server)

  # Colores para output
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  NC='\033[0m' # No Color

  # Función para mostrar timestamp
  timestamp() {
      date "+%Y-%m-%d %H:%M:%S"
  }

  # Función para log con color
  log() {
      echo -e "${BLUE}[$(timestamp)]${NC} $1"
  }

  success() {
      echo -e "${GREEN}[$(timestamp)] ✅ $1${NC}"
  }

  error() {
      echo -e "${RED}[$(timestamp)] ❌ $1${NC}"
  }

  warning() {
      echo -e "${YELLOW}[$(timestamp)] ⚠️  $1${NC}"
  }

  # Prompts de ejemplo
  PROMPTS=(
      "Laboratorio farmacéutico institucional especializado en medicamentos genéricos"
      "Restaurante de sushi japonés auténtico"
      "Estudio jurídico especializado en derecho comercial"
      "Clínica dental moderna con servicios de ortodoncia"
      "Agencia de marketing digital para pymes"
  )

  # Banner
  echo -e "${BLUE}"
  echo "=================================================="
  echo "🚀 PRUEBA DE GENERACIÓN DE SITIOS WEB"
  echo "=================================================="
  echo -e "${NC}"

  # Selección del prompt
  echo "Selecciona el tipo de sitio web a generar:"
  for i in "${!PROMPTS[@]}"; do
      echo "$((i+1)). ${PROMPTS[$i]}"
  done
  echo "6. Personalizado"

  read -p "Ingresa tu opción (1-6): " option

  if [ "$option" -eq 6 ]; then
      read -p "Ingresa tu prompt personalizado: " CUSTOM_PROMPT
      PROMPT="$CUSTOM_PROMPT"
  elif [ "$option" -ge 1 ] && [ "$option" -le 5 ]; then
      PROMPT="${PROMPTS[$((option-1))]}"
  else
      error "Opción inválida"
      exit 1
  fi

  log "Prompt seleccionado: '$PROMPT'"

  # Crear payload JSON
  PAYLOAD=$(jq -n --arg prompt "$PROMPT" '{prompt: $prompt}')

  log "Iniciando generación de sitio web..."
  log "Timeout configurado: $TIMEOUT segundos (16 minutos)"
  warning "Esto puede tomar entre 5-15 minutos. Por favor espera..."

  START_TIME=$(date +%s)

  # Realizar request con timeout
  RESPONSE=$(curl -s -X POST "$API_URL?key=$API_KEY" \
      -H "Content-Type: application/json" \
      -d "$PAYLOAD" \
      --max-time $TIMEOUT \
      --write-out "HTTPSTATUS:%{http_code}")

  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))

  # Extraer código HTTP y response body
  HTTP_CODE=$(echo "$RESPONSE" | grep -o 'HTTPSTATUS:[0-9]*' | cut -d: -f2)
  BODY=$(echo "$RESPONSE" | sed 's/HTTPSTATUS:[0-9]*$//')

  echo ""
  echo "=================================================="
  log "Respuesta recibida después de ${DURATION} segundos"
  echo "=================================================="

  if [ "$HTTP_CODE" = "200" ]; then
      success "¡Generación exitosa! 🎉"

      # Parsear JSON response
      URL=$(echo "$BODY" | jq -r '.url // empty')
      MESSAGE=$(echo "$BODY" | jq -r '.message // empty')
      REQUEST_ID=$(echo "$BODY" | jq -r '.requestId // empty')

      echo ""
      echo -e "${GREEN}📋 DETALLES:${NC}"
      echo "• URL: $URL"
      echo "• Mensaje: $MESSAGE"
      echo "• Request ID: $REQUEST_ID"
      echo "• Duración: ${DURATION}s"

      if [ -n "$URL" ]; then
          echo ""
          log "Verificando accesibilidad del sitio..."

          # Test HTTPS
          if curl -s -I "$URL" >/dev/null 2>&1; then
              success "Sitio accesible via HTTPS ✅"
          else
              error "Sitio no accesible via HTTPS ❌"
          fi

          # Test redirect HTTP -> HTTPS
          HTTP_URL=${URL/https:/http:}
          if curl -s -I "$HTTP_URL" | grep -q "301"; then
              success "Redirección HTTP -> HTTPS funcionando ✅"
          else
              warning "Redirección HTTP -> HTTPS no detectada"
          fi

          echo ""
          echo -e "${BLUE}🌐 ACCEDE A TU SITIO:${NC}"
          echo -e "${GREEN}$URL${NC}"
          echo ""
      fi

  elif [ "$HTTP_CODE" = "400" ] || [ "$HTTP_CODE" = "500" ]; then
      error "Error en la generación"

      ERROR_MSG=$(echo "$BODY" | jq -r '.error // "Error desconocido"')
      DETAILS=$(echo "$BODY" | jq -r '.details // "Sin detalles"')

      echo ""
      echo -e "${RED}❌ DETALLES DEL ERROR:${NC}"
      echo "• Error: $ERROR_MSG"
      echo "• Detalles: $DETAILS"
      echo "• Código HTTP: $HTTP_CODE"
      echo "• Duración: ${DURATION}s"

  elif [ -z "$HTTP_CODE" ]; then
      error "Timeout o error de conexión"
      echo ""
      echo -e "${RED}❌ POSIBLES CAUSAS:${NC}"
      echo "• El servidor tardó más de 16 minutos"
      echo "• Problema de conectividad"
      echo "• El servidor está sobrecargado"
      echo "• Duración: ${DURATION}s"

  else
      error "Respuesta inesperada (HTTP $HTTP_CODE)"
      echo "Body: $BODY"
  fi

  echo ""
  echo "=================================================="
  log "Prueba completada"
  echo "=================================================="