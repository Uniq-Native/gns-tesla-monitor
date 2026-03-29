#!/bin/bash
# GNS Tesla Monitor - Hetzner Deploy Script
# Kullanım: ./deploy.sh

set -e

HETZNER_IP="178.104.11.115"
REMOTE_DIR="/opt/gns-tesla-monitor"

echo "═══════════════════════════════════════"
echo "  GNS Tesla Monitor - Deploy"
echo "═══════════════════════════════════════"

# .env dosyası kontrol
if [ ! -f .env ]; then
  echo "❌ .env dosyası bulunamadı!"
  echo "   cp .env.example .env yapıp doldurun"
  exit 1
fi

echo "📦 Dosyalar Hetzner'a kopyalanıyor..."
ssh root@$HETZNER_IP "mkdir -p $REMOTE_DIR"
scp package.json monitor.js Dockerfile docker-compose.yml .env root@$HETZNER_IP:$REMOTE_DIR/

echo "🐳 Docker container başlatılıyor..."
ssh root@$HETZNER_IP "cd $REMOTE_DIR && docker compose down 2>/dev/null; docker compose up -d --build"

echo ""
echo "✅ Deploy tamamlandı!"
echo "📋 Logları görmek için:"
echo "   ssh root@$HETZNER_IP 'docker logs -f gns-tesla-monitor'"
echo ""
