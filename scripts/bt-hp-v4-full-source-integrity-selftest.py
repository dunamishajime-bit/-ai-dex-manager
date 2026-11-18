"""BT-481-I offline V4 upstream source integrity checks. No HTTP/VPS/LIVE."""
import hashlib,json,subprocess,sys
from pathlib import Path
sys.dont_write_bytecode=True
repo=Path(r'C:\tmp\disdex-bt-visual-gross-20261114')
source=repo/'lib/bt-verification/pinned-native-v4-full'
man=json.loads((source/'source-manifest.json').read_text(encoding='utf-8-sig'))
assert man['gitRevision']=='9118eeaa6c209dc6e37887cf5be139b3baaa005d'
assert man['sourceType']=='offline_git_object_only'
assert man['economicParityCertified'] is False
assert man['ordersAuthorized'] is False
assert man['liveRunnerCodeImported'] is False
assert man['productionMutations']==0
for x in man['files']:
 original=subprocess.run(['git','-C',str(repo),'show',man['gitRevision']+':'+x['original']],check=True,capture_output=True).stdout
 got=hashlib.sha256(original).hexdigest()
 assert got==x['originalGitBlobSha256'],(x['original'],'upstream',got,x['originalGitBlobSha256'])
 actual=(source/x['copied']).read_bytes()
 text=actual.decode('utf-8-sig')
 for item in reversed(x['importPathOnlyEdits']):
  assert text.count(item['new'])==1,(x['copied'],item['new'],'unrecognized import change')
  text=text.replace(item['new'],item['old'],1)
 # Normalize only LF/CRLF when proving equivalent pre-import source.
 reconstructed=text.replace('\r\n','\n').encode('utf-8')
 assert reconstructed==original.replace(b'\r\n',b'\n'),(
     x['copied'],'unexpected non-import edits',
     hashlib.sha256(reconstructed).hexdigest(),
     hashlib.sha256(original).hexdigest())
 print('PASS V4 frozen raw Git SHA and imports-only:'+x['copied'])
# Prove the two frozen shared dependency modules needed by the main V4
# candidate builder, and distinguish type-only import redirection from
# genuine source-code changes.
risk_original=subprocess.run(
 ['git','-C',str(repo),'show',man['gitRevision']+
  ':config/integratedProductionRiskPolicy.ts'],
 check=True,capture_output=True).stdout
risk_copy=(repo/'lib/bt-verification/pinned-native-pengu/integratedProductionRiskPolicy.ts').read_bytes()
assert risk_original.replace(b'\r\n',b'\n')==risk_copy.replace(b'\r\n',b'\n'),"V4_RISK_SOURCE_DEPENDENCY_CHANGED"
core_original=subprocess.run(
 ['git','-C',str(repo),'show',man['gitRevision']+':lib/v12-v4-native-core.ts'],
 check=True,capture_output=True).stdout
core_copy=(repo/'lib/bt-verification/pinned-native-v4/v12-v4-native-core.ts').read_bytes().decode('utf-8-sig')
assert core_copy.count('from "./native-v12-bar-type"')==1,"V4_NATIVE_CORE_IMPORT_REDIRECT_MISSING"
core_unmodified=core_copy.replace('from "./native-v12-bar-type"',
 'from "./v12-x1-all"').replace('\r\n','\n').encode('utf-8')
assert core_unmodified==core_original.replace(b'\r\n',b'\n'),"V4_CORE_OTHER_THAN_TYPE_IMPORT_CHANGED"
print("PASS V4 source policy and H2 native-core upstream integrity (type import only)")
# guard against regression to live side-effect code at import, regardless
# of method under test.
entry=(source/'v12-v4-live-candidate-builder.ts').read_text(encoding='utf-8')
for name in ['placeMarketOrder(', 'placeLimitOrder(', 'cancelOrder(', 'new AsterV3Client(', 'fetch(', 'process.exit(']:
 assert name not in entry,('unexpected IO in native source candidate builder',name)
assert 'buildV4LiveDecisionBatch' in entry
assert 'V12_V4_V2_STATUS' in (source/'v12-v4-v2-shadow.ts').read_text(encoding='utf-8')
print('PASS full V4 frozen source integrity; not live, 0 order authority')
