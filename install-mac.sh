#!/bin/bash
# GNS Tesla Monitor - Mac Mini Kurulum Scripti
# Güneş'in Mac Mini'sine kopyala yapıştır yapması yeterli

set -e

echo "════════════════════════════════════════════"
echo "  GNS Tesla Monitor - Mac Mini Kurulum"
echo "════════════════════════════════════════════"

# 1. Node.js kontrol
if ! command -v node &> /dev/null; then
  echo "📦 Node.js kuruluyor..."
  curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh | bash
  brew install node
fi
echo "✅ Node.js: $(node --version)"

# 2. Proje dizini oluştur
mkdir -p ~/gns-tesla-monitor
cd ~/gns-tesla-monitor

# 3. package.json
cat > package.json << 'PKGJSON'
{
  "name": "gns-tesla-monitor",
  "version": "3.0.0",
  "main": "monitor.js",
  "dependencies": {
    "playwright": "^1.52.0",
    "nodemailer": "^6.9.0"
  }
}
PKGJSON

# 4. .env dosyası
cat > .env << 'ENVFILE'
TELEGRAM_BOT_TOKEN=8743865715:AAFy2V37mhmN4xZCJVUtwJtVH6VRgMvEFTQ
TELEGRAM_CHAT_IDS=7733290289,8793825386
CHECK_INTERVAL=45
ENVFILE

# 5. Ana monitor scripti
cat > monitor.js << 'MONITORJS'
const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');
const path = require('path');

// .env dosyasını oku
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split('\n').forEach(line => {
    const [key, ...val] = line.split('=');
    if (key && val.length) process.env[key.trim()] = val.join('=').trim();
  });
}

const MONITORS = [
  {
    id: 'demo',
    label: 'DEMO',
    url: 'https://www.tesla.com/en_NZ/inventory/new/my?IsDemo=true&arrangeby=plh&zip=&range=0',
    alertTitle: '🚨 TESLA NZ - DEMO MODEL Y BULUNDU! 🚨',
    filterDemo: null,
  },
  {
    id: 'inventory',
    label: 'INVENTORY',
    url: 'https://www.tesla.com/en_NZ/inventory/new/my?arrangeby=plh&zip=&range=0',
    alertTitle: '🟢 TESLA NZ - YENİ MODEL Y INVENTORY! 🟢',
    filterDemo: false,
  },
];

const CONFIG = {
  checkInterval: parseInt(process.env.CHECK_INTERVAL || '45') * 1000,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatIds: (process.env.TELEGRAM_CHAT_IDS || '').split(',').filter(Boolean),
  stateFile: path.join(__dirname, 'state.json'),
};

// ─── State ───
function loadState() {
  try { return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8')); } catch { return {}; }
}
function saveState(state) {
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}
function getMonitorState(state, id) {
  if (!state[id]) state[id] = { notifiedVINs: [], lastCheck: null, lastFound: null };
  return state[id];
}

// ─── Telegram ───
function sendTelegramToOne(chatId, message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: false });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegramToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => res.statusCode === 200 ? resolve() : reject(new Error(data)));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
async function sendTelegram(message) {
  if (!CONFIG.telegramToken || CONFIG.telegramChatIds.length === 0) return;
  await Promise.all(CONFIG.telegramChatIds.map(id => sendTelegramToOne(id, message)));
}

// ─── Tesla Kontrol ───
async function checkTeslaInventory(browser, monitor) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
    geolocation: { latitude: -36.8485, longitude: 174.7633 },
    permissions: ['geolocation'],
  });

  const page = await context.newPage();
  let vehicles = [];

  try {
    console.log(`[${monitor.label}] Kontrol ediliyor...`);

    let apiData = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('inventory/api') || url.includes('inventory-results')) {
        try {
          const json = await response.json();
          if (json.results) apiData = json;
        } catch {}
      }
    });

    await page.goto(monitor.url, { waitUntil: 'networkidle', timeout: 30000 });

    // Lokasyon popup - Auckland seç
    try {
      const locationInput = await page.$('input[type="text"], input[placeholder*="location"], input[placeholder*="zip"], input[placeholder*="city"]');
      if (locationInput) {
        await locationInput.fill('Auckland');
        await page.waitForTimeout(1000);
        const suggestion = await page.$('[class*="suggestion"]:has-text("Auckland"), [role="option"]:has-text("Auckland"), li:has-text("Auckland")');
        if (suggestion) { await suggestion.click(); await page.waitForTimeout(500); }
      }
      const confirmBtn = await page.$('button:has-text("Continue"), button:has-text("Confirm"), button:has-text("Submit"), button:has-text("OK")');
      if (confirmBtn) { await confirmBtn.click(); await page.waitForTimeout(3000); }
    } catch {}

    await page.waitForTimeout(3000);

    // Access denied kontrolü
    const pageText = await page.textContent('body');
    if (pageText && pageText.includes('Access Denied')) {
      console.error(`[${monitor.label}] Engellendi!`);
      await context.close();
      return [];
    }

    if (apiData && apiData.results && apiData.results.length > 0) {
      let results = apiData.results;
      if (monitor.filterDemo === false) results = results.filter(v => !v.IsDemo);

      vehicles = results.map(v => ({
        vin: v.VIN,
        model: v.TrimName || 'Model Y',
        price: v.PurchasePrice || v.Price || v.TotalPrice,
        currency: v.CurrencyCode || 'NZD',
        odometer: v.Odometer,
        odometerType: v.OdometerType || 'kms',
        color: extractOpt(v, 'PAINT'),
        interior: extractOpt(v, 'INTERIOR'),
        year: v.Year,
        isDemo: v.IsDemo,
        city: v.City,
      }));
    } else if (pageText && !pageText.includes('no results') && !pageText.includes('No vehicles match') && !pageText.includes('check back later') && !pageText.includes('currently no matching')) {
      const cards = await page.$$('[data-id], .result-card, .inventory-card, [class*="result"], [class*="inventory-list"] > div');
      for (const card of cards) {
        const text = await card.textContent();
        if (text && (text.includes('Model Y') || text.includes('MY'))) {
          const priceMatch = text.match(/\$[\d,]+/);
          vehicles.push({ vin: 'UNKNOWN', model: `Model Y (${monitor.label})`, price: priceMatch ? priceMatch[0] : 'N/A', currency: 'NZD' });
        }
      }
    }

    console.log(`[${monitor.label}] Araç: ${vehicles.length}`);
    return vehicles;
  } catch (error) {
    console.error(`[${monitor.label}] Hata:`, error.message);
    return [];
  } finally {
    await context.close();
  }
}

function extractOpt(v, group) {
  if (v.OptionCodeData) { const o = v.OptionCodeData.find(x => x.group === group); if (o) return o.long_name || o.name || o.code; }
  if (v[group] && v[group].length > 0) return v[group][0];
  return null;
}

// ─── Bildirim ───
async function notifyVehicles(vehicles, monitor) {
  let msg = `${monitor.alertTitle}\n\n`;
  for (const v of vehicles) {
    msg += `🚗 <b>${v.model}</b>\n`;
    if (v.year) msg += `📅 Yıl: ${v.year}\n`;
    if (v.price) msg += `💰 Fiyat: $${typeof v.price === 'number' ? v.price.toLocaleString() : v.price} ${v.currency || ''}\n`;
    if (v.odometer) msg += `📏 KM: ${v.odometer.toLocaleString()} ${v.odometerType}\n`;
    if (v.color) msg += `🎨 Renk: ${v.color}\n`;
    if (v.interior) msg += `🪑 İç: ${v.interior}\n`;
    if (v.city) msg += `📍 Konum: ${v.city}\n`;
    if (v.vin && v.vin !== 'UNKNOWN') msg += `🔑 VIN: ${v.vin}\n`;
    msg += '\n';
  }
  msg += `🔗 <a href="${monitor.url}">HEMEN GİT → Tesla NZ</a>\n\n`;
  msg += `⏰ ${new Date().toLocaleString('tr-TR', { timeZone: 'Pacific/Auckland' })} (NZ)`;
  await sendTelegram(msg);
}

// ─── Ana Döngü ───
async function main() {
  console.log('════════════════════════════════════════════');
  console.log('  GNS Tesla Monitor v3.0 (Mac Mini)');
  console.log('  Tesla NZ Demo + Inventory Takip Botu');
  console.log('════════════════════════════════════════════');
  console.log(`  Kontrol aralığı: ${CONFIG.checkInterval / 1000}s`);
  console.log(`  Telegram: ${CONFIG.telegramToken ? 'Aktif' : 'Pasif'}`);
  console.log('════════════════════════════════════════════\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  // Başarılı başlangıç bildirimi
  await sendTelegram('✅ <b>GNS Tesla Monitor başlatıldı!</b>\n\nMac Mini üzerinden 45 saniyede bir Tesla NZ kontrol ediliyor.\n\n📍 Demo + Inventory takibi aktif.');

  const state = loadState();
  let consecutiveErrors = 0;

  async function checkAll() {
    for (const monitor of MONITORS) {
      try {
        const vehicles = await checkTeslaInventory(browser, monitor);
        consecutiveErrors = 0;
        const mState = getMonitorState(state, monitor.id);
        mState.lastCheck = new Date().toISOString();

        if (vehicles.length > 0) {
          const newVehicles = vehicles.filter(v => !mState.notifiedVINs.includes(v.vin));
          if (newVehicles.length > 0) {
            console.log(`[${monitor.label}] ${newVehicles.length} YENİ araç! Bildirim gönderiliyor...`);
            await notifyVehicles(newVehicles, monitor);
            for (const v of newVehicles) {
              if (v.vin && !mState.notifiedVINs.includes(v.vin)) mState.notifiedVINs.push(v.vin);
            }
            mState.lastFound = new Date().toISOString();
          } else {
            console.log(`[${monitor.label}] ${vehicles.length} araç var ama zaten bildirildi`);
          }
        } else {
          console.log(`[${monitor.label}] Araç yok`);
          mState.notifiedVINs = [];
        }
      } catch (error) {
        consecutiveErrors++;
        console.error(`[${monitor.label}] Hata (${consecutiveErrors}x):`, error.message);
      }
    }
    saveState(state);
    if (consecutiveErrors >= 10) {
      console.log('[RESTART] Çok fazla hata, yeniden başlatılıyor...');
      try { await browser.close(); } catch {}
      process.exit(1);
    }
  }

  await checkAll();
  setInterval(checkAll, CONFIG.checkInterval);

  process.on('SIGTERM', async () => { await browser.close(); process.exit(0); });
  process.on('SIGINT', async () => { await browser.close(); process.exit(0); });
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
MONITORJS

# 6. npm install
echo "📦 Paketler kuruluyor..."
npm install

# 7. Playwright browser indir
echo "🌐 Chrome indiriliyor..."
npx playwright install chromium

# 8. LaunchAgent oluştur (Mac açılınca otomatik başlar)
PLIST_PATH="$HOME/Library/LaunchAgents/com.gns.tesla-monitor.plist"
cat > "$PLIST_PATH" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.gns.tesla-monitor</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>$HOME/gns-tesla-monitor/monitor.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$HOME/gns-tesla-monitor</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/gns-tesla-monitor/monitor.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/gns-tesla-monitor/monitor-error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
PLIST

# 9. LaunchAgent başlat
launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "════════════════════════════════════════════"
echo "  ✅ KURULUM TAMAMLANDI!"
echo "════════════════════════════════════════════"
echo ""
echo "  Bot şu anda çalışıyor!"
echo "  Mac yeniden başlasa bile otomatik açılır."
echo ""
echo "  📋 Logları görmek için:"
echo "     tail -f ~/gns-tesla-monitor/monitor.log"
echo ""
echo "  🛑 Durdurmak için:"
echo "     launchctl unload ~/Library/LaunchAgents/com.gns.tesla-monitor.plist"
echo ""
echo "  ▶️ Tekrar başlatmak için:"
echo "     launchctl load ~/Library/LaunchAgents/com.gns.tesla-monitor.plist"
echo ""
