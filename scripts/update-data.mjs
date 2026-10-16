// Galibiyet Masası: güncel verileri çekip web/data.json dosyasını üretir.
// GitHub Actions'ta zamanlanmış olarak çalışır.
//   FOOTBALL_DATA_TOKEN (gerekli): 6 ligin maçları, devre golleri, ev/deplasman golleri ve gol katkısı listesi
//   API_FOOTBALL_KEY (isteğe bağlı): sakat/cezalı oyuncular (7 lig + Şampiyonlar Ligi) ve Süper Lig maçları
// Anahtar yoksa ya da bir lig için veri alınamazsa eksik oyuncular scripts/absences-seed.json listesinden gelir.
// Yerel deneme için: FD_MOCK_DIR=klasör (PL.json, PL-scorers.json, AF-injuries-39.json ...) ile ağ kullanmadan çalışır.
//
// Çıktı biçimi, sayfadaki gömülü verilerle aynıdır:
//   table:    "Takım|G|B|M|AG|YG"
//   halves:   "Takım|1Y atılan|1Y yenen|2Y atılan|2Y yenen"
//   fixtures: "ISO tarih|Ev|Deplasman"

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PAGE = join(ROOT, "web", "index.html");
const OUT = join(ROOT, "web", "data.json");
const SEED = join(ROOT, "scripts", "absences-seed.json");
const SEASON = 2026; // API-Football sezon numarası (2026-27 sezonu)

// football-data.org ücretsiz paketindeki ligler → sayfadaki lig adı
const COMPETITIONS = {
  PL: "Premier League",
  PD: "La Liga",
  SA: "Serie A",
  BL1: "Bundesliga",
  FL1: "Ligue 1",
  CL: "Şampiyonlar Ligi",
};
const FIXTURE_DAYS = 10; // kaç gün sonrasına kadarki maçlar gösterilsin

// Sayfanın Türkçe adlandırdığı ya da otomatik eşleşmesi zor takımlar (API adı → sayfadaki ad)
const ALIASES = {
  "FC Bayern München": "Bayern Münih",
  "FC Internazionale Milano": "Inter",
  "Stade Rennais FC 1901": "Rennes",
  "Olympique Lyonnais": "Lyon",
  "Stade Brestois 29": "Brest",
  "Sporting Clube de Portugal": "Sporting CP",
  "SK Slavia Praha": "Slavia Prag",
  "FC Shakhtar Donetsk": "Şahtar Donetsk",
  "AEK Athens FC": "AEK Atina",
  "PAE AEK": "AEK Atina",
  "PSV": "PSV",
  "Brighton & Hove Albion FC": "Brighton",
  "Wolverhampton Wanderers FC": "Wolverhampton",
  "Athletic Club": "Athletic Bilbao",
  // Eksik oyuncu listelerindeki kısa adlar
  "Man City": "Manchester City",
  "Man United": "Manchester United",
  "Bayern Munich": "Bayern Münih",
  "Bayern München": "Bayern Münih",
  "Inter Milan": "Inter",
  "Inter": "Inter",
  "PSG": "Paris Saint-Germain",
  "B. M'gladbach": "Mönchengladbach",
  "Borussia Mönchengladbach": "Mönchengladbach",
  "Borussia Monchengladbach": "Mönchengladbach",
  // API-Football Süper Lig adları
  "Amed SFK": "Amedspor",
  "Amed Sportif Faaliyetler": "Amedspor",
  "Amedspor": "Amedspor",
  "Amed": "Amedspor",
  "Amed SK": "Amedspor",
  "Amed Sportif": "Amedspor",
  "BB Erzurumspor": "Erzurumspor",
  "Erzurum BB": "Erzurumspor",
  "Erzurumspor FK": "Erzurumspor",
  "Istanbul Basaksehir": "Başakşehir",
  "Corum FK": "Çorum FK",
  "Corum Belediyespor": "Çorum FK",
};

// API-Football lig numaraları
const AF_LEAGUES = {
  "Premier League": 39, "La Liga": 140, "Serie A": 135, "Bundesliga": 78,
  "Ligue 1": 61, "Şampiyonlar Ligi": 2, "Süper Lig": 203,
};

// ---------- Ad eşleştirme ----------

const NOISE = new Set(("fc cf afc ac acf as ss ssc sc us bc cfc club calcio de del osc sco aj es kv sk fk " +
  "ud sd ca rc rcd ogc fsv tsg sv cd pfc fsc").split(" "));
const tokens = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/ı/g, "i").replace(/[øØ]/g, "o").replace(/ß/g, "ss").replace(/ł/g, "l")
  .split(/[^a-z0-9]+/).filter(t => t && !NOISE.has(t) && !/^\d+$/.test(t));
const key = s => tokens(s).join(" ");
const cleanName = s => s.replace(/^(FC|AFC|AC|AS|SS|SSC|US|CF|SC|RC|RCD|CA|UD|SD|1\. ?FC|1\. ?FSV|TSG|SV|VfB|VfL|FK|SK) /, "")
  .replace(/ (FC|CF|AFC|SC|FK|SK|KV|Calcio|\d{2,4})$/g, "").replace(/ (FC|CF|\d{2,4})$/, "").trim();

/** Sayfadaki (geçmiş sezonlar dahil) takım adlarını lig lig çıkarır. */
function knownNames() {
  const html = readFileSync(PAGE, "utf8");
  const out = {};
  for (const block of ["LEAGUES", "HISTORY", "CUR_HALVES"]) {
    const start = html.indexOf(`const ${block} = {`);
    if (start < 0) continue;
    const body = html.slice(start, html.indexOf("\n};", start));
    for (const m of body.matchAll(/"([^"]+)":\s*`([\s\S]*?)`/g)) {
      const set = (out[m[1]] ??= new Set());
      m[2].trim().split("\n").forEach(r => r && set.add(r.split("|")[0]));
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
}

/** API takım listesini sayfadaki adlara eşler; eşleşmeyenler temizlenmiş API adıyla kalır. */
function buildNameMap(apiTeams, known) {
  const map = new Map(), claimed = new Set();
  const kTok = known.map(n => ({ n, k: key(n), t: new Set(tokens(n)) }));
  // 1) Elle tanımlı eşlemeler ve birebir aynı adlar
  for (const t of apiTeams) {
    const alias = ALIASES[t.name];
    const hit = alias ? kTok.find(x => x.n === alias) : kTok.find(x => x.k === key(t.name) || x.k === key(t.shortName || ""));
    if (alias && !hit) { map.set(t.id, alias); continue; }
    if (hit && !claimed.has(hit.n)) { map.set(t.id, hit.n); claimed.add(hit.n); }
  }
  // 2) Kelime kapsama (ör. "Real Racing Club de Santander" ⊇ "Racing Santander"); en benzer olan seçilir
  for (const t of apiTeams) {
    if (map.has(t.id)) continue;
    const a = new Set([...tokens(t.name), ...tokens(t.shortName || "")]);
    let best = null, bestScore = 0;
    for (const x of kTok) {
      if (claimed.has(x.n) || !x.t.size) continue;
      const inter = [...x.t].filter(w => a.has(w)).length;
      if (inter !== x.t.size && inter !== a.size) continue;
      const score = inter / new Set([...a, ...x.t]).size;
      if (score > bestScore) { best = x; bestScore = score; }
    }
    if (best) { map.set(t.id, best.n); claimed.add(best.n); }
    else map.set(t.id, cleanName(t.name));
  }
  return map;
}

// ---------- Veri çekme ----------

async function getMatches(code) {
  if (process.env.FD_MOCK_DIR) return JSON.parse(readFileSync(join(process.env.FD_MOCK_DIR, code + ".json"), "utf8"));
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/matches`, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN },
  });
  if (!res.ok) throw new Error(`${code}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function buildLeague(code, json, known) {
  const matches = json.matches || [];
  // Şampiyonlar Ligi tablosu yalnızca lig aşamasından (sayfadaki geçmiş verilerle aynı kapsam)
  const tableMatches = code === "CL" ? matches.filter(m => m.stage === "LEAGUE_STAGE") : matches;

  const teams = new Map();
  for (const m of tableMatches) for (const t of [m.homeTeam, m.awayTeam]) if (t?.id) teams.set(t.id, t);
  for (const m of matches) for (const t of [m.homeTeam, m.awayTeam]) if (t?.id && !teams.has(t.id)) teams.set(t.id, t);
  const names = buildNameMap([...teams.values()], known);
  const nm = t => names.get(t.id);

  const row = () => ({ W: 0, D: 0, L: 0, GF: 0, GA: 0, h1f: 0, h1a: 0, h2f: 0, h2a: 0, hs: 0 });
  const st = new Map();
  for (const m of tableMatches) for (const t of [m.homeTeam, m.awayTeam]) if (t?.id && !st.has(t.id)) st.set(t.id, row());

  for (const m of tableMatches) {
    if (m.status !== "FINISHED" || !m.homeTeam?.id || !m.awayTeam?.id) continue;
    const s = m.score || {};
    const ft = s.regularTime ?? s.fullTime;
    if (ft?.home == null || ft?.away == null) continue;
    const H = st.get(m.homeTeam.id), A = st.get(m.awayTeam.id);
    H.GF += ft.home; H.GA += ft.away; A.GF += ft.away; A.GA += ft.home;
    if (ft.home > ft.away) { H.W++; A.L++; } else if (ft.home < ft.away) { A.W++; H.L++; } else { H.D++; A.D++; }
    const ht = s.halfTime;
    if (ht?.home != null && ht?.away != null) {
      H.h1f += ht.home; H.h1a += ht.away; H.h2f += ft.home - ht.home; H.h2a += ft.away - ht.away;
      A.h1f += ht.away; A.h1a += ht.home; A.h2f += ft.away - ht.away; A.h2a += ft.home - ht.home;
      H.hs++; A.hs++;
    }
  }

  const ordered = [...st.entries()].sort(([, a], [, b]) =>
    (b.W * 3 + b.D) - (a.W * 3 + a.D) || (b.GF - b.GA) - (a.GF - a.GA) || b.GF - a.GF);
  const table = ordered.map(([id, r]) => `${names.get(id)}|${r.W}|${r.D}|${r.L}|${r.GF}|${r.GA}`).join("\n");
  const halves = ordered.filter(([, r]) => r.hs > 0)
    .map(([id, r]) => `${names.get(id)}|${r.h1f}|${r.h1a}|${r.h2f}|${r.h2a}`).join("\n");

  const now = Date.now(), until = now + FIXTURE_DAYS * 864e5;
  const fixtures = matches
    .filter(m => ["SCHEDULED", "TIMED"].includes(m.status) && m.homeTeam?.id && m.awayTeam?.id)
    .filter(m => { const t = Date.parse(m.utcDate); return t > now && t < until; })
    .sort((a, b) => Date.parse(a.utcDate) - Date.parse(b.utcDate))
    .map(m => `${m.utcDate}|${nm(m.homeTeam)}|${nm(m.awayTeam)}`).join("\n");

  // Ev sahibi avantajı için lig genelinde ev ve deplasman golleri (bitmiş maçlar)
  const home = { hg: 0, ag: 0, n: 0, hw: 0, d: 0, aw: 0 };
  for (const m of tableMatches) {
    if (m.status !== "FINISHED") continue;
    const ft = m.score?.regularTime ?? m.score?.fullTime;
    if (ft?.home == null || ft?.away == null) continue;
    home.hg += ft.home; home.ag += ft.away; home.n++;
    if (ft.home > ft.away) home.hw++; else if (ft.home < ft.away) home.aw++; else home.d++;
  }

  // Bitmiş maçlar (takım güçlerini maç maç hesaplamak, form ve model karnesi için): "ISO|Ev|Dep|EvGol|DepGol"
  const results = tableMatches
    .filter(m => m.status === "FINISHED" && m.homeTeam?.id && m.awayTeam?.id)
    .map(m => ({ m, ft: m.score?.regularTime ?? m.score?.fullTime }))
    .filter(({ ft }) => ft?.home != null && ft?.away != null)
    .sort((a, b) => Date.parse(a.m.utcDate) - Date.parse(b.m.utcDate))
    .map(({ m, ft }) => `${m.utcDate}|${nm(m.homeTeam)}|${nm(m.awayTeam)}|${ft.home}|${ft.away}`).join("\n");

  return { table, halves, fixtures, home, results, names, played: ordered.reduce((s, [, r]) => s + r.W + r.D + r.L, 0) / 2 };
}

// ---------- Gol katkısı (football-data) ----------

async function getScorers(code) {
  if (process.env.FD_MOCK_DIR) {
    try { return JSON.parse(readFileSync(join(process.env.FD_MOCK_DIR, code + "-scorers.json"), "utf8")); } catch { return { scorers: [] }; }
  }
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/scorers?limit=100`, {
    headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_TOKEN },
  });
  if (!res.ok) throw new Error(`${code} gol listesi: HTTP ${res.status}`);
  return res.json();
}

/** "Takım|Oyuncu|Gol|Asist" satırları */
function buildScorers(json, names, known) {
  const list = json.scorers || [];
  const unknown = list.map(x => x.team).filter(t => t?.id && !names.has(t.id));
  const extra = unknown.length ? buildNameMap(unknown, known) : new Map();
  return list.filter(x => x.player?.name && x.team?.id)
    .map(x => `${names.get(x.team.id) ?? extra.get(x.team.id)}|${x.player.name}|${x.goals ?? 0}|${x.assists ?? 0}`)
    .join("\n");
}

// ---------- API-Football: eksik oyuncular ve Süper Lig ----------

let afRemaining = Infinity;
async function af(path) {
  if (process.env.FD_MOCK_DIR) {
    const f = join(process.env.FD_MOCK_DIR, "AF-" + path.replace(/[^a-z0-9]+/gi, "-") + ".json");
    return afCheck(JSON.parse(readFileSync(f, "utf8")));
  }
  if (afRemaining < 5) throw new Error(afRemaining === 0 ? "API-Football paketi bu sezonu kapsamıyor ya da istek hakkı bitti" : "günlük istek hakkı bitmek üzere, atlandı");
  const res = await fetch("https://v3.football.api-sports.io/" + path, { headers: { "x-apisports-key": process.env.API_FOOTBALL_KEY } });
  const remH = res.headers.get("x-ratelimit-requests-remaining");
  if (remH !== null && remH !== "" && Number.isFinite(Number(remH))) afRemaining = Number(remH);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return afCheck(await res.json());
}
function afCheck(j) {
  const errs = j.errors && (Array.isArray(j.errors) ? j.errors : Object.values(j.errors));
  if (errs && errs.length) {
    const msg = errs.join("; ");
    // Paket bu sezonu kapsamıyorsa diğer istekleri boşa harcama
    if (/do not have access to this season/i.test(msg)) afRemaining = 0;
    throw new Error(msg);
  }
  return j;
}

/** API-Football maçlarını football-data biçimine çevirir (tablo hesabı aynı koddan geçsin diye) */
function afToMatches(j) {
  const done = new Set(["FT", "AET", "PEN"]), sched = new Set(["NS", "TBD"]);
  return {
    matches: (j.response || []).map(x => ({
      utcDate: x.fixture?.date,
      status: done.has(x.fixture?.status?.short) ? "FINISHED" : sched.has(x.fixture?.status?.short) ? "TIMED" : "OTHER",
      homeTeam: { id: x.teams?.home?.id, name: x.teams?.home?.name },
      awayTeam: { id: x.teams?.away?.id, name: x.teams?.away?.name },
      score: {
        fullTime: { home: x.score?.fulltime?.home ?? x.goals?.home, away: x.score?.fulltime?.away ?? x.goals?.away },
        halfTime: { home: x.score?.halftime?.home, away: x.score?.halftime?.away },
      },
    })),
  };
}

/** Yaklaşan maçlarda forma giyemeyecek ya da şüpheli oyuncular */
function afAbsences(j, known, lg) {
  const now = Date.now(), until = now + FIXTURE_DAYS * 864e5;
  const rows = (j.response || []).filter(x => {
    const t = Date.parse(x.fixture?.date); return t > now - 3 * 3600e3 && t < until;
  });
  const teams = new Map(rows.map(x => [x.team.id, x.team]));
  const names = buildNameMap([...teams.values()], known);
  return rows.map(x => ({
    lg, t: names.get(x.team.id), p: x.player?.name,
    s: /questionable/i.test(x.player?.type || "") ? "doubt" : "out",
    r: reasonTr(x.player?.reason), on: x.fixture?.date,
  }));
}

// ---------- Yedek eksik oyuncu listesi ----------

function reasonTr(r = "") {
  if (/card|suspen|ceza/i.test(r)) return "Cezalı";
  if (/ill|virus/i.test(r)) return "Hastalık";
  if (/not registered|inactive/i.test(r)) return "Kadroda değil";
  if (/cruciate/i.test(r)) return "Çapraz bağ";
  if (/^other$|^-?$/i.test(r.trim())) return "Belirsiz neden";
  return "Sakatlık";
}

function seedAbsences(seed, known, lg) {
  const lines = seed.leagues?.[lg] || [];
  const raw = lines.map(l => l.split("|"));
  const teams = new Map(raw.map(([t]) => [t, { id: t, name: t }]));
  const names = buildNameMap([...teams.values()], known);
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  return raw.filter(([, , , , to]) => to === "-" || !to || to >= today)
    .filter(([t, p]) => !seen.has(t + p) && seen.add(t + p))
    .map(([t, p, pos, r, to]) => ({ lg, t: names.get(t), p, pos, s: "out", r: reasonTr(r), to: to && to !== "-" ? to : null }));
}

// ---------- Ana akış ----------

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Bahis oranları (The Odds API) ve günün kuponu ----------
// Oranlar günde bir kez (İstanbul saatiyle 08:00'den sonraki ilk çalışmada) çekilir; ücretsiz paket ayda 500 kredi verir.
const ODDS_SPORTS = {
  "Premier League": "soccer_epl", "La Liga": "soccer_spain_la_liga", "Serie A": "soccer_italy_serie_a",
  "Bundesliga": "soccer_germany_bundesliga", "Ligue 1": "soccer_france_ligue_one",
  "Şampiyonlar Ligi": "soccer_uefa_champs_league", "Süper Lig": "soccer_turkey_super_league",
};
const istDate = d => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(d);
const istHour = d => +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hour12: false }).format(d);
let oddsRemaining = Infinity;

async function oddsApi(path) {
  if (process.env.FD_MOCK_DIR) {
    return JSON.parse(readFileSync(join(process.env.FD_MOCK_DIR, "ODDS-" + path.split("?")[0].replace(/[^a-z0-9]+/gi, "-") + ".json"), "utf8"));
  }
  if (oddsRemaining < 10) throw new Error("aylık kredi bitmek üzere, atlandı");
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`https://api.the-odds-api.com/v4/${path}${sep}apiKey=${process.env.ODDS_API_KEY}`);
  const rem = res.headers.get("x-requests-remaining");
  if (rem !== null && rem !== "") oddsRemaining = Number(rem);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  return res.json();
}

const median = a => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };

/** Önümüzdeki 48 saatteki maçların ortalama (medyan) oranları: "ISO|Ev|Dep|1|X|2|bahisçi sayısı|2,5 Üst|2,5 Alt" */
async function fetchOdds(known, allKnown, status) {
  const out = {};
  const to = new Date(Date.now() + 48 * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const [lg, key] of Object.entries(ODDS_SPORTS)) {
    try {
      const j = await oddsApi(`sports/${key}/odds?regions=eu&markets=h2h,totals&oddsFormat=decimal&dateFormat=iso&commenceTimeTo=${to}`);
      const teams = new Map();
      j.forEach(e => { teams.set(e.home_team, { id: e.home_team, name: e.home_team }); teams.set(e.away_team, { id: e.away_team, name: e.away_team }); });
      const kn = lg === "Şampiyonlar Ligi" ? allKnown : known[lg] || [];
      const names = buildNameMap([...teams.values()], kn);
      const unk = [...names.values()].filter(n => !kn.includes(n));
      if (unk.length) status.unmatched.push(...unk.map(n => `${lg} (oran): ${n}`));
      out[lg] = j.map(e => {
        const o = { h: [], x: [], a: [], ov: [], un: [] };
        for (const b of e.bookmakers || []) for (const m of b.markets || []) {
          if (m.key === "h2h") for (const x of m.outcomes || []) {
            if (x.name === e.home_team) o.h.push(x.price); else if (x.name === e.away_team) o.a.push(x.price); else o.x.push(x.price);
          }
          if (m.key === "totals") for (const x of m.outcomes || []) {
            if (x.point !== 2.5) continue;
            if (/^over$/i.test(x.name)) o.ov.push(x.price); else if (/^under$/i.test(x.name)) o.un.push(x.price);
          }
        }
        if (!o.h.length || !o.a.length || !o.x.length) return null;
        const ou = o.ov.length && o.un.length ? `|${median(o.ov).toFixed(2)}|${median(o.un).toFixed(2)}` : "||";
        return `${e.commence_time}|${names.get(e.home_team)}|${names.get(e.away_team)}|${median(o.h).toFixed(2)}|${median(o.x).toFixed(2)}|${median(o.a).toFixed(2)}|${o.h.length}${ou}`;
      }).filter(Boolean).join("\n");
      console.log(`✓ Oranlar ${lg}: ${out[lg] ? out[lg].split("\n").length : 0} maç`);
    } catch (e) { console.warn(`✗ Oranlar ${lg}: ${e.message}`); }
  }
  return { fetched: new Date().toISOString(), remaining: Number.isFinite(oddsRemaining) ? oddsRemaining : null, leagues: out };
}

// ---------- Aralarındaki maçlar (son 10 yıl, football-data.co.uk) ----------
const FDCO = { "Premier League": "E0", "La Liga": "SP1", "Serie A": "I1", "Bundesliga": "D1", "Ligue 1": "F1", "Süper Lig": "T1" };
const H2H_YEARS = 10;
const CACHE_DIR = join(ROOT, ".cache", "fdco");

/** Bir sezonun CSV dosyası (bitmiş sezonlar önbellekten; içinde bulunulan sezon her seferinde yeniden) */
async function fdcoSeason(div, code, current) {
  const f = join(CACHE_DIR, `${code}-${div}.csv`);
  if (!current && existsSync(f)) return readFileSync(f, "utf8");
  if (process.env.FD_MOCK_DIR) { const m = join(process.env.FD_MOCK_DIR, `FDCO-${code}-${div}.csv`); return existsSync(m) ? readFileSync(m, "utf8") : null; }
  const res = await fetch(`https://www.football-data.co.uk/mmz4281/${code}/${div}.csv`);
  if (!res.ok) return null;
  const txt = await res.text();
  if (!/HomeTeam/.test(txt.slice(0, 500))) return null;
  mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(f, txt);
  return txt;
}
function parseCsv(txt) {
  const lines = txt.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const head = lines[0].split(","), ix = k => head.indexOf(k);
  const iD = ix("Date"), iH = ix("HomeTeam"), iA = ix("AwayTeam"), iHG = ix("FTHG"), iAG = ix("FTAG");
  return lines.slice(1).map(l => l.split(",")).filter(c => c[iH] && c[iHG] !== "" && c[iHG] != null).map(c => {
    const [d, m, y] = c[iD].split("/"); const yy = y.length === 2 ? "20" + y : y;
    return { d: `${yy}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`, h: c[iH], a: c[iA], hg: +c[iHG], ag: +c[iAG] };
  });
}
/** Yaklaşan maçlar için iki takımın son 10 yıldaki karşılaşmaları: "Ev|Dep" → "YYYY-AA-GG|Ev|Dep|EvGol|DepGol;..." */
async function buildH2H(leagues, odds, known, status) {
  const now = new Date(), y = now.getUTCFullYear(), startY = now.getUTCMonth() >= 6 ? y : y - 1; // sezon başlangıç yılı
  const out = {}, missing = [];
  // ligdeki her takım çifti için yaklaşan maçları topla
  const pairs = {};
  for (const lg of Object.keys(FDCO)) {
    const fx = [...(leagues[lg]?.fixtures || "").split("\n"), ...(odds?.leagues?.[lg] || "").split("\n")].filter(Boolean).map(r => r.split("|"));
    pairs[lg] = new Set(fx.map(([, h, a]) => h + "|" + a));
  }
  // Şampiyonlar Ligi: iki takım aynı yerel ligdeyse o ligin maçlarına bakılır
  const cl = [...(leagues["Şampiyonlar Ligi"]?.fixtures || "").split("\n"), ...(odds?.leagues?.["Şampiyonlar Ligi"] || "").split("\n")].filter(Boolean).map(r => r.split("|"));
  for (const [, h, a] of cl) for (const lg of Object.keys(FDCO)) if ((known[lg] || []).includes(h) && (known[lg] || []).includes(a)) pairs[lg].add(h + "|" + a);
  for (const [lg, div] of Object.entries(FDCO)) {
    if (!pairs[lg].size) continue;
    let rows = [];
    for (let s = startY - H2H_YEARS; s < startY; s++) {
      const code = String(s % 100).padStart(2, "0") + String((s + 1) % 100).padStart(2, "0");
      try {
        const txt = await fdcoSeason(div, code, false);
        if (txt) rows.push(...parseCsv(txt)); else missing.push(`${lg} ${s}-${String((s + 1) % 100).padStart(2, "0")}`);
      } catch { missing.push(`${lg} ${s}`); }
      if (!process.env.FD_MOCK_DIR) await sleep(250);
    }
    // bu sezonun sonuçları kendi verimizden
    (leagues[lg]?.results || "").split("\n").filter(Boolean).forEach(r => { const [d, h, a, hg, ag] = r.split("|"); rows.push({ d: d.slice(0, 10), h, a, hg: +hg, ag: +ag, mapped: true }); });
    const teams = new Map(); rows.filter(r => !r.mapped).forEach(r => { teams.set(r.h, { id: r.h, name: r.h }); teams.set(r.a, { id: r.a, name: r.a }); });
    const names = buildNameMap([...teams.values()], known[lg] || []);
    rows = rows.map(r => r.mapped ? r : { ...r, h: names.get(r.h), a: names.get(r.a) });
    for (const key of pairs[lg]) {
      const [h, a] = key.split("|");
      const games = rows.filter(r => (r.h === h && r.a === a) || (r.h === a && r.a === h))
        .sort((x, y) => y.d.localeCompare(x.d)).slice(0, 20);
      out[key] = games.map(r => `${r.d}|${r.h}|${r.a}|${r.hg}|${r.ag}`).join(";");
    }
  }
  if (missing.length) status.h2hMissing = missing;
  console.log(`✓ Aralarındaki maçlar: ${Object.keys(out).length} eşleşme${missing.length ? `, alınamayan sezon: ${missing.length}` : ""}`);
  return { built: now.toISOString(), pairs: out };
}

/** Önceki yayındaki data.json (oranlar ve kupon geçmişi buradan devralınır) */
async function getPrev() {
  try {
    if (process.env.FD_MOCK_DIR) return JSON.parse(readFileSync(join(process.env.FD_MOCK_DIR, "prev-data.json"), "utf8"));
    if (!process.env.PAGES_URL) return null;
    const res = await fetch(process.env.PAGES_URL + "?t=" + Date.now());
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

/** Kupon maçlarının sonuçlarını işler: W (tuttu), L (tutmadı), V (ertelendi/iptal) */
async function settleCoupons(history, leagues, known) {
  const pending = history.flatMap(c => c.items.filter(i => !i.res));
  if (!pending.length) return;
  const find = (lg, it) => {
    const rows = (leagues[lg]?.results || "").split("\n").filter(Boolean).map(r => r.split("|"));
    return rows.find(([d, h, a]) => h === it.h && a === it.a && Math.abs(Date.parse(d) - Date.parse(it.iso)) < 12 * 3600e3);
  };
  // football-data'da olmayan ligler (Süper Lig) için The Odds API skorları (2 kredi)
  const extra = {};
  for (const lg of new Set(pending.map(i => i.lg))) {
    if (leagues[lg]?.results || !process.env.ODDS_API_KEY && !process.env.FD_MOCK_DIR) continue;
    if (!pending.some(i => i.lg === lg && Date.parse(i.iso) + 2.5 * 3600e3 < Date.now())) continue;
    try {
      const j = await oddsApi(`sports/${ODDS_SPORTS[lg]}/scores?daysFrom=3&dateFormat=iso`);
      const teams = new Map(); j.forEach(e => { teams.set(e.home_team, { id: e.home_team, name: e.home_team }); teams.set(e.away_team, { id: e.away_team, name: e.away_team }); });
      const names = buildNameMap([...teams.values()], known[lg] || []);
      extra[lg] = j.filter(e => e.completed && e.scores).map(e => {
        const sc = Object.fromEntries(e.scores.map(x => [x.name, +x.score]));
        return [e.commence_time, names.get(e.home_team), names.get(e.away_team), sc[e.home_team], sc[e.away_team]];
      });
    } catch (e) { console.warn(`✗ Skorlar ${lg}: ${e.message}`); }
  }
  for (const c of history) {
    for (const it of c.items) {
      if (it.res) continue;
      const r = find(it.lg, it) || (extra[it.lg] || []).find(([d, h, a]) => h === it.h && a === it.a && Math.abs(Date.parse(d) - Date.parse(it.iso)) < 12 * 3600e3);
      if (r) {
        const hg = +r[3], ag = +r[4];
        it.score = `${hg}-${ag}`;
        const ok = it.mk === "OU" ? (it.side === "O" ? hg + ag > 2.5 : hg + ag < 2.5) : (it.side === "1" ? hg > ag : ag > hg);
        it.res = ok ? "W" : "L";
      } else if (Date.parse(it.iso) < Date.now() - 4 * 864e5) it.res = "V"; // 4 gün içinde sonuç yoksa ertelenmiş say
    }
    const rs = c.items.map(i => i.res);
    c.status = !c.items.length ? "empty" : rs.includes("L") ? "lost" : rs.every(x => x === "V") ? "void"
      : rs.every(x => x === "W" || x === "V") ? "won" : "pending";
  }
}

async function main() {
  if (!process.env.FD_MOCK_DIR && !process.env.FOOTBALL_DATA_TOKEN) {
    console.error("FOOTBALL_DATA_TOKEN tanımlı değil. GitHub'da Settings → Secrets and variables → Actions bölümüne ekleyin.");
    process.exit(1);
  }
  const known = knownNames();
  const allKnown = [...new Set(Object.values(known).flat())];
  const leagues = {}, errors = [], status = { absences: {}, unmatched: [] };
  const codes = Object.keys(COMPETITIONS);
  for (const [i, code] of codes.entries()) {
    const name = COMPETITIONS[code];
    try {
      const lg = buildLeague(code, await getMatches(code), code === "CL" ? allKnown : known[name] || []);
      if (!lg.table) throw new Error(`${code}: maç bulunamadı`);
      leagues[name] = { table: lg.table, halves: lg.halves, fixtures: lg.fixtures, home: lg.home, results: lg.results };
      console.log(`✓ ${name}: ${lg.table.split("\n").length} takım, ${lg.played} maç, ` +
        `${lg.fixtures ? lg.fixtures.split("\n").length : 0} yaklaşan maç, ev golleri ${lg.home.hg}-${lg.home.ag}`);
      if (!process.env.FD_MOCK_DIR) await sleep(7000);
      try {
        leagues[name].scorers = buildScorers(await getScorers(code), lg.names, code === "CL" ? allKnown : known[name] || []);
      } catch (e) { console.warn(`  gol katkısı alınamadı: ${e.message}`); }
    } catch (e) {
      errors.push(e.message);
      console.warn(`✗ ${name}: ${e.message}`);
    }
    // Ücretsiz paket dakikada 10 isteğe izin verir
    if (!process.env.FD_MOCK_DIR && i < codes.length - 1) await sleep(7000);
  }
  if (!Object.keys(leagues).length) {
    console.error("Hiçbir lig güncellenemedi; önceki yayın olduğu gibi kalacak.");
    process.exit(1);
  }

  // Eksik oyuncular: önce API-Football, alınamayan ligler için yedek liste
  const absences = [];
  const hasAF = !!(process.env.API_FOOTBALL_KEY || process.env.FD_MOCK_DIR && process.env.AF_MOCK);
  if (hasAF) {
    // Süper Lig maçları (football-data'da yok)
    try {
      const sl = buildLeague("SL", afToMatches(await af(`fixtures?league=203&season=${SEASON}`)), known["Süper Lig"] || []);
      if (!sl.table) throw new Error("maç bulunamadı");
      leagues["Süper Lig"] = { table: sl.table, halves: sl.halves, fixtures: sl.fixtures, home: sl.home, results: sl.results };
      const unk = [...sl.names.values()].filter(n => !(known["Süper Lig"] || []).includes(n));
      if (unk.length) status.unmatched.push(...unk.map(n => "Süper Lig: " + n));
      console.log(`✓ Süper Lig (API-Football): ${sl.table.split("\n").length} takım, ${sl.played} maç`);
    } catch (e) { errors.push("Süper Lig: " + e.message); console.warn(`✗ Süper Lig (API-Football): ${e.message}`); }
    for (const [lg, id] of Object.entries(AF_LEAGUES)) {
      try {
        const rows = afAbsences(await af(`injuries?league=${id}&season=${SEASON}`), lg === "Şampiyonlar Ligi" ? allKnown : known[lg] || [], lg);
        absences.push(...rows);
        status.absences[lg] = { source: "API-Football", count: rows.length };
        console.log(`✓ Eksikler ${lg}: ${rows.length} kayıt`);
      } catch (e) { console.warn(`✗ Eksikler ${lg}: ${e.message}`); status.absences[lg] = { error: e.message }; }
    }
  }
  let seed = null;
  try { seed = JSON.parse(readFileSync(SEED, "utf8")); } catch { /* yedek yok */ }
  if (seed) for (const lg of Object.keys(seed.leagues || {})) {
    if (status.absences[lg]?.source) continue;
    const rows = seedAbsences(seed, known[lg] || [], lg);
    absences.push(...rows);
    status.absences[lg] = { ...(status.absences[lg] || {}), source: `${seed.source} (${seed.updated})`, count: rows.length };
  }

  // Oranlar (günde bir kez) ve kupon geçmişi
  const prev = await getPrev();
  let odds = prev?.odds || null, needCoupon = false;
  const now = new Date();
  if (process.env.ODDS_API_KEY || process.env.FD_MOCK_DIR && process.env.ODDS_MOCK) {
    const fresh = odds?.fetched && istDate(new Date(odds.fetched)) === istDate(now);
    if (!fresh && istHour(now) >= 8 || process.env.FORCE_ODDS === "true") {
      odds = await fetchOdds(known, allKnown, status);
      needCoupon = true;
    }
  }
  // Süper Lig sonuçları (football-data'da yok): The Odds API skorlarından günde bir kez biriktirilir
  const extraResults = { ...(prev?.extraResults || {}) };
  if ((process.env.ODDS_API_KEY || process.env.FD_MOCK_DIR && process.env.ODDS_MOCK) && !leagues["Süper Lig"]?.table) {
    const last = prev?.extraResultsFetched;
    if (needCoupon || !last || istDate(new Date(last)) !== istDate(now)) {
      try {
        const lg = "Süper Lig";
        const j = await oddsApi(`sports/${ODDS_SPORTS[lg]}/scores?daysFrom=3&dateFormat=iso`);
        const teams = new Map(); j.forEach(e => { teams.set(e.home_team, { id: e.home_team, name: e.home_team }); teams.set(e.away_team, { id: e.away_team, name: e.away_team }); });
        const names = buildNameMap([...teams.values()], known[lg] || []);
        const have = new Set((extraResults[lg] || "").split("\n").filter(Boolean).map(r => r.split("|").slice(1, 3).join("|")));
        const add = j.filter(e => e.completed && e.scores).map(e => {
          const sc = Object.fromEntries(e.scores.map(x => [x.name, x.score]));
          return `${e.commence_time}|${names.get(e.home_team)}|${names.get(e.away_team)}|${sc[e.home_team]}|${sc[e.away_team]}`;
        }).filter(r => !have.has(r.split("|").slice(1, 3).join("|")));
        extraResults[lg] = [...(extraResults[lg] || "").split("\n").filter(Boolean), ...add].sort().join("\n");
        console.log(`✓ Süper Lig skorları: ${add.length} yeni sonuç`);
      } catch (e) { console.warn("✗ Süper Lig skorları: " + e.message); }
    }
  }
  const extraResultsFetched = Object.keys(extraResults).length ? (needCoupon || !prev?.extraResultsFetched || istDate(new Date(prev.extraResultsFetched)) !== istDate(now) ? now.toISOString() : prev.extraResultsFetched) : null;
  const couponHistory = (prev?.couponHistory || []).slice(0, 60);
  try { await settleCoupons(couponHistory, { ...Object.fromEntries(Object.entries(extraResults).map(([k, v]) => [k, { results: v }])), ...leagues }, known); } catch (e) { console.warn("✗ Kupon sonuçları: " + e.message); }
  if (odds?.remaining != null) status.oddsRemaining = oddsRemaining !== Infinity ? oddsRemaining : odds.remaining;

  // Aralarındaki maçlar günde bir kez (ya da yeni fikstür gelince) hesaplanır
  let h2h = prev?.h2h || null;
  const fxKeys = Object.values(leagues).flatMap(v => (v.fixtures || "").split("\n").filter(Boolean).map(r => r.split("|").slice(1, 3).join("|")));
  const missingPairs = fxKeys.some(k => !(h2h?.pairs && k in h2h.pairs));
  if (!h2h || istDate(new Date(h2h.built)) !== istDate(now) || missingPairs || needCoupon) {
    try { h2h = await buildH2H({ ...leagues, ...Object.fromEntries(Object.entries(extraResults).map(([k, v]) => [k, { ...(leagues[k] || {}), results: leagues[k]?.results || v }])) }, odds, known, status); }
    catch (e) { console.warn("✗ Aralarındaki maçlar: " + e.message); }
  }

  const out = { updated: new Date().toISOString(), source: "football-data.org", leagues, absences, status, odds, couponHistory, extraResults, extraResultsFetched, h2h, needCoupon };
  writeFileSync(OUT, JSON.stringify(out));
  // GitHub Actions özetinde görünsün diye (kontrol için)
  if (process.env.GITHUB_ACTIONS) {
    const homeTxt = Object.entries(leagues).map(([k, v]) => `${k} ${v.home ? v.home.hg + "-" + v.home.ag : "?"}`).join(", ");
    const absTxt = Object.entries(status.absences).map(([k, v]) => `${k}: ${v.source ? v.source + " " + v.count : "hata"}${v.error ? " (" + v.error.slice(0, 80) + ")" : ""}`).join(" | ");
    console.log(`::notice title=Ev ve deplasman golleri::${homeTxt}`);
    console.log(`::notice title=Eksik oyuncular::${absTxt}`);
    if (h2h) console.log(`::notice title=Aralarındaki maçlar::${Object.keys(h2h.pairs).length} eşleşme, ${Object.values(h2h.pairs).filter(Boolean).length} tanesinde geçmiş maç var${status.h2hMissing ? ` · alınamayan sezonlar: ${status.h2hMissing.join(", ")}` : ""}`);
    if (odds) console.log(`::notice title=Oranlar::${istDate(new Date(odds.fetched))} · ${Object.entries(odds.leagues).map(([k, v]) => `${k} ${v ? v.split("\n").length : 0}`).join(", ")} · kalan kredi ${status.oddsRemaining ?? "?"}${needCoupon ? " · yeni kupon hazırlanacak" : ""}`);
    if (errors.length) console.log(`::warning title=Alınamayan veriler::${errors.join(" | ").slice(0, 900)}`);
    // Elle başlatılan çalışmada istenirse maç sonuçlarını da yaz (model kontrolü için)
    if (process.env.DUMP_RESULTS === "true") for (const [k, v] of Object.entries(leagues))
      if (v.results) console.log(`::notice title=Sonuçlar ${k}::${v.results.replace(/\n/g, " ; ")}`);
    if (status.unmatched.length) console.log(`::warning title=Eşleşmeyen takım adları::${status.unmatched.join(", ")}`);
  }
  console.log(`web/data.json yazıldı (${Object.keys(leagues).length} lig, ${absences.length} eksik oyuncu kaydı${errors.length ? `, ${errors.length} hata` : ""}).`);
}

// Başka bir betikten içe aktarılınca (ör. check-seed.mjs) çalışmasın
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export { knownNames, buildNameMap, seedAbsences, SEED };
