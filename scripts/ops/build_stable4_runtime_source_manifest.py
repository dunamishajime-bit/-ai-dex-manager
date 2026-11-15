"""Review-only Git-blob inventory for Stable4 candidate runtime.

Default prints JSON to stdout; never transfers files, reads credentials, or
includes research/reports. --archive creates a TAR only when dependency review
has no unresolved local imports. Inspect manifest and dynamic-path warnings
before any external transfer. Dependencies (node_modules) are NOT included.
"""
import argparse,ast,hashlib,io,json,re,subprocess,tarfile
from pathlib import PurePosixPath,Path

SHA='7a1e2eba208fa4eb6115e6068f1d831f1c44bc2b'
ROOTS=['scripts/v12-v4-production-runner.ts','scripts/v12-v4-monitor-only-runner.ts','scripts/disdex-hype-zec-long-live-runner.ts','scripts/disdex-hype-trend-live-runner.ts','scripts/disdex-quality102-causal-v1-live-runner.ts','scripts/disdex-pengu-dual-ls-v2-live-runner.ts','scripts/disdex-fet-brk48-live-runner.ts','scripts/disdex-idle-priority-short-live-runner.ts','scripts/disdex_v52_aster_only_live_engine.py','scripts/ops/root/disdex-live-operator-activation-gate.mjs','package.json','package-lock.json','tsconfig.json','config/stable4/opportunity-corpus-seed-20261115.json','config/stable4/q102-online-recovery-seed-20261114.json','config/stable4/q102-avax-knn-seed-20261114.json']
ALLOWED_PREFIXES=('lib/','config/','scripts/')
EXTS=('.ts','.tsx','.js','.mjs','.cjs','.py','.json')
DENY=re.compile(r'(^|/)(?:\.env[^/]*|\.git|reports?|research[^/]*|tests?|fixtures?|credentials?|secrets?|private|wallets?|node_modules)(?:/|$)|(?:\.pem|\.key|\.p12|\.pfx)$',re.I)
JS_IMPORT=re.compile(r'''(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?|\b(?:require|import)\s*\(\s*)["']([^"']+)["']''')

def main():
 p=argparse.ArgumentParser();p.add_argument('--archive');args=p.parse_args()
 paths=set(subprocess.check_output(['git','ls-tree','-r','--name-only',SHA],text=True).splitlines())
 missing=[f for f in ROOTS if f not in paths]
 if missing:raise ValueError('PINNED_ROOT_MISSING:'+','.join(missing))
 proc=subprocess.Popen(['git','cat-file','--batch'],stdin=subprocess.PIPE,stdout=subprocess.PIPE)
 def blob(path):
  proc.stdin.write((SHA+':'+path+'\n').encode());proc.stdin.flush()
  header=proc.stdout.readline().decode().strip().split()
  if len(header)!=3 or header[1]!='blob':raise ValueError('NOT_PINNED_BLOB:'+path)
  data=proc.stdout.read(int(header[2]));assert proc.stdout.read(1)==b'\n';return data
 todo=list(ROOTS);seen={};unresolved=[];dynamic=[]
 def candidate(base):
  choices=[base]+[base+ext for ext in EXTS]+[base+'/index'+ext for ext in EXTS]
  return next((x for x in choices if x in paths),None)
 def resolve(source,spec):
  if spec.startswith('@/'):base=spec[2:]
  elif spec.startswith('.'):base=str(PurePosixPath(source).parent.joinpath(spec))
  else:return None
  parts=[]
  for part in base.split('/'):
   if part in ('','.'):continue
   if part=='..':
    if not parts:raise ValueError('IMPORT_ESCAPES_ROOT')
    parts.pop()
   else:parts.append(part)
  found=candidate('/'.join(parts))
  if not found:unresolved.append({'source':source,'import':spec})
  return found
 while todo:
  path=todo.pop()
  if path in seen:continue
  if DENY.search(path) or not (path in ROOTS or path.startswith(ALLOWED_PREFIXES)):
   dynamic.append({'source':path,'kind':'excluded-source-review-required'});continue
  data=blob(path);seen[path]=data
  if path.endswith(('.ts','.tsx','.js','.mjs','.cjs')):
   text=data.decode('utf8')
   for match in JS_IMPORT.finditer(text):
    dep=resolve(path,match.group(1))
    if dep:todo.append(dep)
   for match in re.finditer(r'\b(?:import|require)\s*\(\s*([^\s"\x27])',text):dynamic.append({'source':path,'kind':'dynamic-js-import','offset':match.start()})
  elif path.endswith('.py'):
   tree=ast.parse(data,filename=path)
   for node in ast.walk(tree):
    if isinstance(node,ast.Import):modules=[x.name.split('.')[0] for x in node.names]
    elif isinstance(node,ast.ImportFrom) and node.module:modules=[node.module.split('.')[0]]
    else:modules=[]
    for name in modules:
     dep=next((x for x in ['scripts/'+name+'.py','lib/'+name+'.py',name+'.py'] if x in paths),None)
     if dep:todo.append(dep)
    if isinstance(node,ast.Constant) and isinstance(node.value,str) and node.value.startswith(('scripts/','lib/','config/')) and node.value.endswith(('.py','.ts','.mjs','.json')):
     if node.value in paths:todo.append(node.value)
     else:dynamic.append({'source':path,'kind':'unresolved-python-path','path':node.value})
    if isinstance(node,ast.Call) and isinstance(node.func,ast.Name) and node.func.id=='__import__' and (not node.args or not isinstance(node.args[0],ast.Constant)):dynamic.append({'source':path,'kind':'dynamic-python-import','line':node.lineno})
 proc.stdin.close();proc.wait()
 manifest={'schema':'disdex-stable4-runtime-source-review/v1','sourceSha':SHA,'scope':'REVIEW_ONLY','files':[{'path':name,'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest()} for name,raw in sorted(seen.items())],'unresolvedLocalImports':unresolved,'dynamicPathReview':dynamic,'nodeModulesIncluded':False,'credentialsIncluded':False,'ordersEnabled':False}
 if args.archive:
  if unresolved or dynamic:raise ValueError('DEPENDENCY_REVIEW_INCOMPLETE_NO_ARCHIVE_CREATED')
  output=Path(args.archive)
  if output.exists():raise ValueError('ARCHIVE_ALREADY_EXISTS')
  with tarfile.open(output,'x') as archive:
   for name,raw in sorted(seen.items()):
    info=tarfile.TarInfo(name);info.size=len(raw);info.mode=0o444;info.mtime=0;archive.addfile(info,io.BytesIO(raw))
  manifest['archiveSha256']=hashlib.sha256(output.read_bytes()).hexdigest()
 print(json.dumps(manifest,sort_keys=True,indent=2))
if __name__=='__main__':main()
