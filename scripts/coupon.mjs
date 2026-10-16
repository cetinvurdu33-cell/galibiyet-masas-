// Günün kuponunu, sayfadaki modelin aynısıyla hazırlar ve web/data.json içine yazar.
// update-data.mjs yeni oran çektiğinde (needCoupon) çalışır. Sayfayı başsız bir tarayıcıda açar,
// window.GM.buildCoupon() ile seçimleri alır; böylece kupon, sayfada görünen tahminlerle birebir aynı olur.
// Gerekli: playwright paketi ve Chromium (iş akışı kurar).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const OUT = join(WEB, "data.json");
const data = JSON.parse(readFileSync(OUT, "utf8"));

if (!data.needCoupon) { console.log("Yeni oran yok, kupon değişmedi."); process.exit(0); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(req.url.split("?")[0])).replace(/^(\.\.[/\\])+/, "");
  const file = join(WEB, path === "/" ? "index.html" : path);
  if (!file.startsWith(WEB) || !existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(0, "127.0.0.1");
await new Promise(r => server.on("listening", r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

let coupon = null, browser = null;
try {
  // playwright, iş akışında ayrı bir klasöre (PW_DIR) kurulur
  const require = createRequire(process.env.PW_DIR ? join(process.env.PW_DIR, "index.js") : import.meta.url);
  const { chromium } = require("playwright");
  browser = await chromium.launch();
  const page = await browser.newPage();
  // Dış kaynaklar (yazı tipleri) beklenmesin
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => window.GM && window.GM.ready, null, { timeout: 30000 });
  coupon = await page.evaluate(() => window.GM.buildCoupon(Date.now()));
} catch (e) {
  console.error("Kupon hazırlanamadı: " + e.message);
} finally {
  if (browser) await browser.close().catch(() => {});
}
server.close();

delete data.needCoupon;
if (coupon) {
  const hist = (data.couponHistory || []).filter(c => c.date !== coupon.date);
  hist.unshift(coupon);
  data.couponHistory = hist.slice(0, 60);
  console.log(`✓ Kupon (${coupon.date}): ${coupon.items.length} seçim, toplam oran ${coupon.totalOdds ?? "-"}`);
  if (process.env.GITHUB_ACTIONS) {
    const txt = coupon.items.map(i => `${i.h}-${i.a}: ${i.mk === "OU" ? (i.side === "O" ? "2,5 Üst" : "2,5 Alt") : i.side === "1" ? i.h : i.a} @${i.odds} (%${Math.round(i.p * 100)})`).join(" | ");
    console.log(`::notice title=Günün kuponu (${coupon.items.length})::${txt || "Kriterlere uyan maç yok"}`);
  }
}
writeFileSync(OUT, JSON.stringify(data));
process.exit(0);
