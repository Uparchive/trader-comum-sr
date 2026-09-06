import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const environment=JSON.parse(readFileSync(new URL('../config/v5/okx_demo_environment.json',import.meta.url)));
const source=readFileSync(new URL('../worker/v5.js',import.meta.url),'utf8').replace(/^import.*\n/,'').replace('export class ExecutorState','class ExecutorState').replace('export default','const handler =');
const hooks=new Function('environment',source+'\nreturn {runtime,roundDown,aggregateFills,run,closePosition,settlePosition,openPosition,controlledTest,place,releaseRejectedEntry};')(environment);
const env={OKX_API_KEY:'demo-test',OKX_SECRET_KEY:'demo-test',OKX_PASSPHRASE:'demo-test'};
const inst={instId:'SOL-USDT',instType:'SPOT',baseCcy:'SOL',quoteCcy:'USDT',lotSz:'0.000001',minSz:'0.001',tickSz:'0.01',state:'live'};
const plan={plan_id:'fixture',plan_hash:'fixture',strategy:{strategy_id:'SR',version:'unchanged'},capital_policy:{risk_per_trade_fraction:.001,max_position_fraction:.05}};
let balance,orders,requests,unknown,partial,permissionDenied;
function reset(){balance=0;orders=new Map();requests=[];unknown=false;partial=false;permissionDenied=false;}
function order(side,size,id){const sz=Number(size),fee=side==='buy'?-sz*.004:-sz*100*.004;return {ordId:id,clOrdId:'KQL'+id,instId:inst.instId,state:'filled',accFillSz:String(sz),avgPx:'100',fee:String(fee),feeCcy:side==='buy'?'SOL':'USDT',side,tdMode:'cash',ordType:'market',tgtCcy:'base_ccy'};}
globalThis.fetch=async (url,opts={})=>{
 const u=new URL(url),path=u.pathname;let data;
 if(path==='/api/v5/public/instruments')data=[inst];
 else if(path==='/api/v5/market/ticker')data=[{last:'100',ts:String(Date.now())}];
 else if(path==='/api/v5/account/balance')data=[{totalEq:'100000',details:[{ccy:'SOL',cashBal:String(balance),availBal:String(balance),frozenBal:'0'}]}];
 else if(path==='/api/v5/account/trade-fee')data=[{taker:'-0.004'}];
 else if(path==='/api/v5/trade/order'&&opts.method==='POST'){
   assert.equal(opts.headers['x-simulated-trading'],'1');const p=JSON.parse(opts.body);requests.push(p);
   if(permissionDenied)return Response.json({code:"50123",msg:"This API Key does not have trading permission for the Crypto"},{status:401});
   assert.equal(p.tdMode,'cash');assert.equal(p.tgtCcy,'base_ccy');assert.equal(p.instId,'SOL-USDT');
   const sz=Number(p.sz);if(p.side==='sell')assert.ok(sz<=balance+1e-12,'SELL never exceeds actual balance');
   const id=String(orders.size+1),o=order(p.side,partial&&p.side==='sell'?sz/2:sz,id);o.clOrdId=p.clOrdId;
   if(partial&&p.side==='sell'){o.state='canceled';partial=false;}
   balance+=p.side==='buy'?Number(o.accFillSz)+Number(o.fee):-Number(o.accFillSz);orders.set(id,o);
   if(unknown){unknown=false;throw new Error('connection reset after exchange accepted');}
   data=[{ordId:id,clOrdId:p.clOrdId,sCode:'0'}];
 }else if(path==='/api/v5/trade/order'){
   const o=orders.get(u.searchParams.get('ordId'))||[...orders.values()].find(x=>x.clOrdId===u.searchParams.get('clOrdId'));
   if(!o)return Response.json({code:'51603',msg:'Order does not exist',data:[]});data=[o];
 }else if(path==='/api/v5/trade/fills'){
   const o=orders.get(u.searchParams.get('ordId'));data=[{fillSz:o.accFillSz,fillPx:o.avgPx,fee:o.fee,feeCcy:o.feeCcy}];
 }else throw new Error('Unexpected dependency: '+url);
 return Response.json({code:'0',data});
};
function fixture(){const map=new Map(),storage={get:async k=>structuredClone(map.get(k)),put:async(k,v)=>map.set(k,structuredClone(v))},r=hooks.runtime();storage.transaction=async fn=>fn(storage);r.execution_plan={plan,verified_at:new Date().toISOString()};r.equity=100000;r.telemetry.tick=100;return {store:{storage},r};}
assert.equal(hooks.roundDown('9.967678164','0.000001'),'9.967678');
assert.equal(hooks.roundDown('0.0000009','1e-6'),'0.000000');
assert.equal(hooks.roundDown('0.001999999999','0.000001'),'0.001999');
reset();{
 const {store,r}=fixture();await hooks.controlledTest(store,env,r);
 assert.equal(r.test_trade.status,'PASSED');assert.equal(r.test_trade.position_zero,true);assert.equal(r.position,null);
 assert.equal(requests.length,2);assert.equal(requests[0].sz,'0.001250');assert.equal(requests[1].sz,'0.001245');assert.equal(r.performance.summary.trades,0);
 assert.ok(Math.abs(balance)<1e-12);await hooks.controlledTest(store,env,r);assert.equal(requests.length,2,'test never repeats');
}
reset();{
 const {store,r}=fixture();unknown=true;
 await assert.rejects(hooks.openPosition(store,env,r,inst,plan,{stop_pct:.01,stop_price:99,target_price:101},{size:'0.002000'}));
 assert.equal(requests.length,1);assert.ok(r.position);await hooks.closePosition(store,env,r,'STOP_LOSS');
 assert.equal(requests.filter(x=>x.side==='buy').length,1,'uncertain BUY recovered without duplicate');assert.equal(r.position,null);assert.equal(r.performance.summary.trades,1);
}
reset();{
 const {store,r}=fixture();await hooks.openPosition(store,env,r,inst,plan,{stop_pct:.01,stop_price:99,target_price:101},{size:'0.010000'});
 partial=true;await hooks.closePosition(store,env,r,'STOP_LOSS');assert.ok(r.position);assert.equal(r.position.close_order_id,null);
 await hooks.closePosition(store,env,r,'STOP_LOSS');assert.equal(r.position,null);assert.equal(requests.length,3);assert.equal(r.performance.summary.trades,1);
}
reset();{
 const {store,r}=fixture();await hooks.openPosition(store,env,r,inst,plan,{stop_pct:.01,stop_price:99,target_price:101},{size:'10.007709'});
 r.position.exit_requested='STOP_LOSS';r.execution_plan={plan:{state:'INVALID'}};await store.storage.put('runtime',r);
 const out=await hooks.run(store,env);assert.equal(out.position,null,'exit ignores invalid entry mandate and WS');assert.equal(out.performance.summary.trades,1);
 const dust=Object.values(out.dust_positions)[0];assert.ok(Math.abs(dust.quantity-.000000164)<1e-10,'fee dust explicitly retained');
 assert.ok(out.performance.summary.realized_pnl<0,'fees are included in PnL');
}
console.log('PASS: real executor functions; fee-aware round trip, test isolation, uncertain order recovery, partial SELL, independent exit gates, dust accounting');

reset();{
 const {store,r}=fixture();permissionDenied=true;
 await hooks.openPosition(store,env,r,inst,plan,{stop_pct:.01,stop_price:99,target_price:101},{size:'0.010000'});
 assert.equal(r.position,null,'definitive 401 rejection does not become a phantom position');
 assert.equal(r.last_entry_rejection.response.code,'50123');assert.ok(r.instrument_restrictions['SOL-USDT']);
 assert.equal(r.performance.summary.trades,0);assert.equal(orders.size,0);assert.equal(requests.length,1);
}
reset();{
 const {store,r}=fixture();r.position={position_id:'old',instrument:'SOL-USDT',requested_size:'1',order_id:null};
 r.idempotency['old|buy|0']={state:'PENDING',clOrdId:'KQLold'};
 r.last_order_audit={endpoint:'/api/v5/trade/order',request:{clOrdId:'KQLold',instId:'SOL-USDT',side:'buy'},http_status:401,response:{code:'50123',msg:'permission denied'}};
 assert.equal(await hooks.releaseRejectedEntry(store,env,r),true,'migrate old misclassified intent from matching evidence');
 assert.equal(r.position,null);assert.equal(requests.length,0,'recovery does not place another BUY');
}
reset();{
 const {store,r}=fixture();r.position={position_id:'uncertain',instrument:'SOL-USDT',order_id:null};r.idempotency['uncertain|buy|0']={state:'PENDING',clOrdId:'KQLuncertain'};
 r.last_order_audit={endpoint:'/api/v5/trade/order',request:{clOrdId:'different',instId:'SOL-USDT',side:'buy'},http_status:401,response:{code:'50123'}};
 assert.equal(await hooks.releaseRejectedEntry(store,env,r),false,'unrelated audit cannot release unknown order');assert.ok(r.position);
}
console.log('PASS: 401 permission refusal, existing phantom recovery, permission cache, no accidental release of uncertain orders');
