var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.js
var MONITORS = [
  {
    id: "demo",
    label: "DEMO",
    queryParams: '{"query":{"model":"my","condition":"new","options":{"IsDemo":true},"arrangeby":"plh","order":"asc","market":"NZ","language":"en","super_region":"north america","lng":174.7633,"lat":-36.8485,"zip":"","range":0},"offset":0,"count":50,"outsideOffset":0,"outsideSearch":false}',
    pageUrl: "https://www.tesla.com/en_NZ/inventory/new/my?IsDemo=true&arrangeby=plh&zip=&range=0",
    alertTitle: "\u{1F6A8} TESLA NZ - DEMO MODEL Y BULUNDU! \u{1F6A8}",
    filterDemo: null
  },
  {
    id: "inventory",
    label: "INVENTORY",
    queryParams: '{"query":{"model":"my","condition":"new","options":{},"arrangeby":"plh","order":"asc","market":"NZ","language":"en","super_region":"north america","lng":174.7633,"lat":-36.8485,"zip":"","range":0},"offset":0,"count":50,"outsideOffset":0,"outsideSearch":false}',
    pageUrl: "https://www.tesla.com/en_NZ/inventory/new/my?arrangeby=plh&zip=&range=0",
    alertTitle: "\u{1F7E2} TESLA NZ - YEN\u0130 MODEL Y INVENTORY! \u{1F7E2}",
    filterDemo: false
  }
];
var TESLA_API = "https://www.tesla.com/inventory/api/v4/inventory-results";
async function checkTeslaInventory(monitor) {
  const url = `${TESLA_API}?query=${encodeURIComponent(monitor.queryParams)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "en-NZ,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Referer": "https://www.tesla.com/en_NZ/inventory/new/my",
      "Origin": "https://www.tesla.com",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"'
    }
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
  if (monitor.filterDemo === false) {
    results = results.filter((v) => !v.IsDemo);
  }
  return results.map((v) => ({
    vin: v.VIN,
    model: v.TrimName || `Model Y`,
    price: v.PurchasePrice || v.Price || v.TotalPrice,
    currency: v.CurrencyCode || "NZD",
    odometer: v.Odometer,
    odometerType: v.OdometerType || "kms",
    color: extractOptionName(v, "PAINT"),
    interior: extractOptionName(v, "INTERIOR"),
    year: v.Year,
    isDemo: v.IsDemo,
    city: v.City
  }));
}
__name(checkTeslaInventory, "checkTeslaInventory");
function extractOptionName(vehicle, group) {
  if (vehicle.OptionCodeData) {
    const opt = vehicle.OptionCodeData.find((o) => o.group === group);
    if (opt) return opt.long_name || opt.name || opt.code;
  }
  if (vehicle[group] && vehicle[group].length > 0) {
    return vehicle[group][0];
  }
  return null;
}
__name(extractOptionName, "extractOptionName");
async function sendTelegram(token, chatIds, message) {
  const ids = chatIds.split(",");
  await Promise.all(ids.map(
    (chatId) => fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: false
      })
    })
  ));
}
__name(sendTelegram, "sendTelegram");
function buildMessage(vehicles, monitor) {
  let msg = `${monitor.alertTitle}

`;
  for (const v of vehicles) {
    msg += `\u{1F697} <b>${v.model}</b>
`;
    if (v.year) msg += `\u{1F4C5} Y\u0131l: ${v.year}
`;
    if (v.price) msg += `\u{1F4B0} Fiyat: $${typeof v.price === "number" ? v.price.toLocaleString() : v.price} ${v.currency || ""}
`;
    if (v.odometer) msg += `\u{1F4CF} KM: ${v.odometer.toLocaleString()} ${v.odometerType}
`;
    if (v.color) msg += `\u{1F3A8} Renk: ${v.color}
`;
    if (v.interior) msg += `\u{1FA91} \u0130\xE7: ${v.interior}
`;
    if (v.city) msg += `\u{1F4CD} Konum: ${v.city}
`;
    if (v.vin) msg += `\u{1F511} VIN: ${v.vin}
`;
    msg += "\n";
  }
  msg += `\u{1F517} <a href="${monitor.pageUrl}">HEMEN G\u0130T \u2192 Tesla NZ</a>

`;
  const now = (/* @__PURE__ */ new Date()).toLocaleString("tr-TR", { timeZone: "Pacific/Auckland" });
  msg += `\u23F0 ${now} (NZ)`;
  return msg;
}
__name(buildMessage, "buildMessage");
var worker_default = {
  // Cron trigger - her dakika çalışır
  async scheduled(event, env, ctx) {
    console.log("GNS Tesla Monitor - kontrol ba\u015Fl\u0131yor...");
    for (const monitor of MONITORS) {
      try {
        const vehicles = await checkTeslaInventory(monitor);
        console.log(`[${monitor.label}] Bulunan ara\xE7: ${vehicles.length}`);
        if (vehicles.length > 0) {
          const stateKey = `notified_${monitor.id}`;
          const notifiedRaw = await env.STATE.get(stateKey);
          const notified = notifiedRaw ? JSON.parse(notifiedRaw) : [];
          const newVehicles = vehicles.filter((v) => !notified.includes(v.vin));
          if (newVehicles.length > 0) {
            console.log(`[${monitor.label}] ${newVehicles.length} YEN\u0130 ara\xE7! Bildirim g\xF6nderiliyor...`);
            const message = buildMessage(newVehicles, monitor);
            await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_IDS, message);
            const allNotified = [...notified, ...newVehicles.map((v) => v.vin)];
            await env.STATE.put(stateKey, JSON.stringify(allNotified), { expirationTtl: 86400 });
          } else {
            console.log(`[${monitor.label}] Ara\xE7lar zaten bildirildi`);
          }
        } else {
          await env.STATE.delete(`notified_${monitor.id}`);
          console.log(`[${monitor.label}] Ara\xE7 yok`);
        }
      } catch (error) {
        console.error(`[${monitor.label}] Hata:`, error.message);
      }
    }
  },
  // HTTP handler - test ve status için
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/status") {
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
        headers: { "Content-Type": "application/json" }
      });
    }
    if (url.pathname === "/test") {
      const testMsg = "\u2705 <b>GNS Tesla Monitor - Worker Test</b>\n\nCloudflare Worker aktif ve \xE7al\u0131\u015F\u0131yor!";
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_IDS, testMsg);
      return new Response("Test bildirimi g\xF6nderildi!");
    }
    return new Response("GNS Tesla Monitor v3.0 - Cloudflare Worker\n\n/status - Tesla NZ kontrol\n/test - Test bildirimi g\xF6nder");
  }
};

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-scheduled.ts
var scheduled = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  const url = new URL(request.url);
  if (url.pathname === "/__scheduled") {
    const cron = url.searchParams.get("cron") ?? "";
    await middlewareCtx.dispatch("scheduled", { cron });
    return new Response("Ran scheduled event");
  }
  const resp = await middlewareCtx.next(request, env);
  if (request.headers.get("referer")?.endsWith("/__scheduled") && url.pathname === "/favicon.ico" && resp.status === 500) {
    return new Response(null, { status: 404 });
  }
  return resp;
}, "scheduled");
var middleware_scheduled_default = scheduled;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-MBtzkZ/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_scheduled_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../../../../opt/homebrew/lib/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-MBtzkZ/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
