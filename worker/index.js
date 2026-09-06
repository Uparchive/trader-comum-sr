import strategy from "../config/production_strategy.json";
import risk from "../config/risk_limits.json";

const API = "https://api.derivws.com";
const PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";
const LEGACY_PUBLIC_WS = "wss://ws.binaryws.com/websockets/v3";
const PUBLIC_WS_ENDPOINTS = [PUBLIC_WS, LEGACY_PUBLIC_WS];
const DEMO_WS_PATH = "/trading/v1/options/ws/demo";
const TZ = "America/Sao_Paulo";
const RESEARCH_MAX_TICKS = 5000;
const RESEARCH_RETRIES = 3;

export class ExecutorState {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/run") {
      const result = await runCycle(this.state, this.env);
      return Response.json(result);
    }
    if (url.pathname === "/state") {
      const runtime = (await this.state.storage.get("runtime")) || defaultState();
      return Response.json(safeRuntime(runtime));
    }
    return new Response("Not found", { status: 404 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "kell-quant-lab",
        environment: "DEMO_ONLY",
        worker_mode: "scheduled_executor",
        research_gateway: true,
        public_market_data_endpoints: PUBLIC_WS_ENDPOINTS.length,
        strategy: { name: strategy.name, version: strategy.version, status: strategy.status },
        execution_enabled: Boolean(strategy.execution_enabled),
        research_approved: Boolean(strategy.research_approved),
        deriv_app_id_configured: Boolean(env.DERIV_APP_ID),
        deriv_token_configured: Boolean(env.DERIV_TOKEN),
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/research/connection-check") {
      return researchConnectionCheck();
    }

    if (url.pathname === "/research/active-symbols") {
      return researchActiveSymbols();
    }

    if (url.pathname === "/research/ticks-history") {
      return researchTicksHistory(url);
    }

    if (url.pathname === "/deriv-check") {
      try {
        const account = await getDemoAccount(env);
        return json({
          ok: true,
          environment: "DEMO_ONLY",
          account_type: String(account.account_type || "").toLowerCase(),
          note: "Credenciais válidas. Identificadores e dados financeiros não são expostos.",
        });
      } catch (error) {
        return json({ ok: false, environment: "DEMO_ONLY", error: safeError(error) }, 502);
      }
    }

    if (url.pathname === "/executor-state") {
      const id = env.EXECUTOR_STATE.idFromName("primary");
      const stub = env.EXECUTOR_STATE.get(id);
      return stub.fetch("https://executor.internal/state");
    }

    return json({
      service: "Kell Quant Lab Worker",
      status: "online",
      environment: "DEMO_ONLY",
      mode: "scheduled_executor",
      schedule: "every minute",
      research_gateway: {
        connection_check: "/research/connection-check",
        active_symbols: "/research/active-symbols",
        ticks_history: "/research/ticks-history?symbol=1HZ100V&count=100",
      },
      strategy: strategy.name,
      version: strategy.version,
      trading_gate: strategy.execution_enabled && strategy.research_approved ? "OPEN" : "LOCKED",
    });
  },

  async scheduled(_controller, env, ctx) {
    const id = env.EXECUTOR_STATE.idFromName("primary");
    const stub = env.EXECUTOR_STATE.get(id);
    ctx.waitUntil(stub.fetch("https://executor.internal/run"));
  },
};

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function researchConnectionCheck() {
  const started = Date.now();
  try {
    const result = await publicMarketRequest({
      active_symbols: "brief",
      req_id: 9001,
    }, "active_symbols");
    const symbols = result.message?.active_symbols || [];
    return json({
      ok: true,
      source: "DERIV_PUBLIC_WEBSOCKET",
      endpoint: result.endpoint,
      attempt: result.attempt,
      active_symbols_count: symbols.length,
      elapsed_ms: Date.now() - started,
      acquired_at: new Date().toISOString(),
    });
  } catch (error) {
    return json({
      ok: false,
      source: "DERIV_PUBLIC_WEBSOCKET",
      error: safeError(error),
      elapsed_ms: Date.now() - started,
      acquired_at: new Date().toISOString(),
    }, 502);
  }
}

async function researchActiveSymbols() {
  try {
    const result = await publicMarketRequest({
      active_symbols: "brief",
      req_id: 9002,
    }, "active_symbols");
    return json({
      ok: true,
      source: "DERIV_PUBLIC_WEBSOCKET",
      endpoint: result.endpoint,
      attempt: result.attempt,
      acquired_at: new Date().toISOString(),
      active_symbols: result.message?.active_symbols || [],
    });
  } catch (error) {
    return json({ ok: false, error: safeError(error), acquired_at: new Date().toISOString() }, 502);
  }
}

async function researchTicksHistory(url) {
  const symbol = String(url.searchParams.get("symbol") || "").trim();
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(symbol)) {
    return json({ ok: false, error: "Parâmetro symbol ausente ou inválido." }, 400);
  }

  const requestedCount = Number(url.searchParams.get("count") || 1000);
  if (!Number.isInteger(requestedCount) || requestedCount < 2 || requestedCount > RESEARCH_MAX_TICKS) {
    return json({ ok: false, error: `count deve ser inteiro entre 2 e ${RESEARCH_MAX_TICKS}.` }, 400);
  }

  const rawEnd = String(url.searchParams.get("end") || "latest").trim();
  const end = rawEnd === "latest" ? "latest" : Number(rawEnd);
  if (end !== "latest" && (!Number.isInteger(end) || end <= 0)) {
    return json({ ok: false, error: "end deve ser 'latest' ou epoch inteiro positivo." }, 400);
  }

  try {
    const result = await publicMarketRequest({
      ticks_history: symbol,
      count: requestedCount,
      end,
      style: "ticks",
      req_id: 9003,
    }, "history");
    const history = result.message?.history || {};
    return json({
      ok: true,
      source: "DERIV_PUBLIC_WEBSOCKET",
      endpoint: result.endpoint,
      attempt: result.attempt,
      acquired_at: new Date().toISOString(),
      request: { symbol, count: requestedCount, end, style: "ticks" },
      history,
    });
  } catch (error) {
    return json({
      ok: false,
      source: "DERIV_PUBLIC_WEBSOCKET",
      request: { symbol, count: requestedCount, end, style: "ticks" },
      error: safeError(error),
      acquired_at: new Date().toISOString(),
    }, 502);
  }
}

async function publicMarketRequest(payload, expected) {
  const errors = [];
  let attempt = 0;

  for (let round = 0; round < RESEARCH_RETRIES; round += 1) {
    for (const endpoint of PUBLIC_WS_ENDPOINTS) {
      attempt += 1;
      try {
        const message = await oneShotWs(endpoint, payload, expected);
        return { message, endpoint, attempt };
      } catch (error) {
        errors.push(`${endpoint}: ${safeError(error)}`);
      }
    }
    if (round < RESEARCH_RETRIES - 1) await sleep(250 * (2 ** round));
  }

  throw new Error(`Falha em todas as rotas públicas após ${attempt} tentativas. ${errors.join(" | ")}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultState() {
  return {
    local_date: localDate(),
    trades_today: 0,
    total_trades: 0,
    daily_realized_pnl: 0,
    total_realized_pnl: 0,
    wins: 0,
    losses: 0,
    peak_realized_pnl: 0,
    max_drawdown: 0,
    last_trade_at: null,
    last_cycle_at: null,
    last_signal: "WAIT",
    last_note: "Executor inicializado e aguardando ciclo.",
    tracked_contracts: [],
  };
}

function safeRuntime(runtime) {
  return {
    environment: "DEMO_ONLY",
    strategy: strategy.name,
    version: strategy.version,
    execution_enabled: Boolean(strategy.execution_enabled),
    research_approved: Boolean(strategy.research_approved),
    local_date: runtime.local_date,
    trades_today: runtime.trades_today,
    total_trades: runtime.total_trades,
    daily_realized_pnl: runtime.daily_realized_pnl,
    total_realized_pnl: runtime.total_realized_pnl,
    wins: runtime.wins,
    losses: runtime.losses,
    max_drawdown: runtime.max_drawdown,
    open_tracked_contracts: (runtime.tracked_contracts || []).length,
    last_trade_at: runtime.last_trade_at,
    last_cycle_at: runtime.last_cycle_at,
    last_signal: runtime.last_signal,
    last_note: runtime.last_note,
  };
}

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function validateConfiguration() {
  if (risk.environment !== "DEMO_ONLY" || risk.real_money_allowed !== false || risk.fail_closed !== true) {
    throw new Error("SAFETY: configuração de risco não está em DEMO_ONLY fail-closed");
  }
  if (strategy.status !== "CHAMPION") return { open: false, reason: "Estratégia não é CHAMPION" };
  if (!strategy.research_approved) return { open: false, reason: "Aprovação científica ainda bloqueada" };
  if (!strategy.execution_enabled) return { open: false, reason: "Execução automática desativada" };
  if (Number(strategy.stake_usd) <= 0 || Number(strategy.stake_usd) > Number(risk.max_stake_usd)) {
    throw new Error("SAFETY: stake viola limite configurado");
  }
  if (!Number.isInteger(Number(strategy.duration)) || Number(strategy.duration) <= 0) {
    throw new Error("Duração inválida");
  }
  if (!["t", "s", "m", "h", "d"].includes(strategy.duration_unit)) throw new Error("Unidade de duração inválida");
  if (!["CALL", "PUT"].includes(strategy.contract_up) || !["CALL", "PUT"].includes(strategy.contract_down)) {
    throw new Error("Contratos direcionais inválidos");
  }
  return { open: true, reason: "Gate de execução aberto" };
}

async function runCycle(storageState, env) {
  let runtime = (await storageState.storage.get("runtime")) || defaultState();
  const today = localDate();
  if (runtime.local_date !== today) {
    runtime.local_date = today;
    runtime.trades_today = 0;
    runtime.daily_realized_pnl = 0;
  }

  runtime.last_cycle_at = new Date().toISOString();
  const gate = validateConfiguration();

  if (!gate.open) {
    runtime.last_signal = "WAIT";
    runtime.last_note = `Bloqueado com segurança: ${gate.reason}. Nenhum motor de estratégia é executado sem Champion.`;
    await storageState.storage.put("runtime", runtime);
    console.log(JSON.stringify({ event: "cycle", mode: "LOCKED", signal: "WAIT", reason: gate.reason }));
    return safeRuntime(runtime);
  }

  const market = await calculateSignal();
  runtime.last_signal = market.signal;

  const ws = await openAuthenticatedDemoSocket(env);
  try {
    runtime = await reconcileTracked(ws, runtime);
    const portfolio = await sendAndWait(ws, { portfolio: 1, req_id: 401 }, "portfolio");
    const openContracts = portfolio?.portfolio?.contracts || [];

    const riskCheck = canTrade(runtime, openContracts);
    if (market.signal === "WAIT") {
      runtime.last_note = "Robô Demo ativo. Nenhum cruzamento novo neste ciclo.";
    } else if (!riskCheck.ok) {
      runtime.last_note = `Sinal ${market.signal} detectado, mas a trava de risco bloqueou: ${riskCheck.reason}.`;
    } else {
      const contractType = market.signal === "CALL" ? strategy.contract_up : strategy.contract_down;
      const contractId = await placeTrade(ws, contractType);
      const stamp = new Date().toISOString();
      runtime.trades_today += 1;
      runtime.total_trades += 1;
      runtime.last_trade_at = stamp;
      runtime.tracked_contracts.push({
        contract_id: contractId,
        opened_at: stamp,
        signal: market.signal,
        contract_type: contractType,
        strategy: strategy.name,
        version: strategy.version,
      });
      runtime.last_note = `Ordem ${contractType} de US$ ${Number(strategy.stake_usd).toFixed(2)} aceita na Deriv Demo.`;
      console.log(JSON.stringify({ event: "demo_trade", contract_type: contractType, strategy: strategy.version, timestamp: stamp }));
    }
  } finally {
    try { ws.close(1000, "cycle complete"); } catch (_) {}
  }

  await storageState.storage.put("runtime", runtime);
  return safeRuntime(runtime);
}

function canTrade(runtime, openContracts) {
  if ((openContracts || []).length >= Number(risk.max_open_positions)) return { ok: false, reason: "limite de posições abertas" };
  if (runtime.trades_today >= Number(risk.max_trades_per_day)) return { ok: false, reason: "limite diário de operações" };
  if (runtime.daily_realized_pnl <= -Math.abs(Number(risk.max_daily_loss_usd))) return { ok: false, reason: "limite de perda diária" };
  if (runtime.last_trade_at) {
    const elapsedMs = Date.now() - Date.parse(runtime.last_trade_at);
    if (elapsedMs < Number(risk.cooldown_minutes) * 60_000) return { ok: false, reason: "cooldown" };
  }
  return { ok: true };
}

async function calculateSignal() {
  if (strategy.signal_engine !== "SMA_CROSSOVER") throw new Error("Signal engine não suportado pelo executor atual");
  const fastN = Number(strategy.fast_window);
  const slowN = Number(strategy.slow_window);
  if (!(fastN > 0 && slowN > fastN)) throw new Error("Janelas SMA inválidas");

  const count = Math.max(slowN + 2, 40);
  const result = await publicMarketRequest({
    ticks_history: strategy.market,
    count,
    end: "latest",
    style: "ticks",
    req_id: 101,
  }, "history");

  const prices = (result.message?.history?.prices || []).map(Number).filter(Number.isFinite);
  if (prices.length < slowN + 1) throw new Error("Histórico insuficiente");

  const currentFast = sma(prices, fastN);
  const currentSlow = sma(prices, slowN);
  const previous = prices.slice(0, -1);
  const previousFast = sma(previous, fastN);
  const previousSlow = sma(previous, slowN);

  let signal = "WAIT";
  if (previousFast <= previousSlow && currentFast > currentSlow) signal = "CALL";
  else if (previousFast >= previousSlow && currentFast < currentSlow) signal = "PUT";

  return { signal, currentFast, currentSlow, previousFast, previousSlow };
}

function sma(values, n) {
  const part = values.slice(-n);
  return part.reduce((sum, value) => sum + value, 0) / n;
}

async function getDemoAccount(env) {
  if (!env.DERIV_APP_ID || !env.DERIV_TOKEN) throw new Error("Secrets Deriv ausentes");
  const response = await fetch(`${API}/trading/v1/options/accounts`, {
    headers: authHeaders(env),
  });
  if (!response.ok) throw new Error(`Deriv accounts HTTP ${response.status}`);
  const payload = await response.json();
  const accounts = extractAccounts(payload);
  const demos = accounts.filter((a) => String(a.account_type || "").toLowerCase() === "demo" && a.account_id);
  if (demos.length < 1) throw new Error("SAFETY: nenhuma conta Options explicitamente demo encontrada");
  return demos[0];
}

function extractAccounts(payload) {
  const data = payload?.data ?? payload;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const key of ["accounts", "items", "data"]) if (Array.isArray(data[key])) return data[key];
    if (data.account_id) return [data];
  }
  return [];
}

function authHeaders(env) {
  return {
    Authorization: `Bearer ${env.DERIV_TOKEN}`,
    "Deriv-App-ID": env.DERIV_APP_ID,
    Accept: "application/json",
  };
}

async function openAuthenticatedDemoSocket(env) {
  const account = await getDemoAccount(env);
  const response = await fetch(`${API}/trading/v1/options/accounts/${encodeURIComponent(account.account_id)}/otp`, {
    method: "POST",
    headers: authHeaders(env),
  });
  if (!response.ok) throw new Error(`OTP HTTP ${response.status}`);
  const payload = await response.json();
  const wsUrl = payload?.data?.url;
  validateDemoWsUrl(wsUrl);
  return openWebSocket(wsUrl);
}

function validateDemoWsUrl(wsUrl) {
  if (!wsUrl) throw new Error("OTP não retornou URL WebSocket");
  const parsed = new URL(wsUrl);
  if (parsed.protocol !== "wss:" || parsed.hostname !== "api.derivws.com" || parsed.pathname !== DEMO_WS_PATH || !parsed.searchParams.get("otp")) {
    throw new Error("SAFETY ABORT: URL autenticada não é endpoint DEMO exato");
  }
}

async function reconcileTracked(ws, runtime) {
  const remaining = [];
  for (const item of runtime.tracked_contracts || []) {
    const msg = await sendAndWait(ws, {
      proposal_open_contract: 1,
      contract_id: item.contract_id,
      req_id: 500,
    }, "proposal_open_contract");
    const contract = msg?.proposal_open_contract || {};
    if (contract.is_sold || contract.is_expired) {
      const profit = Number(contract.profit || 0);
      runtime.daily_realized_pnl = round2(runtime.daily_realized_pnl + profit);
      runtime.total_realized_pnl = round2(runtime.total_realized_pnl + profit);
      if (profit > 0) runtime.wins += 1;
      if (profit < 0) runtime.losses += 1;
      runtime.peak_realized_pnl = Math.max(runtime.peak_realized_pnl, runtime.total_realized_pnl);
      runtime.max_drawdown = Math.max(runtime.max_drawdown, round2(runtime.peak_realized_pnl - runtime.total_realized_pnl));
    } else {
      remaining.push(item);
    }
  }
  runtime.tracked_contracts = remaining;
  return runtime;
}

async function placeTrade(ws, contractType) {
  const proposalMsg = await sendAndWait(ws, {
    proposal: 1,
    amount: Number(strategy.stake_usd),
    basis: "stake",
    contract_type: contractType,
    currency: strategy.currency,
    duration: Number(strategy.duration),
    duration_unit: strategy.duration_unit,
    underlying_symbol: strategy.market,
    req_id: 601,
  }, "proposal");

  const proposal = proposalMsg?.proposal || {};
  if (!proposal.id || proposal.ask_price == null) throw new Error("Proposta incompleta; nenhuma ordem enviada");
  const buyMsg = await sendAndWait(ws, {
    buy: proposal.id,
    price: Number(proposal.ask_price),
    req_id: 602,
  }, "buy");
  const contractId = buyMsg?.buy?.contract_id;
  if (!contractId) throw new Error("Compra não retornou contract_id");
  return contractId;
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function safeError(error) {
  return error instanceof Error ? error.message : "erro desconhecido";
}

async function oneShotWs(url, payload, expected) {
  const ws = await openWebSocket(url);
  try {
    return await sendAndWait(ws, payload, expected);
  } finally {
    try { ws.close(1000, "done"); } catch (_) {}
  }
}

function openWebSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try { ws.close(1011, "open timeout"); } catch (_) {}
      reject(new Error("WebSocket open timeout"));
    }, 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(ws);
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("WebSocket connection error"));
    }, { once: true });
  });
}

function sendAndWait(ws, payload, expected, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const reqId = payload.req_id;
    const timer = setTimeout(() => cleanupReject(new Error(`WebSocket timeout esperando ${expected}`)), timeoutMs);

    const onMessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }
      if (reqId != null && msg.req_id != null && msg.req_id !== reqId) return;
      if (msg.error) return cleanupReject(new Error(msg.error.message || "Deriv WebSocket error"));
      if (msg.msg_type === expected || Object.prototype.hasOwnProperty.call(msg, expected)) return cleanupResolve(msg);
    };

    const onClose = () => cleanupReject(new Error("WebSocket fechado antes da resposta"));
    const onError = () => cleanupReject(new Error("WebSocket error"));

    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
      ws.removeEventListener("close", onClose);
      ws.removeEventListener("error", onError);
    }
    function cleanupResolve(value) { cleanup(); resolve(value); }
    function cleanupReject(error) { cleanup(); reject(error); }

    ws.addEventListener("message", onMessage);
    ws.addEventListener("close", onClose);
    ws.addEventListener("error", onError);
    ws.send(JSON.stringify(payload));
  });
}