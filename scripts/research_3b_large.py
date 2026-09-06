import gzip,hashlib,json,os,re,time,urllib.parse,urllib.request
from datetime import datetime,timezone
import numpy as np
G=os.environ.get('GATEWAY','https://kell-quant-lab.kesllyalbuquerque.workers.dev').rstrip('/');TARGET=100000;PAGE=5000;NS=(50,150,300,500,600,900,1000);PERMS=10000;SEED=20260831
OG='data/acquisition/day-03b-large-2026-08-31.json.gz';OS='data/acquisition/day-03b-large-2026-08-31-summary.json';os.makedirs('data/acquisition',exist_ok=True)
def get(path,tries=7):
 e=[]
 for i in range(tries):
  try:
   with urllib.request.urlopen(urllib.request.Request(G+path,headers={'User-Agent':'KellQuantLab-Research/3B-Retry'}),timeout=60) as r:return json.loads(r.read().decode())
  except Exception as x:e.append(repr(x));time.sleep(min(12,1.5*(i+1)))
 raise RuntimeError(' | '.join(e))
cut=int(datetime.now(timezone.utc).timestamp());a=get('/research/active-symbols');rows=a.get('active_symbols') or a.get('data',{}).get('active_symbols') or [];sel=[]
for x in rows:
 t=' '.join(str(v) for v in x.values() if isinstance(v,(str,int,float))).upper()
 if ('CRASH' not in t and 'BOOM' not in t) or 'FLIP' in t or 'HYBRID' in t:continue
 s=x.get('symbol') or x.get('underlying_symbol');name=' '.join(str(x.get(k,'')) for k in ('display_name','underlying_symbol_name','market_display_name'));m=re.search(r'\b(CRASH|BOOM)\s*(50|150|300|500|600|900|1000)\b',(name+' '+str(s)).upper())
 if s and m:sel.append((m.group(1),int(m.group(2)),s,name))
u={(f,n):(s,z) for f,n,s,z in sel};exp=[(f,n) for f in ('BOOM','CRASH') for n in NS];miss=[k for k in exp if k not in u]
if miss:raise RuntimeError('Universo congelado incompleto '+repr(miss))
univ=[{'family':f,'N':n,'symbol':u[(f,n)][0],'name':u[(f,n)][1]} for f,n in exp]
def acquire(s):
 end=cut;d={};pages=[];err=None
 for p in range(1,130):
  if len(d)>=TARGET:break
  try:r=get('/research/ticks-history?'+urllib.parse.urlencode({'symbol':s,'count':PAGE,'end':end}))
  except Exception as x:err=repr(x);break
  h=r.get('history') or {};ts=h.get('times') or h.get('epoch') or [];ps=h.get('prices') or []
  if not ts or len(ts)!=len(ps):err='resposta histórica vazia/inconsistente';break
  b=len(d)
  for e,v in zip(ts,ps):
   e=int(e)
   if e<=cut:d[e]=float(v)
  pages.append({'page':p,'requested_end':end,'received':len(ts),'new_unique':len(d)-b,'min_epoch':min(map(int,ts)),'max_epoch':max(map(int,ts))});ne=min(map(int,ts))-1
  if ne>=end or len(d)==b:err='paginação sem avanço';break
  end=ne;time.sleep(.12)
 return sorted(d.items())[-TARGET:],pages,err
def ages(y):
 a=np.zeros(len(y),dtype=np.int64);z=0
 for i,v in enumerate(y):a[i]=z;z=0 if v else z+1
 return a
def bins(a,N):return np.where(a<.5*N,0,np.where(a<N,1,np.where(a<2*N,2,3)))
def probs(y,b):return np.array([(y[b==k].sum()+.5)/((b==k).sum()+1.) for k in range(4)],float)
def ll(y,p):p=np.clip(p,1e-12,1-1e-12);return float(np.sum(y*np.log(p)+(1-y)*np.log(1-p)))
def seg(y,b,pr,p0):
 x=pr[b];z=np.full(len(y),p0);la=ll(y,x);lb=ll(y,z);return {'n':len(y),'events':int(y.sum()),'baseline_logloss':-lb/len(y),'age_model_logloss':-la/len(y),'logloss_improvement':(la-lb)/len(y),'ll_baseline':lb,'ll_age_model':la}
def perm(y,b,obs,rng):
 n=len(y);p0=(y.sum()+.5)/(n+1.);e=0
 for sh in rng.integers(1,n,size=PERMS):
  yy=np.roll(y,int(sh));pp=probs(yy,b);st=2*(ll(yy,pp[b])-ll(yy,np.full(n,p0)))
  e+=st>=obs-1e-12
 return (e+1)/(PERMS+1)
rng=np.random.default_rng(SEED);res=[];series={}
for q in univ:
 it,pages,err=acquire(q['symbol']);ep=np.array([e for e,_ in it],dtype=np.int64);px=np.array([v for _,v in it],float);series[q['symbol']]={'epochs':ep.tolist(),'prices':px.tolist()};short=max(0,TARGET-len(it));r={'symbol':q['symbol'],'family':q['family'],'N':q['N'],'target':TARGET,'count':len(it),'shortfall':short,'period_start':int(ep[0]) if len(ep) else None,'period_end':int(ep[-1]) if len(ep) else None,'pages':pages,'acquisition_error':err}
 if len(it)<100:r['status']='INSUFFICIENT_ACQUISITION';res.append(r);print(q['symbol'],len(it),'insuficiente',err,flush=True);continue
 mv=np.diff(px);sg=mv if q['family']=='BOOM' else -mv;n=len(sg);c=int(n*.6);v=int(n*.8);th=float(np.quantile(sg[:c],1-1/q['N'],method='linear'));y=(sg>th).astype(np.int8);ag=ages(y);bi=bins(ag,q['N']);cy,cb=y[:c],bi[:c];vy,vb=y[c:v],bi[c:v];oy,ob=y[v:],bi[v:];pr=probs(cy,cb);p0=(cy.sum()+.5)/(len(cy)+1.);vm=seg(vy,vb,pr,p0);om=seg(oy,ob,pr,p0);stat=2*(om['ll_age_model']-om['ll_baseline']);pv=perm(oy,ob,stat,rng);r.update({'status':'OK' if not short else 'SHORTFALL','threshold':th,'calibration_events':int(cy.sum()),'calibration_baseline_p':float(p0),'calibration_bin_probs':pr.tolist(),'validation':vm,'oos':om,'oos_lr_stat':stat,'oos_permutation_p':pv});res.append(r);print(q['symbol'],len(it),vm['events'],om['events'],pv,err,flush=True)
valid=[r for r in res if r.get('oos_permutation_p') is not None];ordered=sorted((r['oos_permutation_p'],r['symbol']) for r in valid);holm=[];gate=True;m=len(ordered)
for i,(p,s) in enumerate(ordered):
 al=.05/(m-i);rej=bool(gate and p<=al)
 if not rej:gate=False
 holm.append({'symbol':s,'p':p,'holm_threshold':al,'reject':rej})
agg={'symbols':len(res),'target_ticks':TARGET*len(res),'actual_ticks':sum(r['count'] for r in res),'symbols_with_shortfall':sum(r['shortfall']>0 for r in res),'validation_events':sum(r.get('validation',{}).get('events',0) for r in res),'oos_events':sum(r.get('oos',{}).get('events',0) for r in res),'validation_logloss_positive_symbols':sum(r.get('validation',{}).get('logloss_improvement',-1)>0 for r in valid),'oos_logloss_positive_symbols':sum(r.get('oos',{}).get('logloss_improvement',-1)>0 for r in valid),'holm_rejections':sum(x['reject'] for x in holm)}
meta={'schema_version':3,'cycle':'Dia 3B — Validação Adversarial ampliada','acquired_at':datetime.now(timezone.utc).isoformat(),'cutoff_epoch':cut,'target_per_symbol':TARGET,'page_size':PAGE,'universe':univ,'protocol':{'split':'60/20/20','threshold':'1-1/N apenas calibração','event':'signed_tick_move > threshold','bins':['<0.5N','0.5N..N','N..2N','>=2N'],'permutations':PERMS,'permutation_seed':SEED,'multiple_testing':'Holm family alpha 0.05'},'results':res,'holm':holm,'aggregate':agg};raw=json.dumps({'metadata':meta,'series':series},ensure_ascii=False,separators=(',',':')).encode()
with gzip.open(OG,'wb',compresslevel=9) as f:f.write(raw)
gz=open(OG,'rb').read();summary={**meta,'dataset':{'storage_location':OG,'sha256_gzip':hashlib.sha256(gz).hexdigest(),'size_bytes_gzip':len(gz),'sha256_uncompressed':hashlib.sha256(raw).hexdigest(),'size_bytes_uncompressed':len(raw)}}
with open(OS,'w',encoding='utf-8') as f:json.dump(summary,f,ensure_ascii=False,indent=2)
print(json.dumps(agg,ensure_ascii=False),flush=True)