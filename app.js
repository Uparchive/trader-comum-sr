/* Kell Quant Lab V4 interface: read-only projections of canonical state and Worker telemetry. */
const LIVE_ENDPOINT = "https://kell-quant-lab.kesllyalbuquerque.workers.dev/executor-state";
const CYCLE_DAYS = 90;
const TZ = "America/Sao_Paulo";
const $ = (selector) => document.querySelector(selector);
let evidence = [];
let state = null;
const evidenceCache = new Map();
let PUBLIC_TICKS_ENDPOINT = null;
let publicTickSocket = null;
let publicTickMarket = null;
let publicTickRetry = null;
let publicTickAttempts = 0;
let liveTelemetry = null;

function publicFeedActive(market) {
  return publicTickMarket === market && publicTickSocket?.readyState === WebSocket.OPEN;
}
function setTickSource(message) {
  const target = $("#tick-source");
  if (target) target.textContent = message;
}
function stopPublicTickFeed() {
  if (publicTickRetry) { clearTimeout(publicTickRetry); publicTickRetry = null; }
  const socket = publicTickSocket;
  publicTickSocket = null;
  publicTickMarket = null;
  publicTickAttempts = 0;
  try { socket?.close(1000, "market changed"); } catch (_) {}
}
function schedulePublicTickReconnect(market) {
  if (publicTickRetry || publicTickMarket !== market) return;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(publicTickAttempts, 5));
  publicTickRetry = setTimeout(() => {
    publicTickRetry = null;
    connectPublicTickFeed(market);
  }, delay);
}
function connectPublicTickFeed(market) {
  if (!PUBLIC_TICKS_ENDPOINT || !market || publicTickMarket !== market || publicTickSocket) return;
  const socket = new WebSocket(PUBLIC_TICKS_ENDPOINT);
  publicTickSocket = socket;
  socket.addEventListener("open", () => {
    if (publicTickSocket !== socket) return;
    publicTickAttempts = 0;
    socket.send(JSON.stringify({ op: "subscribe", args: [{ channel: "tickers", instId: market }] }));
    setTickSource("Feed público conectado · aguardando tick real");
  });
  socket.addEventListener("message", (event) => {
    if (publicTickSocket !== socket) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch (_) { return; }
    const tick = payload?.data?.[0];
    if (payload?.arg?.channel !== "tickers" || payload?.arg?.instId !== market || !tick || tick.last == null || tick.ts == null) return;
    $("#tick").textContent = String(tick.last);
    $("#tick-time").textContent = `Preço público ao vivo · ${timeText(tick.ts)}`;
    setTickSource("Feed público do provider ativo · somente leitura");
  });
  socket.addEventListener("error", () => { setTickSource("Feed público indisponível · usando telemetria disponível"); });
  socket.addEventListener("close", () => {
    if (publicTickSocket !== socket) return;
    publicTickSocket = null;
    publicTickAttempts += 1;
    setTickSource("Feed público reconectando · sem preço interpolado");
    schedulePublicTickReconnect(market);
  });
}
function startPublicTickFeed(market) {
  if (!PUBLIC_TICKS_ENDPOINT || !market) { stopPublicTickFeed(); return; }
  if (publicTickMarket === market && (publicTickSocket || publicTickRetry)) return;
  stopPublicTickFeed();
  publicTickMarket = market;
  connectPublicTickFeed(market);
}
window.addEventListener("beforeunload", stopPublicTickFeed);


async function get(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`Falha ao carregar ${path}`);
  return response.json();
}
function spDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function parseDate(value) { return new Date(`${String(value).slice(0, 10)}T00:00:00Z`); }
function dateText(value) {
  if (!value) return "—";
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const [year, month, day] = iso.split("-");
  const names = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];
  return year && names[Number(month) - 1] && day ? `${day} ${names[Number(month) - 1]} ${year}` : "—";
}
function timeText(value) {
  if (!value) return "—";
  const date = parseTimestamp(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}
function parseTimestamp(value) {
  if (!value) return null;
  if (typeof value === "number" || /^\d+(\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function isStaleTick(data, maxAgeMs = 120000) {
  const tickAt = parseTimestamp(data?.tick_timestamp);
  const feedAt = parseTimestamp(data?.timestamp) || new Date();
  if (!tickAt) return true;
  return data?.tick_stale === true || feedAt.getTime() - tickAt.getTime() > maxAgeMs;
}
function money(value) {
  return value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));
}
function human(status) {
  return ({ WAITING_SIGNAL: "AGUARDANDO SINAL", EXECUTING: "EXECUTANDO", MONITORING: "MONITORANDO", SETTLING: "LIQUIDANDO", TECHNICAL_FAIL_CLOSED: "FALHA TÉCNICA", PLATFORM_REJECTED: "PLATAFORMA REJEITADA", PLATFORM_SUSPECT: "PLATAFORMA SOB INVESTIGAÇÃO", PLATFORM_UNDER_INVESTIGATION: "PLATAFORMA SOB INVESTIGAÇÃO" }[status] || status || "—");
}
function text(value) { return value === null || value === undefined || value === "" ? "—" : String(value); }
function cycleInfo(startAt) {
  if (!startAt) return null;
  const start = parseDate(startAt);
  const today = parseDate(spDate());
  const elapsed = Math.max(0, Math.floor((today - start) / 86400000));
  const cycle = Math.floor(elapsed / CYCLE_DAYS) + 1;
  const day = (elapsed % CYCLE_DAYS) + 1;
  const cycleStart = new Date(start.getTime() + (cycle - 1) * CYCLE_DAYS * 86400000).toISOString().slice(0, 10);
  const review = new Date(parseDate(cycleStart).getTime() + (CYCLE_DAYS - 1) * 86400000).toISOString().slice(0, 10);
  return { cycle, day, remaining: CYCLE_DAYS - day, cycleStart, review };
}
function renderCycle(startAt) {
  const cycle = cycleInfo(startAt);
  if (!cycle) return;
  $("#cycle-number").textContent = `Ciclo ${cycle.cycle}`;
  $("#cycle-day").textContent = `Dia ${cycle.day} de ${CYCLE_DAYS}`;
  $("#cycle-progress").style.width = `${(cycle.day / CYCLE_DAYS) * 100}%`;
  $("#cycle-range").textContent = `${dateText(cycle.cycleStart)} → ${dateText(cycle.review)}`;
  $("#cycle-remaining").textContent = cycle.remaining === 0 ? "Revisão hoje" : `${cycle.remaining} dias restantes`;
  const maintenance = $("#deriv-maintenance");
  maintenance.className = "maintenance";
  if (cycle.remaining === 0) { maintenance.classList.add("due"); maintenance.textContent = "REVISÃO DA CREDENCIAL DO PROVIDER · Verifique e realize a rotação segura se necessária."; }
  else if (cycle.remaining === 1) { maintenance.classList.add("attention"); maintenance.textContent = "REVISÃO AMANHÃ · Preparar rotação segura da credencial do provider."; }
  else if (cycle.remaining <= 7) { maintenance.classList.add("attention"); maintenance.textContent = `ATENÇÃO · Revisão preventiva da credencial do provider em ${cycle.remaining} dias.`; }
  else maintenance.textContent = `MANUTENÇÃO DO PROVIDER · Próxima revisão preventiva: ${dateText(cycle.review)} · faltam ${cycle.remaining} dias.`;
}
function renderState(current) {
  state = current;
  $("#as-of").textContent = current.timestamp ? `Estado materializado · ${timeText(current.timestamp)}` : "Estado materializado";
  $("#balance").textContent = money(current.balance);
  $("#equity").textContent = money(current.equity);
  $("#pnl").textContent = current.pnl_today == null ? "—" : `${Number(current.pnl_today) >= 0 ? "+" : ""}${money(current.pnl_today)}`;
  $("#drawdown").textContent = current.drawdown == null ? "—" : `${Number(current.drawdown).toFixed(2)}%`;
  $("#executor").textContent = human(current.executor_status);
  $("#strategy").textContent = current.operational_strategy?.version || "—";
  $("#market").textContent = current.selected_markets?.join(" · ") || "—";
  $("#capital-policy").textContent = current.capital_policy?.version || "—";
  $("#open-summary").textContent = "Nenhuma operação aberta";
  renderCycle(current.v4_started_at);
}
function evidenceDate(item) { return item.date || item.timestamp || item.created_at || ""; }
function decision(item) { return item.decision || item.status || item.next_step || "—"; }
function evidenceTimestamp(item) {
  const value = String(evidenceDate(item)).slice(0, 10);
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}
function renderLatest(items) {
  const target = $("#latest-evidence");
  const item = items[0];
  if (!item) { target.textContent = "Nenhuma evidência materializada disponível."; return; }
  target.classList.remove("empty");
  target.innerHTML = `<time>${dateText(evidenceDate(item))}</time><div><h3>${escapeHtml(item.title || item.id || "Registro sem título")}</h3><p>${escapeHtml(item.summary || item.observation || item.description || "Evidência materializada disponível para consulta.")}</p></div><span class="decision">${escapeHtml(decision(item))}</span>`;
  target.onclick = () => openEvidence(item);
}
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])); }
function filteredEvidence() {
  const from = $("#date-from").value;
  const to = $("#date-to").value;
  const order = $("#evidence-order")?.value || "newest";
  return evidence
    .filter((item) => { const date = String(evidenceDate(item)).slice(0, 10); return (!from || date >= from) && (!to || date <= to); })
    .sort((a, b) => order === "oldest" ? evidenceTimestamp(a) - evidenceTimestamp(b) : evidenceTimestamp(b) - evidenceTimestamp(a));
}
function renderEvidence() {
  const rows = filteredEvidence();
  const target = $("#evidence-list");
  if (!rows.length) { target.innerHTML = '<tr><td colspan="6" class="empty">Nenhuma evidência neste intervalo.</td></tr>'; return; }
  target.innerHTML = rows.map((item, index) => `<tr data-evidence="${index}"><td>${dateText(evidenceDate(item))}</td><td>${escapeHtml(item.cycle || item.current_cycle || "—")}</td><td>${escapeHtml(item.title || item.id || "Registro")}</td><td>${escapeHtml(item.market || item.selected_market || "—")}</td><td>${escapeHtml(item.strategy_version || item.strategy || "—")}</td><td><span class="decision">${escapeHtml(decision(item))}</span></td></tr>`).join("");
  target.querySelectorAll("tr[data-evidence]").forEach((row) => row.addEventListener("click", () => openEvidence(rows[Number(row.dataset.evidence)])));
}
function evidenceGitHubUrl(path) {
  if (!path || !/^evidence\/[\w./-]+\.json$/i.test(path)) return null;
  return `https://github.com/Uparchive/kell-quant-lab/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function renderEvidenceDialog(item) {
  const dialog = $("#evidence-dialog");
  const sections = [["Contexto", item.context], ["Pergunta", item.question], ["Hipótese", item.hypothesis], ["Metodologia", item.methodology || item.method], ["Observação", item.observation || item.summary], ["Evidência", item.evidence], ["Resultados", item.results], ["Interpretação", item.analysis], ["Decisão", item.decision], ["Próximo passo", item.next_step]]
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([heading, value]) => `<section class="dialog-section"><h3>${heading}</h3><p>${escapeHtml(typeof value === "string" ? value : JSON.stringify(value, null, 2))}</p></section>`).join("");
  const technical = item.technical || item.provenance;
  const github = evidenceGitHubUrl(item.path);
  const technicalDetails = technical ? `<details class="dialog-technical"><summary>Detalhes técnicos</summary><pre>${escapeHtml(JSON.stringify(technical, null, 2))}</pre></details>` : "";
  const actions = github ? `<div class="dialog-actions"><a href="${github}" target="_blank" rel="noopener noreferrer">Ver evidência no GitHub <span aria-hidden="true">↗</span></a></div>` : "";
  $("#dialog-content").innerHTML = `<div class="eyebrow">${dateText(evidenceDate(item))} · ${escapeHtml(item.cycle || "Evidência")}</div><h2 id="dialog-title" class="dialog-title">${escapeHtml(item.title || item.evidence_id || item.id || "Registro")}</h2>${sections || '<p class="empty">Detalhes ainda não foram materializados.</p>'}${technicalDetails}${actions}`;
}
async function openEvidence(item) {
  const dialog = $("#evidence-dialog");
  renderEvidenceDialog(item);
  if (!dialog.open) dialog.showModal();
  if (!item.path || evidenceCache.has(item.path)) {
    if (item.path && evidenceCache.has(item.path)) renderEvidenceDialog({ ...item, ...evidenceCache.get(item.path) });
    return;
  }
  $("#dialog-content").setAttribute("aria-busy", "true");
  try {
    const fullEvidence = await get(item.path);
    evidenceCache.set(item.path, fullEvidence);
    renderEvidenceDialog({ ...item, ...fullEvidence, path: item.path });
  } catch {
    // The materialized index remains a safe read-only fallback.
  } finally {
    $("#dialog-content").removeAttribute("aria-busy");
  }
}
function renderPerformance(performance) {
  if (!performance || performance.environment && performance.environment !== "DEMO_ONLY") return;
  const today = performance.daily?.[spDate()] || {}, month = performance.monthly?.[spDate().slice(0, 7)] || {}, summary = performance.summary || {};
  const signed = (value) => Number.isFinite(Number(value)) ? (Number(value) >= 0 ? "+" : "") + money(value) : "—";
  const pct = (value) => Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(1) + "%" : "—";
  $("#performance-today").textContent = signed(today.realized_pnl); $("#performance-month").textContent = signed(month.realized_pnl); $("#performance-total").textContent = signed(summary.realized_pnl); $("#performance-trades").textContent = Number.isFinite(Number(month.trades)) ? String(month.trades) : "—"; $("#performance-winrate").textContent = pct(month.win_rate); $("#performance-drawdown").textContent = money(summary.max_realized_drawdown);
  const rows = (entries) => entries.length ? entries.map(([key, row]) => "<tr><td>" + escapeHtml(key.length === 10 ? dateText(key) : key) + "</td><td>" + escapeHtml(row.trades ?? "—") + "</td><td class=\"" + (Number(row.realized_pnl) > 0 ? "positive" : Number(row.realized_pnl) < 0 ? "negative" : "") + "\">" + signed(row.realized_pnl) + "</td></tr>").join("") : '<tr><td colspan="3" class="empty">Aguardando primeiro trade reconciliado.</td></tr>';
  $("#performance-daily").innerHTML = rows(Object.entries(performance.daily || {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 14));
  $("#performance-monthly").innerHTML = rows(Object.entries(performance.monthly || {}).sort(([a], [b]) => b.localeCompare(a)).slice(0, 12));
}

function updateOverviewFromLive(data) {
  $("#balance").textContent = money(data.balance);
  $("#equity").textContent = money(data.equity);
  const official = data.performance?.summary, today = data.performance?.daily?.[spDate()];
  $("#pnl").textContent = today?.realized_pnl == null ? "—" : `${Number(today.realized_pnl) >= 0 ? "+" : ""}${money(today.realized_pnl)}`;
  $("#drawdown").textContent = official?.max_realized_drawdown == null ? "—" : money(official.max_realized_drawdown);
  $("#executor").textContent = human(data.status);
  $("#strategy").textContent = data.strategy_version || state?.operational_strategy?.version || "—";
  $("#market").textContent = data.active_market || data.selected_markets?.join(" · ") || "—";
  $("#capital-policy").textContent = data.capital_policy_version || state?.capital_policy?.version || "—";
  $("#open-summary").textContent = data.open_contract ? "Em andamento" : "Nenhuma operação aberta";
}
function renderMarketTabs(markets, active) {
  $("#market-tabs").innerHTML = (markets || []).map((market) => `<button type="button" class="${market === active ? "active" : ""}" aria-pressed="${market === active}">${escapeHtml(market)}</button>`).join("");
}
function renderOpenContract(contract, tick) {
  const target = $("#open-contract");
  if (!contract) { target.className = "open-contract"; target.innerHTML = "Nenhuma operação aberta<br><small>Executor aguardando sinal.</small>"; return; }
  const entry=Number(contract.entry_price), qty=Number(contract.qty), price=Number(tick), pnl=Number.isFinite(entry)&&Number.isFinite(qty)&&Number.isFinite(price)?(price-entry)*qty:null;
  target.className = "open-contract active";
  target.innerHTML = `<strong>OPERAÇÃO DEMO EM ANDAMENTO</strong><br>${escapeHtml(contract.instrument || contract.market || "—")} · BUY Spot<br><small>Entrada ${money(entry)} · Agora ${money(price)}<br>Posição ${money(contract.notional ?? entry*qty)} · P&L não realizado ${pnl===null?"—":(pnl>=0?"+":"")+money(pnl)}<br>Stop ${money(contract.stop_price)} · Alvo ${money(contract.target_price)}</small>`;
}
function renderEvents(items) {
  const target = $("#events");
  if (!items?.length) { target.innerHTML = '<li class="empty">Nenhum evento operacional disponível.</li>'; return; }
  target.innerHTML = items.slice(0, 8).map((item) => `<li><time>${timeText(item.timestamp || item.at)}</time><div><strong>${escapeHtml(item.label || item.type || "EVENTO")}</strong><small>${escapeHtml(item.market || "")} ${escapeHtml(item.detail || item.message || "")}</small></div></li>`).join("");
}
function renderTrades(items) {
  const target = $("#trades");
  if (!items?.length) { target.innerHTML = '<tr><td colspan="6" class="empty">Nenhuma operação disponível.</td></tr>'; return; }
  target.innerHTML = items.slice(0, 8).map((trade) => { const reconciled = trade.reconciliation_status === "RECONCILED"; const pnl = Number(trade.net_realized_pnl ?? trade.pnl); const result = reconciled ? (trade.result || (pnl > 0 ? "WIN" : pnl < 0 ? "LOSS" : "FLAT")) : "NÃO RECONCILIADO"; return `<tr><td>${timeText(trade.timestamp || trade.closed_at)}</td><td>${escapeHtml(trade.market || trade.instrument || "—")}</td><td>${escapeHtml(trade.strategy_version || "—")}</td><td>${money(trade.stake ?? trade.notional ?? trade.aposta)}</td><td class="${result === "WIN" ? "positive" : result === "LOSS" ? "negative" : ""}">${escapeHtml(result)}</td><td class="${reconciled && pnl > 0 ? "positive" : reconciled && pnl < 0 ? "negative" : ""}">${reconciled && Number.isFinite(pnl) ? `${pnl >= 0 ? "+" : ""}${money(pnl)}` : "—"}</td></tr>`; }).join("");
}
function sanitizeDiagnostic(value) {
  return String(value || "Diagnóstico técnico indisponível.")
    .replace(/([?&](?:otp|token|authorization|app_id)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/wss:\/\/([^/?\s]+)[^\s?]*(?:\?[^\s]*)?/gi, "wss://$1/[endpoint redigido]");
}
function latestDiagnostic(data) {
  const issues = Array.isArray(data.issues) ? data.issues : Array.isArray(data.problemas) ? data.problemas : [];
  const last = issues[issues.length - 1] || {};
  return {
    code: last.code || last.código || data.recovery_last_reason || "TECHNICAL_FAIL_CLOSED",
    message: sanitizeDiagnostic(last.message || last.mensagem || data.recovery_last_reason || data.recovery_last_error),
    at: last.at || last.em || data.timestamp
  };
}
function diagnosticGuidance(data, diagnostic) {
  const source = String(diagnostic.code || "") + " " + String(diagnostic.message || "");
  const upper = source.toUpperCase();
  if (data.status === "PLATFORM_REJECTED" || data.platform_state === "PLATFORM_REJECTED") return "Intervenção manual necessária: a plataforma foi bloqueada por governança. Não tente retomar ordens pelo site.";
  if (/RATE_LIMIT|COOLDOWN/.test(upper)) return "Recuperação automática: o executor está respeitando o cooldown da plataforma. Nenhuma ação manual é necessária; ele tenta novamente quando for seguro.";
  if (/WS_|WEBSOCKET|HANDSHAKE|TIMEOUT|RECONNECT/.test(upper)) return "Recuperação automática: o executor tenta reconectar com backoff. Só investigue manualmente se o mesmo diagnóstico persistir por vários ciclos.";
  if (/OTP_|ACCOUNT_API|CREDENTIAL|AUTH/.test(upper)) return "Ação manual pode ser necessária se persistir: verifique a configuração de credenciais na infraestrutura. Nunca informe token, OTP ou senha nesta tela.";
  return "Em observação: o executor permanece protegido. Aguarde o próximo ciclo; se o diagnóstico persistir, investigue a infraestrutura.";
}
function renderTechnicalInfo(data, blocked) {
  const button = $("#technical-info-toggle");
  const detail = $("#technical-info-detail");
  if (!button || !detail) return;
  if (!blocked) {
    detail.hidden = true;
    button.setAttribute("aria-expanded", "false");
    return;
  }
  const diagnostic = latestDiagnostic(data);
  detail.innerHTML = "<strong>" + escapeHtml(diagnostic.code) + "</strong><code>" + escapeHtml(diagnostic.message) + "</code><p>" + escapeHtml(diagnosticGuidance(data, diagnostic)) + "</p>" + (diagnostic.at ? "<p>Último registro: " + escapeHtml(timeText(diagnostic.at)) + ".</p>" : "");
}
function renderLive(data) {
  liveTelemetry = data;
  updateOverviewFromLive(data);
  renderPerformance(data.performance);
  const activeMarket = data.active_market || data.selected_markets?.[0] || null;
  $("#live-connection").textContent = `Telemetria · ${timeText(data.timestamp)}`;
  $("#live-status").textContent = human(data.status);
  $("#instrument-title").textContent = activeMarket || "Mercado não informado";
  $("#live-strategy").textContent = data.strategy_version || "—";
  $("#live-policy").textContent = data.capital_policy_version || "—";
  $("#signal").textContent = data.signal_state || "—";
  $("#regime").textContent = data.regime || "—";
  const staleTick = data.tick == null || isStaleTick(data);
  if (!publicFeedActive(activeMarket)) {
    $("#tick").textContent = staleTick ? "—" : String(data.tick);
    $("#tick-time").textContent = data.tick_timestamp && !staleTick
      ? `Telemetria do executor · ${timeText(data.tick_timestamp)}`
      : data.tick_timestamp ? `Tick em cache · ${timeText(data.tick_timestamp)}` : "Sem tick recebido";
    setTickSource(staleTick ? "Telemetria do executor atrasada · preço atual não é inferido" : "Telemetria do executor");
  }
  const levels = (levels, fallback) => levels?.length ? levels.map((level) => level.value ?? level.v ?? level.price ?? level).join(" · ") : fallback;
  $("#support").textContent = levels(data.support_levels, "—");
  $("#resistance").textContent = levels(data.resistance_levels, "—");
  renderMarketTabs(data.selected_markets, activeMarket);
  PUBLIC_TICKS_ENDPOINT = typeof data.public_ws_url === "string" && /^wss:\/\/wspap\.okx\.com:8443\/ws\/v5\/public$/.test(data.public_ws_url) ? data.public_ws_url : null;
  startPublicTickFeed(activeMarket);
  renderOpenContract(data.open_contract, data.tick);
  renderEvents(data.recent_events);
  renderTrades(data.recent_trades || data["negociações_recentes"]);
  const alert = $("#live-alert");
  const alertMessage = $("#live-alert-message");
  const blocked = ["TECHNICAL_FAIL_CLOSED", "PLATFORM_REJECTED", "PLATFORM_SUSPECT", "PLATFORM_UNDER_INVESTIGATION"].includes(data.status) || data.platform_state === "PLATFORM_REJECTED";
  if (blocked) {
    alert.hidden = false;
    alert.className = `operational-alert ${data.status === "TECHNICAL_FAIL_CLOSED" ? "" : "warn"}`;
    alertMessage.textContent = data.status === "PLATFORM_REJECTED" || data.platform_state === "PLATFORM_REJECTED" ? "PLATAFORMA REJEITADA · Operações interrompidas por decisão científica." : `EXECUTOR ${human(data.status)} · Nenhuma nova operação será aberta até recuperação segura.`;
  } else {
    alert.hidden = true;
    alert.className = "operational-alert";
    alertMessage.textContent = "";
    $("#technical-info-detail").hidden = true;
    $("#technical-info-toggle").setAttribute("aria-expanded", "false");
  }
  renderTechnicalInfo(data, blocked);
}
async function loadLive() {
  try { const data = await get(LIVE_ENDPOINT); renderLive(data); }
  catch { $("#live-connection").textContent = "Telemetria indisponível"; $("#live-status").textContent = "SEM CONEXÃO"; $("#instrument-title").textContent = "Dados operacionais indisponíveis"; $("#series-note").textContent = "A página não infere preços, níveis ou estado operacional quando o feed não está disponível."; }
}
function bindFilters() {
  $("#technical-info-toggle")?.addEventListener("click", () => {
    const detail = $("#technical-info-detail");
    const button = $("#technical-info-toggle");
    const open = detail.hidden;
    detail.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll("[data-range]").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.remove("selected")); button.classList.add("selected");
    const range = button.dataset.range;
    const end = spDate();
    if (range === "all") { $("#date-from").value = ""; $("#date-to").value = ""; }
    else {
      const days = range === "today" ? 1 : Number(range);
      const start = new Date(`${end}T00:00:00Z`);
      start.setUTCDate(start.getUTCDate() - (days - 1));
      $("#date-from").value = start.toISOString().slice(0, 10);
      $("#date-to").value = end;
    }
    renderEvidence();
  }));
  ["#date-from", "#date-to", "#evidence-order"].forEach((selector) => $(selector).addEventListener("change", () => { document.querySelectorAll("[data-range]").forEach((item) => item.classList.remove("selected")); renderEvidence(); }));
  $("#clear-dates").addEventListener("click", () => { $("#date-from").value = ""; $("#date-to").value = ""; document.querySelector('[data-range="all"]').classList.add("selected"); renderEvidence(); });
  $("#close-dialog").addEventListener("click", () => $("#evidence-dialog").close());
  $("#close-mobile-menu")?.addEventListener("click", () => { const menu = $(".mobile-more"); if (menu) menu.open = false; });
  $("#mobile-more-menu")?.querySelector("a")?.addEventListener("click", () => { const menu = $(".mobile-more"); if (menu) menu.open = false; });
}
async function boot() {
  bindFilters();
  try { renderState(await get("state/current.json")); } catch { $("#as-of").textContent = "Estado materializado indisponível"; }
  try { const index = await get("indexes/evidence/recent.json"); evidence = Array.isArray(index) ? index : (index.evidence || index.items || []); renderLatest(evidence); renderEvidence(); } catch { $("#latest-evidence").textContent = "Índice de evidências indisponível."; $("#evidence-list").innerHTML = '<tr><td colspan="6" class="empty">Índice de evidências indisponível.</td></tr>'; }
  await loadLive();
}
boot();
