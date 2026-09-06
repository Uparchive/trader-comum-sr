import environment from "../config/v5/okx_demo_environment.json";

const CORS={"Access-Control-Allow-Origin":"https://uparchive.github.io","Access-Control-Allow-Methods":"GET","Cache-Control":"no-store"};
const MAX_STALE_MS=120000,ORDER_TTL_MS=15000,MAX_EVENTS=40,PLAN_CACHE_MS=900000,PLAN_REFRESH_MS=60000;
const PLAN_URL="https://uparchive.github.io/kell-quant-lab/runtime/okx/active_execution_plan.json";
function json(value,status=200){return Response.json(value,{status,headers:CORS})}
function now(){return new Date().toISOString()}
function canonical(v){if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).filter(k=>k!=="plan_hash").sort().map(k=>[k,canonical(v[k])]));return v}
async function digest(v){const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(canonical(v)))));return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function loadPlan(r){const cached=r.execution_plan,age=cached?.verified_at?Date.now()-Date.parse(cached.verified_at):Infinity;if(cached&&age<PLAN_REFRESH_MS)return cached.plan;try{const res=await fetch(PLAN_URL+"?v="+Date.now(),{headers:{"Cache-Control":"no-store"}});if(!res.ok)throw new Error("MANDATE_FETCH_FAILURE: HTTP "+res.status);const plan=await res.json(),p=plan.strategy?.parameters,x=plan.strategy?.exit,c=plan.capital_policy;if(plan.environment!=="DEMO_ONLY"||plan.provider!=="OKX"||plan.state!=="ACTIVE"||plan.strategy?.engine!=="SUPPORT_RESISTANCE_V1"||!plan.market_selection?.active_instrument||!Number.isFinite(Number(p?.min_touches))||Number(p.min_touches)<2||!Number.isFinite(Number(x?.min_reward_risk))||Number(x.min_reward_risk)<1||!Number.isFinite(Number(c?.risk_per_trade_fraction))||Number(c.risk_per_trade_fraction)<=0||!Number.isFinite(Number(c?.max_position_fraction))||Number(c.max_position_fraction)<=0||Number(c.max_open_positions)!==1)throw new Error("MANDATE_INVALID: policy or authorization");if(await digest(plan)!==plan.plan_hash)throw new Error("MANDATE_INVALID: hash mismatch");r.execution_plan={plan,verified_at:now(),source:PLAN_URL};return plan}catch(e){if(cached&&age<PLAN_CACHE_MS)return cached.plan;throw e}}
function event(r,label,detail,market=r.telemetry.active_market){r.telemetry.recent_events.unshift({timestamp:now(),market,label,detail});r.telemetry.recent_events=r.telemetry.recent_events.slice(0,MAX_EVENTS)}
function performanceBase(){return {schema_version:1,provider:"OKX",environment:"DEMO_ONLY",currency:"USDT",basis:"NET_REALIZED_PNL_FROM_RECONCILED_EXECUTOR_TRADES",started_at:null,summary:{realized_pnl:0,gross_pnl:0,fees:0,trades:0,wins:0,losses:0,breakeven:0,win_rate:0,peak_realized_equity:0,max_realized_drawdown:0,strategies:{},markets:{},last_updated_at:null},daily:{},monthly:{}}}
function baseRuntime(){return {provider:"OKX",provider_environment:"DEMO",environment:"DEMO_ONLY",experimental_context_id:environment.operational_identity,status:"INITIALIZING",balance:null,equity:null,pnl_today:0,drawdown:0,performance:performanceBase(),last_cycle_at:null,last_success_at:null,last_trade_at:null,selected_markets:[],issues:[],position:null,telemetry:{active_market:null,tick:null,tick_timestamp:null,tick_stale:true,support_levels:[],resistance_levels:[],signal_state:"NO_VALID_SIGNAL",regime:"UNCLASSIFIED",recent_events:[],connection:{rest:"UNKNOWN",private_ws:"UNKNOWN",public_market_data:"UNKNOWN",auth:"UNKNOWN"},metrics:{reconnects:0,rate_limits:0,rest_requests:0,ws_messages:0,technical_degraded_ms:0}},recent_trades:[],idempotency:{},validation:{instruments:false,market_data:false,account:false,private_ws:false,order:false}}}
function runtime(raw){const migrated=raw?.provider!=="OKX";const r={...baseRuntime(),...(raw||{})};if(migrated){r.issues=[];r.recent_trades=[];r.idempotency={};r.position=null;r.telemetry=baseRuntime().telemetry;r.performance=performanceBase()}r.issues=Array.isArray(r.issues)?r.issues:[];r.selected_markets=Array.isArray(r.selected_markets)?r.selected_markets:[];r.recent_trades=Array.isArray(r.recent_trades)?r.recent_trades:[];r.idempotency=r.idempotency&&typeof r.idempotency==="object"?r.idempotency:{};r.position=r.position&&typeof r.position==="object"?r.position:null;r.performance={...performanceBase(),...(r.performance||{})};r.performance.summary={...performanceBase().summary,...(r.performance.summary||{})};r.performance.daily=r.performance.daily&&typeof r.performance.daily==="object"?r.performance.daily:{};r.performance.monthly=r.performance.monthly&&typeof r.performance.monthly==="object"?r.performance.monthly:{};r.telemetry={...baseRuntime().telemetry,...(r.telemetry||{})};r.telemetry.connection={...baseRuntime().telemetry.connection,...(r.telemetry.connection||{})};r.telemetry.metrics={...baseRuntime().telemetry.metrics,...(r.telemetry.metrics||{})};r.telemetry.support_levels=Array.isArray(r.telemetry.support_levels)?r.telemetry.support_levels:[];r.telemetry.resistance_levels=Array.isArray(r.telemetry.resistance_levels)?r.telemetry.resistance_levels:[];r.telemetry.recent_events=Array.isArray(r.telemetry.recent_events)?r.telemetry.recent_events:[];return r}
function safe(r){const supportLevels=r.telemetry.support_levels.filter(Number.isFinite),resistanceLevels=r.telemetry.resistance_levels.filter(Number.isFinite),support=supportLevels[0]??null,resistance=resistanceLevels[0]??null,plan=r.execution_plan?.plan;return {...r,executor_version:"SELL-REPAIR-20260906-v2",timestamp:now(),open_positions:r.position?1:0,open_contract:r.position,platform_state:r.status==="TECHNICAL_FAIL_CLOSED"?"PLATFORM_UNDER_INVESTIGATION":"PLATFORM_OK",public_ws_url:environment.public_ws_url,operational_strategy:plan?.strategy?.engine||"NO_VALID_MANDATE",strategy_version:plan?.strategy?.version||"NO_VALID_MANDATE",strategy_status:plan?.state||"NO_VALID_MANDATE",capital_policy_version:plan?.capital_policy?.version||"NO_VALID_MANDATE",active_mandate:plan?{plan_id:plan.plan_id,plan_hash:plan.plan_hash,verified_at:r.execution_plan.verified_at}:null,active_market:r.telemetry.active_market,signal_state:r.telemetry.signal_state,regime:r.telemetry.regime,tick:r.telemetry.tick,tick_timestamp:r.telemetry.tick_timestamp,tick_stale:r.telemetry.tick_stale,support,resistance,support_target:support,resistance_target:resistance,support_levels:supportLevels,resistance_levels:resistanceLevels,trade_plan:{support,resistance,entry_zone:support,exit_target:resistance,stop_price:r.position?.stop_price??null,take_profit_price:r.position?.target_price??null,signal:r.telemetry.signal_state,regime:r.telemetry.regime},recent_events:r.telemetry.recent_events.slice(0,30)}}
function fail(r,code,message){r.status="TECHNICAL_FAIL_CLOSED";r.issues.push({at:now(),code,message:String(message).replace(/(OK-ACCESS-(?:KEY|SIGN|PASSPHRASE)[:=]\s*)\S+/gi,"$1[REDACTED]").slice(0,240)});r.issues=r.issues.slice(-50);event(r,"FALHA TÉCNICA",code);return r}
function assertDemo(env){if(environment.environment!=="DEMO_ONLY"||environment.demo_header["x-simulated-trading"]!=="1"||environment.automatic_execution!==true)throw new Error("DEMO_GUARD_REJECTED: immutable provider configuration");if(!/^https:\/\/openapi\.okx\.com$/.test(environment.rest_base_url)||environment.private_ws_url!=="wss://wspap.okx.com:8443/ws/v5/private"||environment.public_ws_url!=="wss://wspap.okx.com:8443/ws/v5/public")throw new Error("DEMO_GUARD_REJECTED: non-demo endpoint");if(!env.OKX_API_KEY||!env.OKX_SECRET_KEY||!env.OKX_PASSPHRASE)throw new Error("CREDENTIAL_MISMATCH: missing OKX Demo credential")}
function b64(bytes){let s="";for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s)}
async function hmac(secret,prehash){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return b64(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(prehash)))}
async function privateHeaders(env,method,path,body=""){assertDemo(env);const timestamp=now(),sign=await hmac(env.OKX_SECRET_KEY,timestamp+method.toUpperCase()+path+body);return {"Content-Type":"application/json","OK-ACCESS-KEY":env.OKX_API_KEY,"OK-ACCESS-SIGN":sign,"OK-ACCESS-TIMESTAMP":timestamp,"OK-ACCESS-PASSPHRASE":env.OKX_PASSPHRASE,"x-simulated-trading":"1"}}
async function okx(env,r,method,path,payload){
 const body=payload?JSON.stringify(payload):"",headers=await privateHeaders(env,method,path,body);
 let res;try{res=await fetch(environment.rest_base_url+path,{method,headers,body:body||undefined,signal:AbortSignal.timeout(10000)});}catch(e){throw new Error("REST_NETWORK_FAILURE: "+e.message);}
 r.telemetry.metrics.rest_requests++;const data=await res.json().catch(()=>({}));
 if(method==="POST"&&path==="/api/v5/trade/order")r.last_order_audit={timestamp:now(),endpoint:path,request:payload,http_status:res.status,response:data};
 if(res.status===429)r.telemetry.metrics.rate_limits++;
 if(!res.ok||data.code!=="0"){const error=new Error("OKX_API_ERROR: "+JSON.stringify({code:data.code,msg:data.msg,data:data.data,http_status:res.status}));error.okx=data;error.http_status=res.status;throw error;}
 return data.data||[];
}
async function publicGet(r,path){let res;try{res=await fetch(environment.rest_base_url+path,{headers:{"x-simulated-trading":"1"}})}catch(e){throw new Error("MARKET_DATA_NETWORK_FAILURE: "+(e?.message||"fetch failed"))}r.telemetry.metrics.rest_requests++;const data=await res.json().catch(()=>({}));if(!res.ok||data.code!=="0")throw new Error("MARKET_DATA_FAILURE: "+(data.code||res.status));return data.data||[]}
function candidates(instruments,plan){const m=plan.market_selection,allowed=Array.isArray(m.authorized_instruments)?m.authorized_instruments:[m.active_instrument];return instruments.filter(x=>allowed.includes(x.instId)&&x.instType===m.instrument_type&&x.quoteCcy===m.quote_ccy&&x.state==="live"&&Number(x.minSz)>0&&Number(x.tickSz)>0&&Number(x.lotSz)>0)}
async function validatePrivateWs(env,r){assertDemo(env);const ts=Math.floor(Date.now()/1000).toString(),sign=await hmac(env.OKX_SECRET_KEY,ts+"GET"+"/users/self/verify");let response;try{response=await fetch(environment.private_ws_url.replace(/^wss:/,"https:"),{headers:{Upgrade:"websocket","x-simulated-trading":"1"}})}catch(e){throw new Error("PRIVATE_WS_CONNECT_FAILURE: "+(e?.message||"fetch failed"))}if(!response.webSocket)throw new Error("PRIVATE_WS_CONNECT_FAILURE: HTTP "+response.status);const ws=response.webSocket;ws.accept();try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("PRIVATE_WS_LOGIN_TIMEOUT")),10000);const listener=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.event==="login"){clearTimeout(timer);ws.removeEventListener("message",listener);m.code==="0"?resolve(m):reject(new Error("PRIVATE_WS_LOGIN_REJECTED: "+(m.code||"unknown")))}};ws.addEventListener("message",listener);ws.send(JSON.stringify({op:"login",args:[{apiKey:env.OKX_API_KEY,passphrase:env.OKX_PASSPHRASE,timestamp:ts,sign}]}))});r.validation.private_ws=true;r.telemetry.connection.private_ws="AUTHENTICATED";r.telemetry.connection.auth="AUTHENTICATED"}finally{try{ws.close(1000,"cycle complete")}catch(_){}}}
function roundDown(value,step){
  const decimal = v => { const m=String(v).match(/^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i); if(!m)throw new Error("INVALID_QUANTITY"); const scale=(m[2]||"").length-Number(m[3]||0); return {n:BigInt(m[1]+(m[2]||"")),scale}; };
  try{const a=decimal(value),b=decimal(step),scale=Math.max(a.scale,b.scale,0),n=a.n*10n**BigInt(scale-a.scale),d=b.n*10n**BigInt(scale-b.scale);if(d<=0n)return null;const places=Math.max(0,b.scale),out=(n/d*d/10n**BigInt(scale-places)).toString().padStart(places+1,"0");return places?out.slice(0,-places)+"."+out.slice(-places):out;}catch{return null;}
}
function candles(raw){return raw.map(x=>({ts:Number(x[0]),open:Number(x[1]),high:Number(x[2]),low:Number(x[3]),close:Number(x[4]),confirmed:String(x[8]??"1")==="1"})).filter(x=>x.confirmed&&[x.open,x.high,x.low,x.close].every(Number.isFinite)).sort((a,b)=>a.ts-b.ts)}
function analysis(c,strategy){const p=strategy.parameters,e=strategy.entry,x=strategy.exit,wid=Number(p.zone_width_atr),pivot=Number(p.pivot_window),minTouches=Number(p.min_touches),active=p.entry_mode==="SUPPORT_TOUCH";if(c.length<40)return {signal:"WAIT",regime:"UNKNOWN",support:[],resistance:[],reason:"insufficient candles"};const dif=c.slice(-21).slice(1).map((v,i)=>Math.max(v.high-c[i+c.length-21].low,Math.abs(v.high-c[i+c.length-21].close),Math.abs(v.low-c[i+c.length-21].close))),atr=dif.reduce((a,b)=>a+b,0)/dif.length;if(!Number.isFinite(atr)||atr<=0)return {signal:"WAIT",regime:"UNKNOWN",support:[],resistance:[],reason:"invalid ATR"};const piv=[];for(let i=pivot;i<c.length-pivot;i++){const w=c.slice(i-pivot,i+pivot+1);if(c[i].low===Math.min(...w.map(v=>v.low)))piv.push({kind:"SUPPORT",value:c[i].low,at:c[i].ts});if(c[i].high===Math.max(...w.map(v=>v.high)))piv.push({kind:"RESISTANCE",value:c[i].high,at:c[i].ts})}const last=c.at(-1),prev=c.at(-2),width=atr*wid,levels=kind=>piv.filter(v=>v.kind===kind).map(v=>({...v,touches:piv.filter(q=>q.kind===kind&&Math.abs(q.value-v.value)<=width).length})).filter(v=>v.touches>=minTouches);const supports=levels("SUPPORT").filter(v=>v.value<=last.close+width).sort((a,b)=>b.value-a.value).slice(0,3),resistance=levels("RESISTANCE").filter(v=>v.value>=last.close+width).sort((a,b)=>a.value-b.value).slice(0,3),support=supports[0],res=resistance[0],entryDistance=support?last.close-support.value:Infinity,stop=support?support.value-atr*Number(x.stop_atr_buffer):null,stopPct=stop?(last.close-stop)/last.close:Infinity,minGross=(Number(x.estimated_round_trip_fee_bps)+Number(x.min_net_target_bps))/10000,rejection=!!support&&prev.low<=support.value+width&&last.low<=support.value+width&&(!e.require_bullish_candle||last.close>last.open)&&(!e.require_close_above_previous||last.close>prev.close),touch=!!support&&last.close>=support.value-width&&last.close<=support.value+width&&last.low<=support.value+width,requiredTarget=stop?last.close+Math.max(last.close*minGross,(last.close-stop)*Number(x.min_reward_risk)):null,target=res?.value&&res.value>=requiredTarget?res.value:(active?requiredTarget:null),targetPct=target?(target-last.close)/last.close:-Infinity,rr=targetPct/stopPct,entryOK=active?touch:rejection,valid=entryOK&&entryDistance<=atr*Number(p.max_entry_distance_atr)&&stopPct>0&&stopPct<=Number(x.max_stop_loss_pct)&&targetPct>=minGross&&rr>=Number(x.min_reward_risk);const trend=Math.abs(last.close-c.at(-20).close)/(atr*20);let reason="no validated entry";if(entryOK&&!valid)reason="entry rejected: stop or distance";else if(valid)reason=active?"validated support touch":"validated support rejection";return {signal:valid?"BUY":"WAIT",regime:trend<.35?"RANGING":trend>.8?"TRENDING":"MIXED",support:supports,resistance,activeSupport:support||null,activeResistance:res||null,atr,trade:valid?{stop_price:stop,target_price:target,stop_pct:stopPct,target_pct:targetPct,reward_risk:rr,expected_net_target_pct:targetPct-Number(x.estimated_round_trip_fee_bps)/10000}:null,reason}}
async function append(store,event){const seq=((await store.storage.get("ledger:seq"))||0)+1;await store.storage.put("ledger:seq",seq);await store.storage.put("ledger:"+String(seq).padStart(12,"0"),{seq,...event})}
function spDate(value){const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(value));const part=t=>parts.find(x=>x.type===t)?.value;return part("year")+"-"+part("month")+"-"+part("day")}
function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function aggregateFills(fills,base,quote){
 let quantity=0,notional=0,fees=0,base_fee=0,quote_fee=0;
 for(const fill of fills){const px=finite(fill.fillPx),sz=finite(fill.fillSz),fee=finite(fill.fee);if(!(px>0&&sz>0&&fee!==null))return null;quantity+=sz;notional+=px*sz;if(fill.feeCcy===quote){quote_fee+=fee;fees-=fee;}else if(fill.feeCcy===base){base_fee+=fee;fees-=fee*px;}else if(fee!==0)return null;}
 return quantity>0?{quantity,notional,average_price:notional/quantity,fees,base_fee,quote_fee}:null;
}
function tradeBucket(){return {realized_pnl:0,gross_pnl:0,fees:0,trades:0,wins:0,losses:0,breakeven:0,win_rate:0,opening_realized_equity:0,closing_realized_equity:0,max_realized_drawdown:0,strategies:{},markets:{},last_updated_at:null}}
function applyTrade(performance,trade){const s=performance.summary,date=trade.closed_at?spDate(trade.closed_at):spDate(now()),month=date.slice(0,7),day=performance.daily[date]||tradeBucket(),mon=performance.monthly[month]||tradeBucket(),buckets=[s,day,mon];for(const b of buckets){b.realized_pnl+=trade.net_realized_pnl;b.gross_pnl+=trade.gross_pnl;b.fees+=trade.fees;b.trades++;if(trade.net_realized_pnl>0)b.wins++;else if(trade.net_realized_pnl<0)b.losses++;else b.breakeven++;b.win_rate=b.trades?b.wins/b.trades:0;b.strategies[trade.strategy_version]=(b.strategies[trade.strategy_version]||0)+trade.net_realized_pnl;b.markets[trade.market]=(b.markets[trade.market]||0)+trade.net_realized_pnl;b.last_updated_at=now()}s.peak_realized_equity=Math.max(s.peak_realized_equity,s.realized_pnl);s.max_realized_drawdown=Math.max(s.max_realized_drawdown,s.peak_realized_equity-s.realized_pnl);for(const b of [day,mon]){b.opening_realized_equity=s.realized_pnl-trade.net_realized_pnl;b.closing_realized_equity=s.realized_pnl;b.max_realized_drawdown=s.max_realized_drawdown}performance.daily[date]=day;performance.monthly[month]=mon;performance.started_at=performance.started_at||trade.created_at;return performance}
async function getOrder(env,r,instId,ordId){return (await okx(env,r,"GET","/api/v5/trade/order?instId="+encodeURIComponent(instId)+"&ordId="+encodeURIComponent(ordId)))[0]||null}
async function getFills(env,r,instId,ordId){return await okx(env,r,"GET","/api/v5/trade/fills?instType=SPOT&instId="+encodeURIComponent(instId)+"&ordId="+encodeURIComponent(ordId))}
async function settlePosition(store,env,r){
 const pos=r.position;if(!pos?.order_id)return false;
 const entry=await getOrder(env,r,pos.instrument,pos.order_id);
 if(!["filled","canceled"].includes(entry?.state))return false;
 const entryFills=await getFills(env,r,pos.instrument,pos.order_id);
 const buy=aggregateFills(entryFills,pos.base_ccy,pos.quote_ccy);
 if(!buy||Math.abs(buy.quantity-Number(entry.accFillSz))>1e-10)throw new Error("ENTRY_FILLS_INCOMPLETE");
 if(pos.close_order_id&&!(pos.exit_orders||[]).some(x=>x.ordId===pos.close_order_id))pos.exit_orders=[...(pos.exit_orders||[]),{ordId:pos.close_order_id,clOrdId:pos.close_client_order_id}];
 const exitFills=[],exits=[];
 for(const ref of pos.exit_orders||[]){const order=await getOrder(env,r,pos.instrument,ref.ordId);if(!["filled","canceled"].includes(order?.state))return false;
   if(ref.clOrdId&&order.clOrdId!==ref.clOrdId)throw new Error("EXIT_ATTRIBUTION_MISMATCH");
   const fills=await getFills(env,r,pos.instrument,ref.ordId);if(Math.abs(fills.reduce((n,f)=>n+Number(f.fillSz),0)-Number(order.accFillSz))>1e-10)throw new Error("EXIT_FILLS_INCOMPLETE");exitFills.push(...fills);exits.push(order);
 }
 if(pos.client_order_id&&entry.clOrdId!==pos.client_order_id)throw new Error("ENTRY_ATTRIBUTION_MISMATCH");
 const sell=aggregateFills(exitFills,pos.base_ccy,pos.quote_ccy),netBought=buy.quantity+buy.base_fee,consumed=(sell?.quantity||0)-(sell?.base_fee||0),remaining=netBought-consumed;
 if(remaining< -1e-10)throw new Error("RECONCILIATION_OVERSELL");
 pos.remaining_qty=Math.max(0,remaining);pos.reconciliation={entry,entry_fills:entryFills,exits,exit_fills:exitFills,net_bought:netBought,remaining_qty:pos.remaining_qty};
 const inst=(await publicGet(r,"/api/v5/public/instruments?instType=SPOT&instId="+encodeURIComponent(pos.instrument)))[0];
 if(!inst)throw new Error("INSTRUMENT_UNAVAILABLE");pos.min_sz=inst.minSz;pos.lot_sz=inst.lotSz;
 if(Number(roundDown(pos.remaining_qty,inst.lotSz))>=Number(inst.minSz)){
   // All previous sells are terminal; sell only their reconciled remainder next time.
   pos.close_order_id=null;pos.close_client_order_id=null;await store.storage.put("runtime",r);return false;
 }
 if(!sell)return false;
 const balances=await okx(env,r,"GET","/api/v5/account/balance?ccy="+encodeURIComponent(pos.base_ccy));
 const balance=balances[0]?.details?.find(x=>x.ccy===pos.base_ccy);
 if(!balance||finite(balance.cashBal)===null)throw new Error("BALANCE_RECONCILIATION_PENDING");
 pos.reconciliation.balance_after=balance;
 if(pos.classification==="TEST_TRADE"){
   const test=r.test_trade;test.reconciliation=pos.reconciliation;test.buy_order_id=pos.order_id;test.sell_order_ids=exits.map(x=>x.ordId);test.balance_after=balance;test.remaining_qty=pos.remaining_qty;
   const baseline=Number(test.balance_before?.cashBal||0),delta=Number(balance.cashBal)-baseline;
   test.balance_delta=delta;test.position_zero=Math.abs(remaining)<1e-10&&Math.abs(delta)<1e-10;test.status=test.position_zero?"PASSED":"RESIDUAL_REMAINS";test.finished_at=now();
   await store.storage.put("test:"+test.test_id,test);
 }else if(pos.client_order_id){
   const ratio=Math.min(1,consumed/netBought),allocatedCost=(buy.notional-buy.quote_fee)*ratio,net=(sell.notional+sell.quote_fee)-allocatedCost,fees=buy.fees*ratio+sell.fees;
   const trade_id="OKX:"+pos.order_id+":"+exits.map(x=>x.ordId).join(":"),closed=now();
   const trade={trade_id,execution_id:pos.position_id,entry_order_id:pos.order_id,entry_client_order_id:pos.client_order_id,order_id:exits.at(-1).ordId,client_order_id:exits.at(-1).clOrdId,exit_order_ids:exits.map(x=>x.ordId),strategy_id:pos.strategy_id,strategy_version:pos.strategy_version,execution_plan_id:pos.mandate_id,market:pos.instrument,side:"BUY",opened_at:pos.opened_at,closed_at:closed,created_at:closed,entry_price:buy.average_price,exit_price:sell.average_price,quantity:sell.quantity,gross_pnl:net+fees,fees,net_realized_pnl:net,currency:pos.quote_ccy,environment:"DEMO_ONLY",classification:"STRATEGY_TRADE",reconciliation_status:"RECONCILED",source:"OKX_PRIVATE_REST_FILLS",reason:pos.exit_requested||pos.close_reason,residual_base_qty:pos.remaining_qty,residual_cost_basis:(buy.notional-buy.quote_fee)*(1-ratio)};
   await store.storage.transaction(async tx=>{if(!await tx.get("trade:"+trade_id)){applyTrade(r.performance,trade);r.recent_trades.unshift(trade);r.recent_trades=r.recent_trades.slice(0,20);await tx.put("trade:"+trade_id,trade);await tx.put("runtime",r);}});
 }
 if(pos.remaining_qty>1e-10){r.dust_positions=r.dust_positions||{};r.dust_positions[pos.position_id]={instrument:pos.instrument,quantity:pos.remaining_qty,cost_basis:(buy.notional-buy.quote_fee)*(1-consumed/netBought),reason:"BELOW_EXCHANGE_MINIMUM",reconciliation:pos.reconciliation};}
 await append(store,{event_type:pos.classification==="TEST_TRADE"?"TEST_TRADE_CLOSED":"POSITION_RECONCILED",timestamp:now(),position_id:pos.position_id,environment:"DEMO_ONLY",remaining_qty:pos.remaining_qty,reconciliation:pos.reconciliation});
 r.position=null;await store.storage.put("runtime",r);return true;
}
function idKey(inst,side){return inst+"|"+side+"|"+Math.floor(Date.now()/60000)}
function idRecord(value){return typeof value==="string"?{state:value==="PENDING"?"PENDING":"ACCEPTED",ordId:value==="PENDING"?null:value,clOrdId:null,created_at:null}:value&&typeof value==="object"?value:null}
function pruneIdempotency(r){const cutoff=Date.now()-86400000;for(const [key,value] of Object.entries(r.idempotency)){const record=idRecord(value),at=Date.parse(record?.created_at||"");if(Number.isFinite(at)&&at<cutoff)delete r.idempotency[key]}}
async function findOrderByClientId(env,r,instId,clOrdId){if(!clOrdId)return null;return (await okx(env,r,"GET","/api/v5/trade/order?instId="+encodeURIComponent(instId)+"&clOrdId="+encodeURIComponent(clOrdId)))[0]||null}
function definiteOrderRejection(response,httpStatus){
 // Permission refusal is a definitive rejection even without the per-order data array.
 if(httpStatus===401&&response?.code==="50123")return true;
 return !!response?.data?.length&&response.data.every(x=>x.sCode&&x.sCode!=="0"&&x.sCode!=="50004"&&!x.ordId);
}
async function releaseRejectedEntry(store,env,r){
 const pos=r.position;if(!pos||pos.order_id)return false;
 const key=pos.position_id+"|buy|0",intent=idRecord(r.idempotency[key]);if(!intent||intent.ordId)return false;
 const audit=r.last_order_audit;
 const matching=audit?.endpoint==="/api/v5/trade/order"&&audit.request?.clOrdId===intent.clOrdId&&audit.request?.instId===pos.instrument&&audit.request?.side==="buy";
 const rejection=intent.rejection||(matching?{response:audit.response,http_status:audit.http_status}:null);
 if(!rejection||!definiteOrderRejection(rejection.response,rejection.http_status))return false;
 // Also verify the exchange has no accepted order before dropping the local placeholder.
 try{const found=await findOrderByClientId(env,r,pos.instrument,intent.clOrdId);if(found?.ordId){pos.order_id=found.ordId;pos.client_order_id=intent.clOrdId;intent.state="ACCEPTED";intent.ordId=found.ordId;await store.storage.put("runtime",r);return false;}}
 catch(e){if(e.okx?.code!=="51603")throw e;}
 intent.state="REJECTED";intent.rejection=rejection;intent.reconciled_at=now();
 if(rejection.response.code==="50123"){
   r.instrument_restrictions=r.instrument_restrictions||{};
   r.instrument_restrictions[pos.instrument]={code:"50123",reason:rejection.response.msg,observed_at:now(),retry_after:new Date(Date.now()+3600000).toISOString()};
 }
 await append(store,{event_type:"ENTRY_REJECTED_RECONCILED",timestamp:now(),position_id:pos.position_id,client_order_id:intent.clOrdId,instrument:pos.instrument,environment:"DEMO_ONLY",rejection,order_not_found:true});
 event(r,"ENTRADA RECUSADA",pos.instrument+": compra não executada; posição fictícia removida",pos.instrument);
 r.last_entry_rejection={instrument:pos.instrument,client_order_id:intent.clOrdId,reconciled_at:now(),...rejection};
 r.position=null;await store.storage.put("runtime",r);return true;
}
async function place(store,env,r,inst,side,sz){
 assertDemo(env);if(inst.instType!=="SPOT"||inst.quoteCcy!=="USDT"||!["buy","sell"].includes(side))throw new Error("DEMO_GUARD_REJECTED: only cash SPOT USDT");
 if(!(Number(sz)>=Number(inst.minSz))||Number(roundDown(sz,inst.lotSz))!==Number(sz))throw new Error("INVALID_ORDER_SIZE: lotSz or minSz");
 const pos=r.position;if(!pos)throw new Error("ORDER_WITHOUT_DURABLE_POSITION");
 const key=pos.position_id+"|"+side+"|"+(pos.exit_orders?.length||0);
 let intent=idRecord(r.idempotency[key]);
 if(intent?.ordId)return {ordId:intent.ordId,clOrdId:intent.clOrdId};
 if(intent&&intent.state!=="REJECTED"){
   try{const existing=await findOrderByClientId(env,r,inst.instId,intent.clOrdId);if(existing?.ordId){intent.ordId=existing.ordId;intent.state="ACCEPTED";await store.storage.put("runtime",r);return {ordId:existing.ordId,clOrdId:intent.clOrdId};}}
   catch(e){if(e.okx?.code!=="51603")throw e;}
   // An unknown network outcome is never converted into a new order automatically.
   throw new Error("ORDER_OUTCOME_UNKNOWN: reconcile client id "+intent.clOrdId);
 }
 intent={state:"PENDING",clOrdId:"KQL"+crypto.randomUUID().replaceAll("-","").slice(0,29),created_at:now()};r.idempotency[key]=intent;
 await store.storage.put("runtime",r);
 const payload={instId:inst.instId,tdMode:"cash",side,ordType:"market",sz,tgtCcy:"base_ccy",clOrdId:intent.clOrdId,banAmend:true};
 await append(store,{event_type:"ORDER_INTENT",timestamp:now(),position_id:pos.position_id,classification:pos.classification||"STRATEGY_TRADE",environment:"DEMO_ONLY",endpoint:"/api/v5/trade/order",request:payload});
 try{
   const orders=await okx(env,r,"POST","/api/v5/trade/order",payload),order=orders[0];
   if(!order?.ordId||order.sCode!=="0"){intent.state="REJECTED";throw new Error("ORDER_REJECTED: "+JSON.stringify(orders));}
   intent.state="ACCEPTED";intent.ordId=order.ordId;
   return {ordId:order.ordId,clOrdId:intent.clOrdId};
 }catch(e){if(definiteOrderRejection(e.okx,e.http_status)){intent.state="REJECTED";intent.rejection={response:e.okx,http_status:e.http_status};}throw e;}
 finally{await append(store,{event_type:"ORDER_RESPONSE",timestamp:now(),position_id:pos.position_id,environment:"DEMO_ONLY",audit:r.last_order_audit||null,intent:{...intent}});await store.storage.put("runtime",r);}
}
async function openPosition(store,env,r,inst,plan,trade,options={}){
 const px=r.telemetry.tick,equity=Number(r.equity),risk=plan.capital_policy,riskBudget=equity*Number(risk.risk_per_trade_fraction),stopPct=Number(trade?.stop_pct);
 const requested=Math.min(riskBudget/stopPct,equity*Number(risk.max_position_fraction));
 const size=options.size||roundDown(requested/px,inst.lotSz);
 if(!(px>0&&equity>0&&Number(size)>=Number(inst.minSz)))throw new Error("EXECUTION_BLOCKED: invalid risk-sized quantity");
 const pos={position_id:options.testId||"P-"+crypto.randomUUID(),classification:options.testId?"TEST_TRADE":"STRATEGY_TRADE",instrument:inst.instId,base_ccy:inst.baseCcy,quote_ccy:inst.quoteCcy,lot_sz:inst.lotSz,min_sz:inst.minSz,qty:Number(size),requested_size:size,entry_price:px,notional:Number(size)*px,risk_budget:riskBudget,opened_at:now(),stop_price:trade.stop_price,target_price:trade.target_price,order_id:null,client_order_id:null,strategy_id:plan.strategy.strategy_id,strategy_version:plan.strategy.version,mandate_id:plan.plan_id,mandate_hash:plan.plan_hash};
 r.position=pos;await store.storage.put("runtime",r);
 await resumeEntry(store,env,r,inst);
}
async function resumeEntry(store,env,r,inst){
 const pos=r.position;if(!pos)return;
 if(!pos.order_id){
   if(await releaseRejectedEntry(store,env,r))return;
   try{const order=await place(store,env,r,inst,"buy",pos.requested_size);pos.order_id=order.ordId;pos.client_order_id=order.clOrdId;await store.storage.put("runtime",r);}
   catch(e){if(await releaseRejectedEntry(store,env,r))return;throw e;}
 }
 const entry=await getOrder(env,r,pos.instrument,pos.order_id);pos.entry_order=entry;
 if(!entry)throw new Error("ENTRY_RECONCILIATION_PENDING");
 if(entry.state==="filled"||entry.state==="canceled"){
   if(!(Number(entry.accFillSz)>0)){await append(store,{event_type:"ENTRY_CANCELED_UNFILLED",timestamp:now(),position_id:pos.position_id,environment:"DEMO_ONLY"});r.position=null;return;}
   pos.qty=Number(entry.accFillSz)+(entry.feeCcy===pos.base_ccy?Number(entry.fee):0);pos.entry_price=Number(entry.avgPx);pos.entry_confirmed_at=now();r.last_trade_at=pos.opened_at;
   if(entry.state==="canceled")pos.exit_requested=pos.exit_requested||"PARTIAL_ENTRY_CANCELED";
 }
 await store.storage.put("runtime",r);
}
async function closePosition(store,env,r,reason){
 const pos=r.position;if(!pos)return;pos.exit_requested=pos.exit_requested||reason;await store.storage.put("runtime",r);
 const inst=(await publicGet(r,"/api/v5/public/instruments?instType=SPOT&instId="+encodeURIComponent(pos.instrument)))[0];if(!inst)throw new Error("INSTRUMENT_UNAVAILABLE");
 await resumeEntry(store,env,r,inst);if(!r.position)return;
 if(!pos.entry_confirmed_at)return;
 if(pos.close_order_id||pos.exit_orders?.length){if(await settlePosition(store,env,r))return;if(pos.close_order_id)return;}
 const entry=pos.entry_order,netQty=Number(entry.accFillSz)+(entry.feeCcy===pos.base_ccy?Number(entry.fee):0),remaining=pos.remaining_qty??netQty;
 const balances=await okx(env,r,"GET","/api/v5/account/balance?ccy="+encodeURIComponent(pos.base_ccy)),detail=balances[0]?.details?.find(x=>x.ccy===pos.base_ccy);
 const available=detail?.availBal===""?null:finite(detail?.availBal);
 if(available===null)throw new Error("BALANCE_UNAVAILABLE: refusing unbacked SELL");
 const size=roundDown(Math.min(remaining,available),inst.lotSz);
 pos.sell_audit={entry_gross_qty:Number(entry.accFillSz),entry_base_fee:entry.feeCcy===pos.base_ccy?Number(entry.fee):0,net_qty:netQty,remaining_qty:remaining,available,base_ccy:pos.base_ccy,quote_ccy:pos.quote_ccy,instId:inst.instId,minSz:inst.minSz,lotSz:inst.lotSz,sz:size};
 if(!(Number(size)>=Number(inst.minSz)))throw new Error("SELL_BELOW_MINIMUM: "+JSON.stringify(pos.sell_audit));
 const order=await place(store,env,r,inst,"sell",size);pos.close_order_id=order.ordId;pos.close_client_order_id=order.clOrdId;pos.close_reason=pos.exit_requested;pos.closing_started_at=now();
 await store.storage.put("runtime",r);await settlePosition(store,env,r);
}
async function run(store,env){let r=runtime(await store.storage.get("runtime"));r.last_cycle_at=now();try{assertDemo(env);if(r.permission_revision!=="OWNER-PERMISSIONS-20260906-ALL"){for(const [inst,restriction] of Object.entries(r.instrument_restrictions||{})){if(restriction.code==="50123")delete r.instrument_restrictions[inst];}r.permission_revision="OWNER-PERMISSIONS-20260906-ALL";event(r,"PERMISSÕES ATUALIZADAS","Titular confirmou liberação dos mercados; cache de recusas 50123 invalidado");await store.storage.put("runtime",r);}if(r.position){await monitorPosition(store,env,r);r.status=r.position?(r.position.exit_requested?"SETTLING":"MONITORING"):"WAITING_SIGNAL";r.last_success_at=now();await store.storage.put("runtime",r);return safe(r);}if(await controlledTest(store,env,r)){await store.storage.put("runtime",r);return safe(r);}const plan=await loadPlan(r),all=await publicGet(r,"/api/v5/public/instruments?instType=SPOT"),eligible=candidates(all,plan).filter(inst=>Date.parse(r.instrument_restrictions?.[inst.instId]?.retry_after||0)<=Date.now()||!r.instrument_restrictions?.[inst.instId]);if(!eligible.length)throw new Error("NO_AUTHORIZED_INSTRUMENT");const scored=await Promise.all(eligible.map(async inst=>{const cs=candles(await publicGet(r,"/api/v5/market/history-candles?instId="+encodeURIComponent(inst.instId)+"&bar=1m&limit=21"));const score=cs.length>1?Math.abs(cs.at(-1).close-cs[0].close)/cs[0].close:0;return {inst,score}}));const {inst}=scored.sort((a,b)=>b.score-a.score)[0];r.validation.instruments=true;r.selected_markets=[inst.instId];r.telemetry.active_market=inst.instId;const tick=(await publicGet(r,"/api/v5/market/ticker?instId="+encodeURIComponent(inst.instId)))[0];if(!tick?.last)throw new Error("MARKET_DATA_STALE: ticker missing");r.telemetry.tick=Number(tick.last);r.telemetry.tick_timestamp=new Date(Number(tick.ts)).toISOString();r.telemetry.tick_stale=Date.now()-Number(tick.ts)>MAX_STALE_MS;r.telemetry.connection.public_market_data=r.telemetry.tick_stale?"STALE":"CONNECTED";r.validation.market_data=true;if(r.telemetry.tick_stale)throw new Error("MARKET_DATA_STALE");const account=await okx(env,r,"GET","/api/v5/account/balance");r.balance=Number(account[0]?.totalEq)||null;r.equity=r.balance;r.validation.account=true;r.telemetry.connection.rest="AUTHENTICATED";await validatePrivateWs(env,r);const a=analysis(candles(await publicGet(r,"/api/v5/market/history-candles?instId="+encodeURIComponent(inst.instId)+"&bar="+encodeURIComponent(plan.strategy.parameters.timeframe)+"&limit="+encodeURIComponent(plan.strategy.parameters.lookback_candles))),plan.strategy);r.telemetry.support_levels=a.support.map(x=>x.value);r.telemetry.resistance_levels=a.resistance.map(x=>x.value);r.telemetry.signal_state=a.signal;r.telemetry.regime=a.regime;r.strategy={id:plan.strategy.strategy_id,version:plan.strategy.version,engine:plan.strategy.engine};r.instrument_context={instId:inst.instId,instType:inst.instType,baseCcy:inst.baseCcy,quoteCcy:inst.quoteCcy,minSz:inst.minSz,lotSz:inst.lotSz,tickSz:inst.tickSz,analysis_reason:a.reason,proposed_trade:a.trade};if(r.position?.close_order_id){await settlePosition(store,env,r);r.status=r.position?"SETTLING":"WAITING_SIGNAL"}else if(r.position){if(r.telemetry.tick<=r.position.stop_price)await closePosition(store,env,r,"STOP_LOSS");else if(r.telemetry.tick>=r.position.target_price)await closePosition(store,env,r,"TAKE_PROFIT");else if(a.activeResistance&&r.telemetry.tick>=a.activeResistance.value)await closePosition(store,env,r,"RESISTANCE");if(r.position&&a.signal==="BUY")event(r,"EXECUÇÃO BLOQUEADA","BUY válido não enviado: max_open_positions=1; posição anterior em reconciliação",inst.instId);r.status=r.position?(r.position.close_order_id?"SETTLING":"MONITORING"):"WAITING_SIGNAL"}else if(a.signal==="BUY"&&a.trade){await openPosition(store,env,r,inst,plan,a.trade);r.status=r.position?"MONITORING":"WAITING_SIGNAL"}else r.status="WAITING_SIGNAL";r.last_success_at=now();event(r,"CICLO MANDATO OKX","Sinal: "+a.signal+" · "+a.reason,inst.instId)}catch(e){fail(r,String(e.message||e).split(":")[0],e.message||e)}await store.storage.put("runtime",r);return safe(r)}

async function monitorPosition(store,env,r){
 const pos=r.position;if(!pos)return;
 if(pos.classification==="TEST_TRADE"||pos.exit_requested||pos.close_order_id){await closePosition(store,env,r,pos.classification==="TEST_TRADE"?"TEST_TRADE":pos.close_reason||pos.exit_requested);return;}
 const inst=(await publicGet(r,"/api/v5/public/instruments?instType=SPOT&instId="+encodeURIComponent(pos.instrument)))[0];if(!inst)throw new Error("INSTRUMENT_UNAVAILABLE");
 await resumeEntry(store,env,r,inst);if(!r.position)return;
 const tick=(await publicGet(r,"/api/v5/market/ticker?instId="+encodeURIComponent(pos.instrument)))[0];
 if(!(Number(tick?.last)>0)||Date.now()-Number(tick.ts)>MAX_STALE_MS)throw new Error("MARKET_DATA_STALE: position instrument");
 r.telemetry.active_market=pos.instrument;r.telemetry.tick=Number(tick.last);r.telemetry.tick_timestamp=new Date(Number(tick.ts)).toISOString();r.telemetry.tick_stale=false;
 if(r.telemetry.tick<=pos.stop_price)await closePosition(store,env,r,"STOP_LOSS");else if(r.telemetry.tick>=pos.target_price)await closePosition(store,env,r,"TAKE_PROFIT");
 else { // Preserve the original structural-resistance exit, but its data cannot block protective exits.
   const plan=r.execution_plan?.plan;if(plan){try{const a=analysis(candles(await publicGet(r,"/api/v5/market/history-candles?instId="+encodeURIComponent(pos.instrument)+"&bar="+encodeURIComponent(plan.strategy.parameters.timeframe)+"&limit="+plan.strategy.parameters.lookback_candles)),plan.strategy);r.telemetry.support_levels=a.support.map(x=>x.value);r.telemetry.resistance_levels=a.resistance.map(x=>x.value);if(a.activeResistance&&r.telemetry.tick>=a.activeResistance.value)await closePosition(store,env,r,"RESISTANCE");}catch(e){event(r,"EXIT_ANALYSIS_UNAVAILABLE",e.message,pos.instrument);}}
 }
}
// Explicit one-time owner authorization from the SELL repair mission. No public trade-test route.
const TEST_ID="TEST-TRADE-OKX-SELL-20260906-001";
async function controlledTest(store,env,r){
 assertDemo(env);
 if(r.test_trade?.test_id===TEST_ID){if(r.test_trade.status==="PASSED")return false;r.status="TEST_REQUIRES_REVIEW";return true;}
 const inst=(await publicGet(r,"/api/v5/public/instruments?instType=SPOT&instId=SOL-USDT"))[0];
 const before=(await okx(env,r,"GET","/api/v5/account/balance?ccy=SOL"))[0]?.details?.find(x=>x.ccy==="SOL");
 if(!inst||!before)throw new Error("TEST_PREFLIGHT_UNAVAILABLE");
 const fee=(await okx(env,r,"GET","/api/v5/account/trade-fee?instType=SPOT&instId=SOL-USDT"))[0],rate=Number(fee?.taker);
 if(!Number.isFinite(rate)||rate>0||rate<=-0.05)throw new Error("TEST_FEE_RATE_UNAVAILABLE");
 // Choose the smallest lot count whose net acquired quantity is also an exact lot and >= minSz.
 const scale=100000000n,f=BigInt(Math.round(Math.abs(rate)*Number(scale))),gcd=(a,b)=>b===0n?a:gcd(b,a%b),block=Number(scale/gcd(f,scale)),lot=Number(inst.lotSz);
 const blocks=Math.ceil(Number(inst.minSz)/(lot*block*(1+rate))),size=roundDown(blocks*block*lot,inst.lotSz);
 const tick=(await publicGet(r,"/api/v5/market/ticker?instId=SOL-USDT"))[0];
 r.telemetry.tick=Number(tick.last);if(!(Number(size)*r.telemetry.tick<=5))throw new Error("TEST_NOTIONAL_LIMIT: maximum 5 USDT");
 const account=(await okx(env,r,"GET","/api/v5/account/balance"))[0];r.equity=Number(account.totalEq);
 r.test_trade={test_id:TEST_ID,classification:"TEST_TRADE",environment:"DEMO_ONLY",status:"RUNNING",started_at:now(),balance_before:before,fee,requested_buy_size:size,performance_before:structuredClone(r.performance.summary)};
 await store.storage.put("runtime",r);
 const plan=r.execution_plan?.plan;if(!plan)throw new Error("TEST_MISSING_ATTRIBUTION_PLAN");
 await openPosition(store,env,r,inst,plan,{stop_pct:0.01,stop_price:0,target_price:Infinity},{size,testId:TEST_ID});
 if(r.position){r.position.exit_requested="TEST_TRADE";await store.storage.put("runtime",r);await closePosition(store,env,r,"TEST_TRADE");}
 r.status=r.position?"TEST_RUNNING":r.test_trade.status;return true;
}

export class ExecutorState{constructor(state,env){this.state=state;this.env=env}async fetch(req){const p=new URL(req.url).pathname;if(p==="/run")return json(await this.state.blockConcurrencyWhile(()=>run(this.state,this.env)));if(p==="/state"||p==="/live")return json(safe(runtime(await this.state.storage.get("runtime"))));if(p==="/ledger")return json({events:[...(await this.state.storage.list({prefix:"ledger:"})).values()]});if(p==="/execution-test")return json(runtime(await this.state.storage.get("runtime")).test_trade||null);if(p==="/performance")return json(runtime(await this.state.storage.get("runtime")).performance);if(p==="/performance-export"){const r=runtime(await this.state.storage.get("runtime")),trades=[...(await this.state.storage.list({prefix:"trade:"})).values()];return json({schema_version:1,provider:"OKX",environment:"DEMO_ONLY",generated_at:now(),source:"DURABLE_OBJECT_APPEND_ONLY_TRADE_LEDGER",trades,performance:r.performance})}return new Response("Not found",{status:404})}}
export default {async fetch(req,env){const p=new URL(req.url).pathname,stub=env.EXECUTOR_STATE.get(env.EXECUTOR_STATE.idFromName("primary"));if(p==="/health")return json({ok:true,provider:"OKX",environment:"DEMO_ONLY",live_money:false,mandate_source:PLAN_URL});if(p==="/executor-state"){const response=await stub.fetch("https://internal/state");return new Response(response.body,{headers:CORS})}if(p==="/execution-test"||p==="/performance"||p==="/performance-export"){const response=await stub.fetch("https://internal"+p);return new Response(response.body,{headers:CORS})}if(p==="/run")return stub.fetch("https://internal/run");return json({service:"Kell Quant Lab",provider:"OKX",environment:"DEMO_ONLY",mandate_source:PLAN_URL})},async scheduled(_c,env,ctx){const stub=env.EXECUTOR_STATE.get(env.EXECUTOR_STATE.idFromName("primary"));ctx.waitUntil(stub.fetch("https://internal/run"))}};
