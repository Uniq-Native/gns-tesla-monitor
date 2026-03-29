const MONITORS = [
  {
    id: 'demo',
    label: 'DEMO',
    queryParams: '{"query":{"model":"my","condition":"new","options":{"IsDemo":true},"arrangeby":"plh","order":"asc","market":"NZ","language":"en","super_region":"north america","lng":174.7633,"lat":-36.8485,"zip":"","range":0},"offset":0,"count":50,"outsideOffset":0,"outsideSearch":false}',
    pageUrl: 'https://www.tesla.com/en_NZ/inventory/new/my?IsDemo=true&arrangeby=plh&zip=&range=0',
    alertTitle: '🚨 TESLA NZ - DEMO MODEL Y BULUNDU! 🚨',
    filterDemo: null,
  },
  {
    id: 'inventory',
    label: 'INVENTORY',
    queryParams: '{"query":{"model":"my","condition":"new","options":{},"arrangeby":"plh","order":"asc","market":"NZ","language":"en","super_region":"north america","lng":174.7633,"lat":-36.8485,"zip":"","range":0},"offset":0,"count":50,"outsideOffset":0,"outsideSearch":false}',
    pageUrl: 'https://www.tesla.com/en_NZ/inventory/new/my?arrangeby=plh&zip=&range=0',
    alertTitle: '🟢 TESLA NZ - YENİ MODEL Y INVENTORY! 🟢',
    filterDemo: false,
  },
];

const TESLA_API = 'https://www.tesla.com/inventory/api/v4/inventory-results';

// ─── Tesla API ───
async function checkTeslaInventory(monitor) {
  const url = `${TESLA_API}?query=${encodeURIComponent(monitor.queryParams)}`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-NZ,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.tesla.com/en_NZ/inventory/new/my',
      'Origin': 'https://www.tesla.com',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
    },
  });

  if (!response.ok) {
    console.log(`[${monitor.label}] HTTP ${response.status}: ${response.statusText}`);
    return [];
  }

  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    return [];
  }

  let results = data.results;

  // Inventory monitörü: demo araçları filtrele
  if (monitor.filterDemo === false) {
    results = results.filter(v => !v.IsDemo);
  }

  return results.map(v => ({
    vin: v.VIN,
    model: v.TrimName || `Model Y`,
    price: v.PurchasePrice || v.Price || v.TotalPrice,
    currency: v.CurrencyCode || 'NZD',
    odometer: v.Odometer,
    odometerType: v.OdometerType || 'kms',
    color: extractOptionName(v, 'PAINT'),
    interior: extractOptionName(v, 'INTERIOR'),
    year: v.Year,
    isDemo: v.IsDemo,
    city: v.City,
  }));
}

function extractOptionName(vehicle, group) {
  if (vehicle.OptionCodeData) {
    const opt = vehicle.OptionCodeData.find(o => o.group === group);
    if (opt) return opt.long_name || opt.name || opt.code;
  }
  if (vehicle[group] && vehicle[group].length > 0) {
    return vehicle[group][0];
  }
  return null;
}

// ─── Telegram ───
async function sendTelegram(token, chatIds, message) {
  const ids = chatIds.split(',');
  await Promise.all(ids.map(chatId =>
    fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    })
  ));
}

// ─── Bildirim oluştur ───
function buildMessage(vehicles, monitor) {
  let msg = `${monitor.alertTitle}\n\n`;

  for (const v of vehicles) {
    msg += `🚗 <b>${v.model}</b>\n`;
    if (v.year) msg += `📅 Yıl: ${v.year}\n`;
    if (v.price) msg += `💰 Fiyat: $${typeof v.price === 'number' ? v.price.toLocaleString() : v.price} ${v.currency || ''}\n`;
    if (v.odometer) msg += `📏 KM: ${v.odometer.toLocaleString()} ${v.odometerType}\n`;
    if (v.color) msg += `🎨 Renk: ${v.color}\n`;
    if (v.interior) msg += `🪑 İç: ${v.interior}\n`;
    if (v.city) msg += `📍 Konum: ${v.city}\n`;
    if (v.vin) msg += `🔑 VIN: ${v.vin}\n`;
    msg += '\n';
  }

  msg += `🔗 <a href="${monitor.pageUrl}">HEMEN GİT → Tesla NZ</a>\n\n`;

  const now = new Date().toLocaleString('tr-TR', { timeZone: 'Pacific/Auckland' });
  msg += `⏰ ${now} (NZ)`;

  return msg;
}

// ─── Ana handler ───
export default {
  // Cron trigger - her dakika çalışır
  async scheduled(event, env, ctx) {
    console.log('GNS Tesla Monitor - kontrol başlıyor...');

    for (const monitor of MONITORS) {
      try {
        const vehicles = await checkTeslaInventory(monitor);
        console.log(`[${monitor.label}] Bulunan araç: ${vehicles.length}`);

        if (vehicles.length > 0) {
          // Daha önce bildirilen VIN'leri kontrol et
          const stateKey = `notified_${monitor.id}`;
          const notifiedRaw = await env.STATE.get(stateKey);
          const notified = notifiedRaw ? JSON.parse(notifiedRaw) : [];

          const newVehicles = vehicles.filter(v => !notified.includes(v.vin));

          if (newVehicles.length > 0) {
            console.log(`[${monitor.label}] ${newVehicles.length} YENİ araç! Bildirim gönderiliyor...`);

            const message = buildMessage(newVehicles, monitor);
            await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_IDS, message);

            // Bildirilen VIN'leri kaydet (24 saat TTL)
            const allNotified = [...notified, ...newVehicles.map(v => v.vin)];
            await env.STATE.put(stateKey, JSON.stringify(allNotified), { expirationTtl: 86400 });
          } else {
            console.log(`[${monitor.label}] Araçlar zaten bildirildi`);
          }
        } else {
          // Araç yoksa notified listesini temizle
          await env.STATE.delete(`notified_${monitor.id}`);
          console.log(`[${monitor.label}] Araç yok`);
        }
      } catch (error) {
        console.error(`[${monitor.label}] Hata:`, error.message);
      }
    }
  },

  // HTTP handler - test ve status için
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      const results = {};
      for (const monitor of MONITORS) {
        try {
          const vehicles = await checkTeslaInventory(monitor);
          results[monitor.id] = { count: vehicles.length, vehicles };
        } catch (error) {
          results[monitor.id] = { error: error.message };
        }
      }
      return new Response(JSON.stringify(results, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/test') {
      const testMsg = '✅ <b>GNS Tesla Monitor - Worker Test</b>\n\nCloudflare Worker aktif ve çalışıyor!';
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_IDS, testMsg);
      return new Response('Test bildirimi gönderildi!');
    }

    return new Response('GNS Tesla Monitor v3.0 - Cloudflare Worker\n\n/status - Tesla NZ kontrol\n/test - Test bildirimi gönder');
  },
};
