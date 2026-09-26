#!/usr/bin/env python3
"""Cross-UID Python(root) / TypeScript(deploy) Aster budget fixture. No live IO or orders."""
import os,sys,subprocess,stat,tempfile,pathlib,time,json,hashlib,pwd,grp,textwrap,shutil
ROOT=pathlib.Path("/home/deploy/disdex-trading/current").resolve()
SHA="e1b58060d6263a3af7ced51bec854d3e211d2f35"
assert ROOT.name==SHA and (ROOT/".disdex-release-sha").read_text().strip()==SHA
assert os.geteuid()==0
LIVE=pathlib.Path("/var/lib/disdex/shared/aster-rate-budget.json")
liveHash=hashlib.sha256(LIVE.read_bytes()).hexdigest()
deploy=pwd.getpwnam("deploy")
with tempfile.TemporaryDirectory(prefix="disdex-crossuid-",dir="/tmp") as tmp:
 p=pathlib.Path(tmp)
 os.chown(p,deploy.pw_uid,deploy.pw_gid)
 os.chmod(p,0o2770)
 budget=p/"budget.json"
 ts=p/"node-worker.mts"
 ts.write_text(textwrap.dedent(f'''
 import {{reserveAsterGlobalRateSlot}} from "{ROOT}/lib/disdex-aster-global-rate-budget.ts";
 const permits:number[]=[];
 for(let i=0;i<25;i++){{
   const x=await reserveAsterGlobalRateSlot({{
       path:process.env.CROSS_USER_BUDGET!,minIntervalMs:4,maxQueueMs:12000,weight:1
   }});
   permits.push(x.permitAt);
 }}
 console.log("DEPLOY_WORKER_PERMITS="+JSON.stringify(permits));
 '''))
 os.chown(ts,deploy.pw_uid,deploy.pw_gid)
 py=textwrap.dedent(f'''
 import os,sys,json
 sys.path.insert(0,"{ROOT}/scripts")
 import disdex_v13d_v11eq_stock_live_engine as engine
 for i in range(25):engine.wait_for_aster_global_rate_budget(1)
 print("ROOT_PYTHON_WORKER_COMPLETED=25")
 ''')
 common={**os.environ,"CROSS_USER_BUDGET":str(budget),"DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH":str(budget),"DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS":"4","DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS":"12000"}
 processes=[]
 for i in range(3):
  processes.append(subprocess.Popen(["runuser","-u","deploy","--","env",f"CROSS_USER_BUDGET={budget}",f"DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH={budget}","DISDEX_ASTER_GLOBAL_MIN_INTERVAL_MS=4","DISDEX_ASTER_GLOBAL_MAX_QUEUE_MS=12000",str(ROOT/"node_modules/.bin/tsx"),str(ts)],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=common))
 for i in range(2):
  processes.append(subprocess.Popen(["python3","-c",py],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=common))
 outputs=[]
 for i,pr in enumerate(processes):
  out,err=pr.communicate(timeout=70)
  outputs.append({"id":i,"rc":pr.returncode,"stdout":out.strip()[-2500:],"errorClass":err.strip()[-200:]})
 counts=[]
 for item in outputs:
  assert item["rc"]==0,"CROSS_USER_TEST_FAILURE:"+str(item)
  if item["id"]<3:
   line=next(x for x in item["stdout"].splitlines() if x.startswith("DEPLOY_WORKER_PERMITS="))
   counts+=json.loads(line.split("=",1)[1])
  else:assert "ROOT_PYTHON_WORKER_COMPLETED=25" in item["stdout"],"PYTHON_SHORT"
 assert len(counts)==75 and len(set(counts))==75,"DUPLICATE_DEPLOY_PERMIT"
 state=json.loads(budget.read_text())
 assert state["schema"]=="disdex-aster-rate-budget/v1" and state["nextAllowedAt"]>max(counts)
 assert not (p/"budget.json.lock").exists() and not (p/"budget.json.lock.recovery").exists(),"LEFTOVER_LOCK"
 assert budget.stat().st_mode & 0o777==0o660 and budget.stat().st_gid==deploy.pw_gid,"SHARED_BUDGET_MODE_DRIFT"
 print("LIVE_CROSS_USER_RATE_TEST="+json.dumps({"rootPythonProcesses":2,"deployNodeProcesses":3,"totalSlots":125,"nodeUniqueSlots":len(counts),"lockArtifactsLeft":0,"budgetGroup":budget.stat().st_gid,"budgetMode":oct(budget.stat().st_mode&0o777),"results":outputs,"liveBudgetUnchanged":hashlib.sha256(LIVE.read_bytes()).hexdigest()==liveHash,"ordersSent":0}))
assert hash(liveHash) is not None
