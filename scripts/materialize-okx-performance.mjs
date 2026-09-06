import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const endpoint = process.env.PERFORMANCE_EXPORT_URL || "https://kell-quant-lab.kesllyalbuquerque.workers.dev/performance-export";
const root = process.cwd();
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;
const output = async (relative, value, immutable = false) => {
  const path = join(root, relative);
  await mkdir(dirname(path), { recursive: true });
  if (immutable) {
    try { await readFile(path, "utf8"); return; } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  await writeFile(path, pretty(value), "utf8");
};

const response = await fetch(endpoint, { headers: { "Cache-Control": "no-store" } });
if (!response.ok) throw new Error(`performance export failed: HTTP ${response.status}`);
const snapshot = await response.json();
if (snapshot?.environment !== "DEMO_ONLY" || snapshot?.provider !== "OKX" || !Array.isArray(snapshot?.trades) || !snapshot?.performance) {
  throw new Error("performance export rejected: expected OKX DEMO_ONLY reconciled ledger");
}

for (const trade of snapshot.trades) {
  if (trade?.environment !== "DEMO_ONLY" || trade?.reconciliation_status !== "RECONCILED" || !trade?.trade_id || !Number.isFinite(Number(trade.net_realized_pnl))) continue;
  const id = String(trade.trade_id).replace(/[^A-Za-z0-9._-]/g, "_");
  await output(`performance/okx/trades/${id}.json`, trade, true);
}
for (const [date, summary] of Object.entries(snapshot.performance.daily || {})) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) await output(`performance/okx/daily/${date}.json`, { date, ...summary });
}
for (const [month, summary] of Object.entries(snapshot.performance.monthly || {})) {
  if (/^\d{4}-\d{2}$/.test(month)) await output(`performance/okx/monthly/${month}.json`, { month, ...summary });
}
await output("performance/okx/current.json", {
  schema_version: snapshot.schema_version,
  provider: "OKX",
  environment: "DEMO_ONLY",
  source: snapshot.source,
  generated_at: snapshot.generated_at,
  summary: snapshot.performance.summary,
  note: "Performance calculada apenas sobre trades do executor fechados, reconciliados e atribuídos ao Kell Quant Lab. Não é o patrimônio da conta OKX."
});
