#!/bin/bash
echo "🧪 Testing CORS Fix en start_mitosis.sh..."

echo "1. Verificando configuración actual de CORS:"
grep -A 6 "^FRONTEND_ORIGINS" /app/backend/server.py

echo ""
echo "2. Testing conectividad a URLs:"
if curl -s --max-time 3 https://a075526f-6c0c-4a1c-8f21-901f0b838def.preview.emergentagent.com >/dev/null 2>&1; then
    echo "   ✅ cell-split-exec.preview.emergentagent.com - ACCESIBLE"
else
    echo "   ❌ cell-split-exec.preview.emergentagent.com - NO ACCESIBLE"
fi

if curl -s --max-time 3 https://a075526f-6c0c-4a1c-8f21-901f0b838def.preview.emergentagent.com >/dev/null 2>&1; then
    echo "   ✅ d1c8ceae-497e-462b-a5fa-5c5f477c24df.preview.emergentagent.com - ACCESIBLE"
else
    echo "   ❌ d1c8ceae-497e-462b-a5fa-5c5f477c24df.preview.emergentagent.com - NO ACCESIBLE"
fi

echo ""
echo "3. Testing CORS WebSocket desde ambas URLs:"
for origin_url in "https://a075526f-6c0c-4a1c-8f21-901f0b838def.preview.emergentagent.com"; do
    echo "   Testing desde: $origin_url"
    cors_test=$(curl -s -H "Origin: $origin_url" "http://localhost:8001/api/socket.io/?EIO=4&transport=polling" 2>/dev/null || echo "error")
    if echo "$cors_test" | grep -q '"sid"'; then
        echo "   ✅ CORS OK - Socket.IO responde correctamente"
    else
        echo "   ❌ CORS FAIL - Socket.IO no accesible desde este origen"
    fi
done

echo ""
echo "🎯 CONCLUSIÓN: Script modificado debe detectar automáticamente y configurar ambas URLs"