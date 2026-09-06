# Operational Mandate Protocol — V5

GitHub/main is the source of truth. Cloudflare is an executor only.

The active operational plan is `runtime/okx/active_execution_plan.json`. Before any new DEMO order, the Worker verifies:

1. provider is OKX and environment is DEMO_ONLY;
2. plan state is ACTIVE;
3. SHA-256 canonical hash matches `plan_hash`;
4. the strategy engine is supported by the generic executor;
5. the authorized instrument, capital policy, and one-position limit are valid.

The current `OKX-SPOT-SR-v2` plan is a BASELINE with `NO_EDGE_CLAIM`. It is not a Champion.

## What changes without a deploy

A versioned mandate change within a supported engine changes only canonical GitHub artifacts: strategy specification, market selection, capital policy, and the active plan. The Worker refreshes and validates that plan from GitHub. It does not need a Cloudflare deployment for a valid, supported mandate change.

## What requires a deploy

A change to the generic executor itself — a new engine, provider capability, risk control, protocol, Worker configuration, or security fix — is a code release. Commits to `worker/**`, `config/v5/**`, or `wrangler.toml` on `main` trigger `.github/workflows/deploy-cloudflare-worker.yml`, which deploys through Wrangler after its syntax gate.

The workflow requires GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. They must never be committed, printed, or copied into the Worker. A missing or invalid secret makes deployment fail; it never falls back to a manual, LIVE, or alternate environment.

## Promotion boundary

To promote a replacement, the scientific cycles must preserve lineage, update the Strategy Registry and create a new materialized plan. A plan replacement must be independently versioned, hashed, and authorized through the applicable Promotion Gates. The previous plan and evidence remain immutable.

The Worker refreshes the verified plan from GitHub and retains a last verified copy only for transient source availability. If no verified mandate is available, it fails closed and opens no order. The Worker never executes arbitrary code fetched from GitHub; it interprets only supported, versioned strategy specifications.
