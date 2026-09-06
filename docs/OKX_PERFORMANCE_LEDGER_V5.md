# OKX Demo Performance Ledger V5

The official operational performance metric is **NET REALIZED PNL** from an
executor-owned trade that is closed and `RECONCILED`.

It is not derived from `totalEq`, account balance, deposits, demo resets,
transfers, manual orders, or mark-to-market movements. Account values remain
operational telemetry only.

The Durable Object appends `TRADE_SETTLED` events and stores each immutable
trade under its deterministic `trade_id`. A settlement needs the executor
order/client-order identities, both OKX orders in `filled` state, complete
fills, and a deterministically convertible fee currency. Any uncertainty is
recorded as `PENDING_RECONCILIATION` and contributes zero to official P&L.

`/performance-export` exposes only the reconciled executor ledger and its
rebuildable daily/monthly projections. The hourly GitHub workflow materializes
immutable trade records under `performance/okx/trades/`, rebuildable daily
projections under `performance/okx/daily/`, monthly projections under
`performance/okx/monthly/`, and the current summary at
`performance/okx/current.json`.

Historical Deriv and pre-ledger ticker-estimate records remain preserved but
are not part of the OKX official performance series.
