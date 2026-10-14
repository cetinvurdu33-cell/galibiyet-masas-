// scripts/absences-seed.json dosyasını denetler: biçim, tarih ve takım adlarının sayfadaki adlarla eşleşmesi.
// Kullanım: node scripts/check-seed.mjs   (sorun varsa 1 ile çıkar)
import { readFileSync } from "node:fs";
import { knownNames, seedAbsences, SEED } from "./update-data.mjs";

const seed = JSON.parse(readFileSync(SEED, "utf8"));
const known = knownNames();
const problems = [];
if (!/^\d{4}-\d{2}-\d{2}$/.test(seed.updated || "")) problems.push(`"updated" YYYY-AA-GG olmalı: ${seed.updated}`);
for (const [lg, lines] of Object.entries(seed.leagues || {})) {
  if (!known[lg]) { problems.push(`Bilinmeyen lig: ${lg}`); continue; }
  lines.forEach((l, i) => {
    const f = l.split("|");
    if (f.length !== 5) problems.push(`${lg} satır ${i + 1}: 5 alan olmalı → ${l}`);
    else {
      if (!["F", "M", "D", "G", "-"].includes(f[2])) problems.push(`${lg} satır ${i + 1}: mevki F/M/D/G olmalı → ${l}`);
      if (f[4] !== "-" && !/^\d{4}-\d{2}-\d{2}$/.test(f[4])) problems.push(`${lg} satır ${i + 1}: tarih YYYY-AA-GG ya da - olmalı → ${l}`);
    }
  });
  const rows = seedAbsences(seed, known[lg], lg);
  const bad = [...new Set(rows.map(r => r.t).filter(t => !known[lg].includes(t)))];
  if (bad.length) problems.push(`${lg}: sayfadaki takımlarla eşleşmeyen adlar → ${bad.join(", ")} (update-data.mjs içindeki ALIASES listesine ekleyin)`);
  console.log(`${lg}: ${lines.length} satır, ${new Set(rows.map(r => r.t)).size} takım`);
}
if (problems.length) { console.error("SORUNLAR:\n- " + problems.join("\n- ")); process.exit(1); }
console.log("Yedek liste geçerli.");
