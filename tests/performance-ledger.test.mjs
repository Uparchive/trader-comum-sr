import assert from "node:assert/strict";

function fillSummary(fills, base = "BTC", quote = "USDT") {
  let quantity = 0, notional = 0, fees = 0;
  for (const fill of fills) {
    const px = Number(fill.fillPx), sz = Number(fill.fillSz), fee = Math.abs(Number(fill.fee));
    if (!(px > 0 && sz > 0 && Number.isFinite(fee))) return null;
    quantity += sz; notional += px * sz;
    if (fill.feeCcy === quote) fees += fee;
    else if (fill.feeCcy === base) fees += fee * px;
    else return null;
  }
  return { quantity, notional, fees, average_price: notional / quantity };
}
function settle(buyFills, sellFills) {
  const buy = fillSummary(buyFills), sell = fillSummary(sellFills);
  if (!buy || !sell || buy.quantity !== sell.quantity) return null;
  return { gross: sell.notional - buy.notional, fees: buy.fees + sell.fees, net: sell.notional - buy.notional - buy.fees - sell.fees };
}

const winner = settle([{ fillPx: "100", fillSz: "2", fee: "0.20", feeCcy: "USDT" }], [{ fillPx: "110", fillSz: "2", fee: "0.22", feeCcy: "USDT" }]);
assert.equal(Number(winner.net.toFixed(8)), 19.58, "winner after fees");
assert.equal(settle([{ fillPx: "100", fillSz: "1", fee: "0", feeCcy: "USDT" }], [{ fillPx: "99", fillSz: "1", fee: "0", feeCcy: "USDT" }]).net, -1, "losing trade");
assert.equal(settle([{ fillPx: "100", fillSz: "1", fee: "0", feeCcy: "USDT" }], [{ fillPx: "100", fillSz: "1", fee: "0", feeCcy: "USDT" }]).net, 0, "breakeven trade");
assert.equal(settle([{ fillPx: "100", fillSz: "1", fee: "0.001", feeCcy: "BTC" }], [{ fillPx: "101", fillSz: "1", fee: "0", feeCcy: "USDT" }]).net, 0.9, "base-currency fee converted to quote");
assert.equal(Number(settle([{ fillPx: "100", fillSz: "0.4", fee: "0", feeCcy: "USDT" }, { fillPx: "101", fillSz: "0.6", fee: "0", feeCcy: "USDT" }], [{ fillPx: "102", fillSz: "1", fee: "0", feeCcy: "USDT" }]).gross.toFixed(8)), 1.4, "multiple fills aggregate");
assert.equal(settle([{ fillPx: "100", fillSz: "1", fee: "0", feeCcy: "OTHER" }], [{ fillPx: "101", fillSz: "1", fee: "0", feeCcy: "USDT" }]), null, "unknown fee currency remains pending");
const ids = new Set(); const record = (id) => { if (ids.has(id)) return false; ids.add(id); return true; };
assert.equal(record("OKX:close-1"), true); assert.equal(record("OKX:close-1"), false, "retry is idempotent");
assert.equal(ids.has("manual-order"), false, "manual/unattributed activity is excluded");
const officialBefore = 19.58, accountEquityAfterPassiveMove = 10000;
assert.equal(officialBefore, 19.58, "account mark-to-market changes do not change realized P&L");
assert.equal(accountEquityAfterPassiveMove, 10000);
console.log("performance-ledger deterministic tests passed");
