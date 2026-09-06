# OKX DEMO SELL repair — 2026-09-06

## Root cause and deployment mismatch

The last successful pre-repair deployment was commit
`b50c242acd0e12089aec61279cd8b4d2a74999e6`. Its `closePosition` rounded
`entry.accFillSz` and sent that gross quantity as a market SELL without
reconciling the base-currency fee or available balance.

The actual SOL entry filled 10.007709 SOL. OKX charged 0.040030836 SOL
(0.4%), leaving 9.967678164 SOL available. Selling the gross quantity exceeded
owned inventory. The old error wrapper discarded OKX's item-level error and
retained only `code=1, All operations failed`; the original item-level sCode
cannot be recovered from that telemetry.

Four subsequent deployment workflows had failed. An unterminated candle-query
string in `worker/v5.js` prevented the newer balance-aware code from reaching
the Worker. Correcting the string enabled deployment. A recovery SELL of
9.967678 SOL was accepted and filled, order `3897494407441940480`.

A second bug then prevented settlement: the ledger compared gross bought
quantity with sold quantity, ignoring the base fee. The repair reconciles net
inventory, fills, fees, terminal orders, available balance and explicit dust.

## Exact order comparison

| Field | Original BUY | Old deployed SELL | Controlled BUY | Controlled SELL |
|---|---|---|---|---|
| Endpoint | POST /api/v5/trade/order | same | same | same |
| instId | SOL-USDT | SOL-USDT | SOL-USDT | SOL-USDT |
| tdMode | cash | cash | cash | cash |
| side | buy | sell | buy | sell |
| ordType | market | market | market | market |
| tgtCcy | base_ccy | omitted (base default for SELL) | base_ccy | base_ccy |
| sz | 10.007709 | 10.007709, reconstructed from deployed code | 0.001250 | 0.001245 |
| Base / quote | SOL / USDT | SOL / USDT | SOL / USDT | SOL / USDT |
| lotSz | 0.000001 | 0.000001 | 0.000001 | 0.000001 |
| minSz | 0.001 | 0.001 | 0.001 | 0.001 |
| Result | filled | rejected; item-level code lost | filled | filled |

The test BUY is the smallest lot-aligned quantity that leaves at least minSz
and an exactly lot-aligned sellable balance after the observed 0.4% base fee.
Buying only minSz would leave less than minSz to sell. No strategy signal was
used. Total purchased notional was 0.1295125 USDT.

## Verification

Executor commit: `4dfa11e3b7c7e55d1aa4b304e7cda75f04c9cd70`.
Deployment: https://github.com/Uparchive/kell-quant-lab/actions/runs/34003359144
(success). The CI gate runs tests against the actual executor functions.

TEST TRADE `TEST-TRADE-OKX-SELL-20260906-001` completed at
2026-09-06T01:15:27.800Z:

- BUY `3897512557537525760`: filled 0.001250 SOL at 103.61 USDT;
  fee 0.000005 SOL; net received 0.001245 SOL.
- SELL `3897512588676038656`: filled 0.001245 SOL at 103.60 USDT;
  fee 0.000515928 USDT.
- Test residual: exactly zero; SOL balance returned to its pre-test value.
- Test PnL: -0.001046428 USDT, excluded from scientific performance.
- Official performance summary before and after the test is identical.
- The earlier strategy position was settled separately with its own fills/PnL.

Raw orders, fills, balances, instrument rules and the recovery submission's
full OKX response are stored in the adjacent JSON evidence files. The test
also persists in the Durable Object's separate `test:` namespace and read-only
`/execution-test` route. All order intents and submission responses are kept
in the Durable Object ledger without signing headers or API secrets.

Deterministic regression tests cover base-fee reconciliation, exact lot
rounding, one-time test isolation, an accepted order followed by connection
failure, partial canceled SELL recovery, invalid entry-mandate/WS independence
for exits, PnL and explicit dust accounting.

## Operating behavior and remaining limits

Existing positions are monitored before entry-mandate validation, new market
selection or WebSocket login. Their own instrument supplies the exit price.
Triggered exits are durable and retried/reconciled on subsequent cycles.
Pending order intents are saved before transmission and recovered by client
ID; ambiguous responses do not generate blind duplicate orders. Partial
terminal exits are reconciled before their remaining inventory is sold.
Scientific PnL is based on attributed fills, signed fees and allocated cost;
trade records and performance changes are written transactionally.

The strategy, active plan and DEMO_ONLY protections were preserved. The
existing cron observes once per minute; it is not a tick-by-tick feed.

A pre-test residual of 0.000000164 SOL remains from the old position, below
lotSz/minSz, explicitly tracked as dust. It was neither created nor increased
by the controlled test. The entire OKX account is therefore not literally
zero SOL, while the test position is fully zero.

The actual SOL taker fee is 0.4% per side. The unchanged active strategy
assumes 20 bps for a round trip, so its fee/target assumptions need a separate
review; this infrastructure repair establishes execution, not positive edge.
Unknown exchange order outcomes remain under reconciliation rather than being
retried as new orders without evidence. Exchange outages and minimum-size
constraints still apply.
