#!/bin/bash
# GNS Tesla Monitor - Kaldırma Dosyası
# ÇİFT TIKLA çalıştır, hepsi bu kadar.

clear
cat << 'BANNER'
════════════════════════════════════════════
  GNS Tesla Monitor - Kaldırma İşlemi
════════════════════════════════════════════
BANNER
echo ""

echo "🛑 1/4  Servis durduruluyor..."
launchctl bootout gui/$(id -u)/com.gns.tesla-monitor 2>/dev/null
launchctl unload ~/Library/LaunchAgents/com.gns.tesla-monitor.plist 2>/dev/null
launchctl remove com.gns.tesla-monitor 2>/dev/null

echo "🗑️  2/4  Plist dosyaları siliniyor..."
rm -f ~/Library/LaunchAgents/com.gns.tesla-monitor.plist
rm -f /Library/LaunchAgents/com.gns.tesla-monitor.plist 2>/dev/null
rm -f /Library/LaunchDaemons/com.gns.tesla-monitor.plist 2>/dev/null

echo "💀 3/4  Çalışan işlemler kapatılıyor..."
pkill -9 -f "gns-tesla-monitor" 2>/dev/null
pkill -9 -f "monitor.js" 2>/dev/null
pkill -9 -f "playwright" 2>/dev/null
pkill -9 -f "chromium" 2>/dev/null
pkill -9 -f "Chromium" 2>/dev/null

echo "📁 4/4  Proje klasörü siliniyor..."
rm -rf ~/gns-tesla-monitor

sleep 1
echo ""
echo "════════════════════════════════════════════"

# Doğrulama
REMAIN=""
[ -f ~/Library/LaunchAgents/com.gns.tesla-monitor.plist ] && REMAIN="$REMAIN plist"
[ -d ~/gns-tesla-monitor ] && REMAIN="$REMAIN klasör"
pgrep -f "gns-tesla-monitor\|monitor.js" > /dev/null 2>&1 && REMAIN="$REMAIN process"
launchctl list 2>/dev/null | grep -q "com.gns.tesla-monitor" && REMAIN="$REMAIN servis"

if [ -z "$REMAIN" ]; then
  echo "  ✅ BAŞARIYLA KALDIRILDI!"
  echo "════════════════════════════════════════════"
  echo ""
  echo "  Artık Telegram'a mesaj gelmeyecek."
  echo "  Bu pencereyi kapatabilirsin."
else
  echo "  ⚠️  Kalanlar:$REMAIN"
  echo "════════════════════════════════════════════"
  echo ""
  echo "  Mac'i yeniden başlat, otomatik temizlenecek."
fi

echo ""
echo "─────────────────────────────────────────────"
echo "Kapatmak için herhangi bir tuşa bas..."
read -n 1 -s
