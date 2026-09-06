import gzip, hashlib, json, os, time, urllib.parse, urllib.request
from datetime import datetime, timezone
import numpy as np

GATEWAY=os.environ.get('GATEWAY','https://kell-quant-lab.kesllyalbuquerque.workers.dev').rstrip('/')
TARGET=100000
PAGE=1000
SEED=20260831
PERMS=10000
PACING_SECONDS=0.30
MAX_PAGES=120
OUT_GZ='data/acquisition/day-05b-final-2026-09-02.json.gz'
OUT_SUM='data/acquisition/day-05b-final-2026-09-02-summary.json'
CHECKPOINT='data/acquisition/day-05b-final-2026-09-02-checkpoint.json'
os.makedirs('data/acquisition',exist_ok=True)

# Universo prospectivamente congelado em E000001; não consultar/selecionar símbolos post hoc.
universe=[
 {'family':'BOOM','N':50,'symbol':'BOOM50','name':'Boom 50 Index'},
 {'family':'BOOM','N':150,'symbol':'BOOM150N','name':'Boom 150 Index'},
 {'family':'BOOM','N':300,'symbol':'BOOM300N','name':'Boom 300 Index'},
 {'family':'BOOM','N':500,'symbol':'BOOM500','name':'Boom 500 Index'},
 {'family':'BOOM','N':600,'symbol':'BOOM600','name':'Boom 600 Index'},
 {'family':'BOOM','N':900,'symbol':'BOOM900','name':'Boom 900 Index'},
 {'family':'BOOM','N':1000,'symbol':'BOOM1000','name':'Boom 1000 Index'},
 {'family':'CRASH','N':50,'symbol':'CRASH50','name':'Crash 50 Index'},
 {'family':'CRASH','N':150,'symbol':'CRASH150N','name':'Crash 150 Index'},
 {'family':'CRASH','N':300,'symbol':'CRASH300N','name':'Crash 300 Index'},
 {'family':'CRASH','N':500,'symbol':'CRASH500','name':'Crash 500 Index'},
 {'family':'CRASH','N':600,'symbol':'CRASH600','name':'Crash 600 Index'},
 {'family':'CRASH','N':900,'symbol':'CRASH900','name':'Crash 900 Index'},
 {'family':'CRASH','N':1000,'symbol':'CRASH1000','name':'Crash 1000 Index'}
]

def get(path,attempts=6):
    errs=[]
    for i in range(attempts):
        try:
            req=urllib.request.Request(GATEWAY+path,headers={'User-Agent':'KellQuantLab-Research/5B-Final'})
            with urllib.request.urlopen(req,timeout=60) as r:
                payload=json.loads(r.read().decode())
            if not payload.get('ok',True):
                raise RuntimeError(payload.get('error','gateway retornou ok=false'))
            time.sleep(PACING_SECONDS)
            return payload
        except Exception as e:
            errs.append(repr(e))
            time.sleep(min(20.0,1.5*(2**i)))
    raise RuntimeError(' | '.join(errs))

def save_checkpoint(state):
    tmp=CHECKPOINT+'.tmp'
    with open(tmp,'w',encoding='utf-8') as f: json.dump(state,f,ensure_ascii=False,indent=2)
    os.replace(tmp,CHECKPOINT)

cutoff=int(datetime.now(timezone.utc).timestamp())
checkpoint={'schema_version':1,'cycle':'Dia 5B — tentativa final','cutoff_epoch':cutoff,'target_per_symbol':TARGET,'page_size':PAGE,'symbols':{}}
save_checkpoint(checkpoint)

def acquire(symbol):
    end=cutoff; by_epoch={}; pages=[]; stop_reason=None
    for p in range(1,MAX_PAGES+1):
        if len(by_epoch)>=TARGET: break
        r=get('/research/ticks-history?'+urllib.parse.urlencode({'symbol':symbol,'count':PAGE,'end':end}))
        h=r.get('history') or {}; times=h.get('times') or h.get('epoch') or []; prices=h.get('prices') or []
        if not times or len(times)!=len(prices):
            stop_reason='EMPTY_OR_MALFORMED_PAGE'; break
        before=len(by_epoch)
        for e,v in zip(times,prices):
            e=int(e)
            if e<=cutoff: by_epoch[e]=float(v)
        mn=min(map(int,times)); mx=max(map(int,times))
        pages.append({'page':p,'requested_end':end,'received':len(times),'new_unique':len(by_epoch)-before,'min_epoch':mn,'max_epoch':mx})
        checkpoint['symbols'][symbol]={'pages_completed':p,'unique_ticks':len(by_epoch),'last_min_epoch':mn,'updated_at':datetime.now(timezone.utc).isoformat()}
        save_checkpoint(checkpoint)
        new_end=mn-1
        if new_end>=end or len(by_epoch)==before:
            stop_reason='NO_BACKWARD_PROGRESS'; break
        end=new_end
    if len(by_epoch)<TARGET and stop_reason is None: stop_reason='MAX_PAGES_REACHED'
    return sorted(by_epoch.items())[-TARGET:],pages,stop_reason

def ages_from_events(y):
    ages=np.zeros(len(y),dtype=np.int64); age=0
    for i,v in enumerate(y): ages[i]=age; age=0 if v else age+1
    return ages

def bin_index(a,N): return np.where(a<.5*N,0,np.where(a<N,1,np.where(a<2*N,2,3)))
def fit_probs(y,b): return np.array([(y[b==k].sum()+.5)/((b==k).sum()+1.) for k in range(4)],float)
def ll(y,p): p=np.clip(p,1e-12,1-1e-12); return float(np.sum(y*np.log(p)+(1-y)*np.log(1-p)))
def logloss(y,p): return -ll(y,p)/len(y)
def permutation_p(y,b,observed,rng):
    n=len(y); p0=(y.sum()+.5)/(n+1.); extreme=0
    for shift in rng.integers(1,n,size=PERMS):
        ys=np.roll(y,int(shift)); ps=fit_probs(ys,b); stat=2*(ll(ys,ps[b])-ll(ys,np.full(n,p0)))
        if stat>=observed-1e-12: extreme+=1
    return (extreme+1)/(PERMS+1)

results=[]; raw_series={}; rng=np.random.default_rng(SEED)
for u in universe:
    items,pages,stop_reason=acquire(u['symbol'])
    epochs=np.array([e for e,_ in items],dtype=np.int64); prices=np.array([v for _,v in items],float)
    raw_series[u['symbol']]={'epochs':epochs.tolist(),'prices':prices.tolist()}
    shortfall=max(0,TARGET-len(items))
    rec={'symbol':u['symbol'],'family':u['family'],'N':u['N'],'target':TARGET,'count':len(items),'shortfall':shortfall,'stop_reason':stop_reason,'period_start':int(epochs[0]) if len(epochs) else None,'period_end':int(epochs[-1]) if len(epochs) else None,'pages':pages}
    if shortfall:
        rec['status']='ACQUISITION_SHORTFALL'; results.append(rec); print(u['symbol'],len(items),'SHORTFALL',stop_reason,flush=True); continue
    moves=np.diff(prices); signed=moves if u['family']=='BOOM' else -moves; n=len(signed); c=int(n*.6); v=int(n*.8)
    threshold=float(np.quantile(signed[:c],1-1/u['N'],method='linear')); y=(signed>threshold).astype(np.int8); ages=ages_from_events(y); b=bin_index(ages,u['N'])
    cal_y,cal_b=y[:c],b[:c]; val_y,val_b=y[c:v],b[c:v]; oos_y,oos_b=y[v:],b[v:]
    probs=fit_probs(cal_y,cal_b); p0=(cal_y.sum()+.5)/(len(cal_y)+1.)
    def seg(yy,bb):
        alt=probs[bb]; base=np.full(len(yy),p0)
        return {'n':len(yy),'events':int(yy.sum()),'baseline_logloss':logloss(yy,base),'age_model_logloss':logloss(yy,alt),'logloss_improvement':logloss(yy,base)-logloss(yy,alt),'ll_baseline':ll(yy,base),'ll_age_model':ll(yy,alt)}
    valm=seg(val_y,val_b); oosm=seg(oos_y,oos_b); observed=2*(oosm['ll_age_model']-oosm['ll_baseline']); pperm=permutation_p(oos_y,oos_b,observed,rng)
    rec.update({'status':'OK','threshold':threshold,'calibration_events':int(cal_y.sum()),'calibration_baseline_p':float(p0),'calibration_bin_probs':probs.tolist(),'validation':valm,'oos':oosm,'oos_lr_stat':observed,'oos_permutation_p':pperm})
    results.append(rec); print(u['symbol'],len(items),valm['events'],oosm['events'],pperm,flush=True)

valid=[r for r in results if r.get('oos_permutation_p') is not None]
ordered=sorted((r['oos_permutation_p'],r['symbol']) for r in valid); holm=[]; gate=True; m=len(ordered)
for i,(p,s) in enumerate(ordered):
    alpha=.05/(m-i); reject=bool(gate and p<=alpha)
    if not reject: gate=False
    holm.append({'symbol':s,'p':p,'holm_threshold':alpha,'reject':reject})
aggregate={'symbols':len(results),'target_ticks':TARGET*len(results),'actual_ticks':sum(r['count'] for r in results),'symbols_with_shortfall':sum(r['shortfall']>0 for r in results),'validation_events':sum(r.get('validation',{}).get('events',0) for r in results),'oos_events':sum(r.get('oos',{}).get('events',0) for r in results),'validation_logloss_positive_symbols':sum(r.get('validation',{}).get('logloss_improvement',-1)>0 for r in valid),'oos_logloss_positive_symbols':sum(r.get('oos',{}).get('logloss_improvement',-1)>0 for r in valid),'holm_rejections':sum(x['reject'] for x in holm),'coverage_complete':all(r['shortfall']==0 for r in results)}
meta={'schema_version':4,'cycle':'Dia 5B — tentativa final pré-registrada','acquired_at':datetime.now(timezone.utc).isoformat(),'cutoff_epoch':cutoff,'target_per_symbol':TARGET,'page_size':PAGE,'universe':universe,'protocol':{'split':'60/20/20','threshold':'1-1/N apenas calibração','event':'signed_tick_move > threshold','bins':['<0.5N','0.5N..N','N..2N','>=2N'],'permutations':PERMS,'permutation_seed':SEED,'multiple_testing':'Holm family alpha 0.05','acquisition':'1000 ticks efetivos; end=min_epoch-1; deduplicação; pacing; retry/backoff; checkpoint por símbolo','attempt_policy':'única tentativa final autorizada pelo Dia 5A'},'results':results,'holm':holm,'aggregate':aggregate}
raw=json.dumps({'metadata':meta,'series':raw_series},ensure_ascii=False,separators=(',',':')).encode()
with gzip.open(OUT_GZ,'wb',compresslevel=9) as f: f.write(raw)
gz=open(OUT_GZ,'rb').read(); summary={**meta,'dataset':{'storage_location':OUT_GZ,'sha256_gzip':hashlib.sha256(gz).hexdigest(),'size_bytes_gzip':len(gz),'sha256_uncompressed':hashlib.sha256(raw).hexdigest(),'size_bytes_uncompressed':len(raw)}}
with open(OUT_SUM,'w',encoding='utf-8') as f: json.dump(summary,f,ensure_ascii=False,indent=2)
checkpoint['completed_at']=datetime.now(timezone.utc).isoformat(); checkpoint['aggregate']=aggregate; save_checkpoint(checkpoint)
print(json.dumps(aggregate,ensure_ascii=False),flush=True)
