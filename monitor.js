const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const https = require('https');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// ─── Config ───
const MONITORS = [
  {
    id: 'demo',
    label: 'DEMO',
    url: 'https://www.tesla.com/en_NZ/inventory/new/my?IsDemo=true&arrangeby=plh&zip=&range=0',
    alertTitle: '🚨 TESLA NZ - DEMO MODEL Y BULUNDU! 🚨',
    emailSubject: '🚨 Tesla NZ — Demo Model Y Listelendi!',
    filterDemo: null, // hepsini al
  },
  {
    id: 'inventory',
    label: 'INVENTORY',
    url: 'https://www.tesla.com/en_NZ/inventory/new/my?arrangeby=plh&zip=&range=0',
    alertTitle: '🟢 TESLA NZ - YENİ MODEL Y INVENTORY! 🟢',
    emailSubject: '🟢 Tesla NZ — Yeni Model Y Inventory!',
    filterDemo: false, // demo olmayanları al
  },
];

const CONFIG = {
  checkInterval: parseInt(process.env.CHECK_INTERVAL || '45') * 1000,
  telegramToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatIds: (process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_ID || '').split(',').filter(Boolean),
  emailTo: process.env.EMAIL_TO || 'ghaksever@gmail.com',
  emailFrom: process.env.EMAIL_FROM,
  emailPassword: process.env.EMAIL_PASSWORD,
  stateFile: process.env.STATE_DIR ? path.join(process.env.STATE_DIR, 'state.json') : path.join(__dirname, 'state.json'),
};

const isTestMode = process.argv.includes('--test');
const START_TIME = Date.now();
let monitorStats = {};

// ─── Telegram Commands ───
let lastUpdateId = 0;

async function pollTelegramCommands() {
  if (!CONFIG.telegramToken) return;

  try {
    const data = await httpGet(`https://api.telegram.org/bot${CONFIG.telegramToken}/getUpdates?offset=${lastUpdateId + 1}&timeout=1&allowed_updates=["message"]`);
    const json = JSON.parse(data);

    if (json.ok && json.result.length > 0) {
      for (const update of json.result) {
        lastUpdateId = update.update_id;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const chatId = msg.chat.id.toString();
        if (!CONFIG.telegramChatIds.includes(chatId)) continue;

        if (msg.text === '/status') {
          await sendStatusResponse(chatId);
        }
      }
    }
  } catch (err) {
    // Sessizce geç — polling hatası kritik değil
  }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function sendStatusResponse(chatId) {
  const uptime = formatDuration(Date.now() - START_TIME);
  const now = new Date().toLocaleString('tr-TR', { timeZone: 'Pacific/Auckland' });

  let text = `📊 <b>GNS Tesla Monitor — Durum</b>\n\n`;
  text += `✅ Bot çalışıyor\n`;
  text += `⏱ Uptime: ${uptime}\n`;
  text += `🔄 Kontrol aralığı: ${CONFIG.checkInterval / 1000}s\n\n`;

  for (const monitor of MONITORS) {
    const stats = monitorStats[monitor.id] || {};
    text += `<b>[${monitor.label}]</b>\n`;
    text += `  Son kontrol: ${stats.lastCheck ? timeAgo(stats.lastCheck) : 'henüz yok'}\n`;
    text += `  Son bulunan: ${stats.lastFound ? timeAgo(stats.lastFound) : 'henüz yok'}\n`;
    text += `  Toplam bildirim: ${stats.notifyCount || 0}\n`;
    text += `  Hatalar: ${stats.errorCount || 0}\n\n`;
  }

  text += `⏰ ${now} (NZ)`;

  await sendTelegramToOne(chatId, text);
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}g ${h}s ${m}dk`;
  if (h > 0) return `${h}s ${m}dk`;
  return `${m}dk`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'az önce';
  if (m < 60) return `${m}dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}s ${m % 60}dk önce`;
  return `${Math.floor(h / 24)}g önce`;
}

// ─── State ───
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
}

function getMonitorState(state, monitorId) {
  if (!state[monitorId]) {
    state[monitorId] = { notifiedVINs: [], lastCheck: null, lastFound: null };
  }
  return state[monitorId];
}

// ─── Telegram ───
function sendTelegramToOne(chatId, message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });

    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${CONFIG.telegramToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log(`[TELEGRAM] Bildirim gönderildi → ${chatId}`);
          resolve();
        } else {
          console.error(`[TELEGRAM] Hata (${chatId}):`, data);
          reject(new Error(data));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendTelegram(message) {
  if (!CONFIG.telegramToken || CONFIG.telegramChatIds.length === 0) {
    console.log('[TELEGRAM] Token veya Chat ID eksik, atlanıyor');
    return;
  }

  await Promise.all(CONFIG.telegramChatIds.map(id => sendTelegramToOne(id, message)));
}

// ─── Email ───
async function sendEmail(subject, htmlBody) {
  if (!CONFIG.emailFrom || !CONFIG.emailPassword) {
    console.log('[EMAIL] Email ayarları eksik, atlanıyor');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: CONFIG.emailFrom, pass: CONFIG.emailPassword },
  });

  await transporter.sendMail({
    from: CONFIG.emailFrom,
    to: CONFIG.emailTo,
    subject,
    html: htmlBody,
  });

  console.log('[EMAIL] Email gönderildi!');
}

// ─── Tesla Sayfası Kontrol ───
async function checkTeslaInventory(browser, monitor) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-NZ',
    timezoneId: 'Pacific/Auckland',
    geolocation: { latitude: -36.8485, longitude: 174.7633 },
    permissions: ['geolocation'],
    extraHTTPHeaders: {
      'Accept-Language': 'en-NZ,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
  });

  const page = await context.newPage();
  let vehicles = [];

  try {
    console.log(`[${monitor.label}] Tesla NZ kontrol ediliyor...`);

    // Önce Tesla ana sayfasına git - cookie al
    await page.goto('https://www.tesla.com/en_NZ', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(2000);

    // API response'unu yakala
    let apiData = null;
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('inventory/api') || url.includes('inventory-results')) {
        try {
          const json = await response.json();
          if (json.results) {
            apiData = json;
          }
        } catch {}
      }
    });

    // Inventory sayfasına git
    await page.goto(monitor.url, { waitUntil: 'networkidle', timeout: 30000 });

    // Access denied kontrolü
    const pageText = await page.textContent('body');
    if (pageText && pageText.includes('Access Denied')) {
      console.error(`[${monitor.label}] Akamai tarafından engellendi!`);
      await context.close();
      return [];
    }

    // Lokasyon popup - Auckland seç ve continue
    try {
      // Input alanına Auckland yaz
      const locationInput = await page.$('input[type="text"], input[placeholder*="location"], input[placeholder*="zip"], input[placeholder*="city"], input[name*="location"], input[name*="zip"]');
      if (locationInput) {
        await locationInput.fill('Auckland');
        await page.waitForTimeout(1000);
        // Dropdown'dan Auckland seç
        const suggestion = await page.$('[class*="suggestion"]:has-text("Auckland"), [class*="dropdown"] >> text=Auckland, [role="option"]:has-text("Auckland"), li:has-text("Auckland")');
        if (suggestion) {
          await suggestion.click();
          await page.waitForTimeout(500);
        }
      }

      // Continue/Confirm butonuna bas
      const confirmBtn = await page.$('button:has-text("Continue"), button:has-text("Confirm"), button:has-text("Submit"), button:has-text("OK"), [data-testid="confirm-button"], button[type="submit"]');
      if (confirmBtn) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }
    } catch {}

    // API response gelmesi için bekle
    await page.waitForTimeout(3000);

    // API'den veri geldiyse kullan
    if (apiData && apiData.results && apiData.results.length > 0) {
      let results = apiData.results;

      // Demo filtresi: inventory monitörü demo araçları çıkarır
      if (monitor.filterDemo === false) {
        results = results.filter(v => !v.IsDemo);
      }

      vehicles = results.map(v => ({
        vin: v.VIN,
        model: v.TrimName || `Model Y ${v.Model}`,
        price: v.PurchasePrice || v.Price || v.TotalPrice,
        currency: v.CurrencyCode || 'NZD',
        odometer: v.Odometer,
        odometerType: v.OdometerType || 'kms',
        color: extractOptionName(v, 'PAINT'),
        interior: extractOptionName(v, 'INTERIOR'),
        wheels: extractOptionName(v, 'WHEELS'),
        year: v.Year,
        isDemo: v.IsDemo,
        city: v.City,
      }));
    } else {
      // Fallback: sayfa içeriğinden kontrol
      const pageText = await page.textContent('body');

      if (pageText && !pageText.includes('no results') &&
          !pageText.includes('No vehicles match') &&
          !pageText.includes('check back later') &&
          !pageText.includes('currently no matching')) {

        const cards = await page.$$('[data-id], .result-card, .inventory-card, [class*="result"], [class*="inventory-list"] > div');

        if (cards.length > 0) {
          for (const card of cards) {
            const text = await card.textContent();
            if (text && (text.includes('Model Y') || text.includes('MY'))) {
              const priceMatch = text.match(/\$[\d,]+/);
              vehicles.push({
                vin: 'UNKNOWN',
                model: `Model Y (${monitor.label})`,
                price: priceMatch ? priceMatch[0] : 'N/A',
                currency: 'NZD',
                rawText: text.substring(0, 200),
              });
            }
          }
        }
      }
    }

    console.log(`[${monitor.label}] Bulunan araç: ${vehicles.length}`);
    return vehicles;

  } catch (error) {
    console.error(`[${monitor.label}] Hata:`, error.message);
    return [];
  } finally {
    await context.close();
  }
}

function extractOptionName(vehicle, group) {
  if (vehicle.OptionCodeData) {
    const opt = vehicle.OptionCodeData.find(o => o.group === group);
    if (opt) return opt.long_name || opt.name || opt.code;
  }
  if (vehicle[group] && vehicle[group].length > 0) {
    return vehicle[group][0];
  }
  return 'N/A';
}

// ─── Bildirim ───
async function notifyVehicles(vehicles, monitor) {
  // Telegram mesajı
  let tgMessage = `${monitor.alertTitle}\n\n`;

  for (const v of vehicles) {
    tgMessage += `🚗 <b>${v.model}</b>\n`;
    if (v.year) tgMessage += `📅 Yıl: ${v.year}\n`;
    if (v.price) tgMessage += `💰 Fiyat: $${typeof v.price === 'number' ? v.price.toLocaleString() : v.price} ${v.currency || ''}\n`;
    if (v.odometer) tgMessage += `📏 KM: ${v.odometer.toLocaleString()} ${v.odometerType}\n`;
    if (v.color && v.color !== 'N/A') tgMessage += `🎨 Renk: ${v.color}\n`;
    if (v.interior && v.interior !== 'N/A') tgMessage += `🪑 İç: ${v.interior}\n`;
    if (v.city) tgMessage += `📍 Konum: ${v.city}\n`;
    if (v.vin && v.vin !== 'UNKNOWN') tgMessage += `🔑 VIN: ${v.vin}\n`;
    tgMessage += '\n';
  }

  tgMessage += `🔗 <a href="${monitor.url}">HEMEN GİT → Tesla NZ</a>\n\n`;
  tgMessage += `⏰ ${new Date().toLocaleString('tr-TR', { timeZone: 'Pacific/Auckland' })} (NZ)`;

  await sendTelegram(tgMessage);

  // Email (yedek)
  const emailHtml = `
    <h2 style="color:red;">${monitor.alertTitle}</h2>
    ${vehicles.map(v => `
      <div style="border:1px solid #ccc; padding:12px; margin:8px 0; border-radius:8px;">
        <h3>${v.model}${v.year ? ` (${v.year})` : ''}</h3>
        <p><strong>Fiyat:</strong> $${typeof v.price === 'number' ? v.price.toLocaleString() : v.price} ${v.currency || ''}</p>
        ${v.odometer ? `<p><strong>KM:</strong> ${v.odometer.toLocaleString()} ${v.odometerType}</p>` : ''}
        ${v.color && v.color !== 'N/A' ? `<p><strong>Renk:</strong> ${v.color}</p>` : ''}
        ${v.interior && v.interior !== 'N/A' ? `<p><strong>İç:</strong> ${v.interior}</p>` : ''}
        ${v.city ? `<p><strong>Konum:</strong> ${v.city}</p>` : ''}
        ${v.vin && v.vin !== 'UNKNOWN' ? `<p><strong>VIN:</strong> ${v.vin}</p>` : ''}
      </div>
    `).join('')}
    <p><a href="${monitor.url}" style="background:red;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;font-size:18px;">HEMEN GİT → Tesla NZ</a></p>
    <p style="color:#888;font-size:12px;">Bu email GNS Tesla Monitor tarafından otomatik gönderilmiştir.</p>
  `;

  await sendEmail(monitor.emailSubject, emailHtml);
}

// ─── Ana Döngü ───
async function main() {
  console.log('════════════════════════════════════════════');
  console.log('  GNS Tesla Monitor v3.1');
  console.log('  Tesla NZ Demo + Inventory Takip Botu');
  console.log('════════════════════════════════════════════');
  console.log(`  Kontrol aralığı: ${CONFIG.checkInterval / 1000}s`);
  console.log(`  Monitörler: ${MONITORS.map(m => m.label).join(', ')}`);
  console.log(`  Telegram: ${CONFIG.telegramToken ? 'Aktif' : 'Pasif'}`);
  console.log(`  Email: ${CONFIG.emailFrom ? 'Aktif' : 'Pasif'}`);
  console.log('════════════════════════════════════════════\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const state = loadState();
  let consecutiveErrors = 0;

  async function checkAll() {
    for (const monitor of MONITORS) {
      try {
        const vehicles = await checkTeslaInventory(browser, monitor);
        consecutiveErrors = 0;

        const mState = getMonitorState(state, monitor.id);
        mState.lastCheck = new Date().toISOString();

        // Stats güncelle
        if (!monitorStats[monitor.id]) monitorStats[monitor.id] = { notifyCount: 0, errorCount: 0 };
        monitorStats[monitor.id].lastCheck = mState.lastCheck;

        if (vehicles.length > 0) {
          const newVehicles = vehicles.filter(v => !mState.notifiedVINs.includes(v.vin));

          if (newVehicles.length > 0 || isTestMode) {
            const toNotify = isTestMode ? vehicles : newVehicles;
            console.log(`[${monitor.label}] ${toNotify.length} yeni araç! Bildirim gönderiliyor...`);

            await notifyVehicles(toNotify, monitor);

            for (const v of toNotify) {
              if (v.vin && !mState.notifiedVINs.includes(v.vin)) {
                mState.notifiedVINs.push(v.vin);
              }
            }
            mState.lastFound = new Date().toISOString();
            monitorStats[monitor.id].lastFound = mState.lastFound;
            monitorStats[monitor.id].notifyCount += toNotify.length;

            if (isTestMode) {
              console.log('[TEST] Test modu - çıkılıyor');
              await browser.close();
              process.exit(0);
            }
          } else {
            console.log(`[${monitor.label}] ${vehicles.length} araç var ama hepsi daha önce bildirildi`);
          }
        } else {
          console.log(`[${monitor.label}] Araç yok. Sonraki kontrol: ${CONFIG.checkInterval / 1000}s`);
          mState.notifiedVINs = [];
        }

      } catch (error) {
        consecutiveErrors++;
        if (!monitorStats[monitor.id]) monitorStats[monitor.id] = { notifyCount: 0, errorCount: 0 };
        monitorStats[monitor.id].errorCount++;
        console.error(`[${monitor.label}] Kontrol hatası (${consecutiveErrors}x):`, error.message);
      }
    }

    saveState(state);

    if (consecutiveErrors >= 10) {
      console.log('[RESTART] Çok fazla hata, browser yeniden başlatılıyor...');
      try { await browser.close(); } catch {}
      process.exit(1);
    }
  }

  // İlk kontrol
  await checkAll();

  // Periyodik kontrol
  setInterval(checkAll, CONFIG.checkInterval);

  // Telegram komut dinleme (5 saniyede bir)
  setInterval(pollTelegramCommands, 5000);
  console.log('[TELEGRAM] /status komutu dinleniyor...');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('\n[SHUTDOWN] Kapatılıyor...');
    await browser.close();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    console.log('\n[SHUTDOWN] Kapatılıyor...');
    await browser.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[FATAL]', err);
  process.exit(1);
});
