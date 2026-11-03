"""Local marker/actual wrapper-method fixtures; never connects to a venue."""
import ast,json,os,sys,tempfile,time,unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from types import SimpleNamespace
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from disdex_runner_tick_heartbeat import write_completed_runner_tick,atomic_runner_health_json

SHA='a'*40

class TickWriterTest(unittest.TestCase):
 def test_monitor_state_writer_also_survives_eighty_same_pid_collisions(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/'health.json'
   with ThreadPoolExecutor(max_workers=16) as pool:
    list(pool.map(lambda n:atomic_runner_health_json(path,dict(sequence=n)),range(80)))
   self.assertIn(json.loads(path.read_text())['sequence'],range(80))
   self.assertEqual([p.name for p in Path(folder).iterdir()],['health.json'])

 def test_real_identity_and_atomic_eighty_same_pid_same_millisecond_writes(self):
  with tempfile.TemporaryDirectory() as folder:
   now=time.time_ns()//1000000
   def write(index):return write_completed_runner_tick(root=Path(folder),runner_id='V52',sha=SHA,
    service_unit='disdex-v52-aster-only@'+SHA+'.service',started_at=now-1,completed_at=now,
    status='held',reason='KILL_SWITCH_HOLD_PROTECTED',new_orders_allowed=False)
   with ThreadPoolExecutor(max_workers=16) as pool:rows=list(pool.map(write,range(80)))
   result=json.loads((Path(folder)/'ticks/v52.json').read_text())
   self.assertEqual(result['schema'],'disdex-runner-tick/v1');self.assertEqual(result['mainPid'],os.getpid())
   self.assertEqual(result['workingDirectory'],os.getcwd());self.assertEqual(result['tickCompletedAt'],now)
   self.assertFalse(result['newOrdersAllowed']);self.assertEqual(len(rows),80)
   self.assertEqual([p.name for p in (Path(folder)/'ticks').iterdir()],['v52.json'])

 def test_invalid_identity_time_or_failed_publication_does_not_replace_a_real_tick(self):
  with tempfile.TemporaryDirectory() as folder:
   now=time.time_ns()//1000000
   args=dict(root=Path(folder),runner_id='V52',sha=SHA,service_unit='disdex-v52-aster-only@'+SHA+'.service',
    started_at=now-1,completed_at=now,status='held',reason='KILL_SWITCH',new_orders_allowed=False)
   write_completed_runner_tick(**args);path=Path(folder)/'ticks/v52.json';before=path.read_bytes()
   for changes in [dict(sha='b'*40),dict(runner_id='V12_V4'),dict(completed_at=now+999999),dict(started_at=True),dict(new_orders_allowed='false')]:
    with self.assertRaises(ValueError):write_completed_runner_tick(**{**args,**changes})
   with patch('disdex_runner_tick_heartbeat.os.fsync',side_effect=OSError('fixture atomic write failure')):
    with self.assertRaises(OSError):write_completed_runner_tick(**args)
   self.assertEqual(path.read_bytes(),before);self.assertEqual(len(list(path.parent.iterdir())),1)

class WrapperCompletionTest(unittest.TestCase):
 def test_monitor_read_failure_retains_last_actual_tick_without_inventing_a_new_one(self):
  tree=ast.parse(Path('scripts/disdex_v52_aster_only_live_engine.py').read_text(encoding='utf-8-sig'))
  nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ['build_v52_monitor_tick','run_monitor_only_daemon']]
  writes=[];clock=iter([1000,1100,2000,2100]);count=0
  class Runner:
   stop_requested=False
   def preflight(self,read_only):
    nonlocal count
    count+=1
    if count==2:self.stop_requested=True;raise RuntimeError('reference stale')
    return dict(positions={})
  env=dict(os=os,Path=Path,json=json,base=SimpleNamespace(now_ms=lambda:next(clock),bool_env=lambda key,default=False:key=='DISDEX_V52_MONITOR_ONLY'),
   time=SimpleNamespace(sleep=lambda seconds:None),_atomic_monitor_json=lambda path,value:writes.append((path,value)))
  with patch.dict(os.environ,{'DISDEX_RELEASE_SHA':SHA}),patch('builtins.print'):
   exec(compile(ast.Module(body=nodes,type_ignores=[]),'actual-monitor-loop','exec'),env)
   env['run_monitor_only_daemon'](Runner(),True)
  health=[value for path,value in writes if value.get('schema')=='disdex-v52-monitor-heartbeat/v1']
  self.assertEqual(len(health),2);self.assertEqual(health[0]['lastTickAt'],1100)
  self.assertEqual(health[1]['lastTickAt'],1100);self.assertEqual(health[1]['heartbeatAt'],2100)

 def test_actual_wrapper_methods_emit_only_after_engine_and_state_persistence_complete(self):
  tree=ast.parse(Path('scripts/disdex_v52_aster_only_live_engine.py').read_text(encoding='utf-8-sig'))
  original=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='V52AsterOnlyEngine')
  methods=[n for n in original.body if isinstance(n,ast.FunctionDef) and n.name in ['tick','idle_tick']]
  events=[]
  class Parent:
   def tick(self,prepared):
    events.append('engine')
    if getattr(self,'failure',False):raise ValueError('fixture input error')
   idle_tick=tick
  cls=ast.ClassDef(name='Wrapper',bases=[ast.Name(id='Parent',ctx=ast.Load())],keywords=[],body=methods,decorator_list=[])
  module=ast.fix_missing_locations(ast.Module(body=[cls],type_ignores=[]))
  env=dict(Parent=Parent,base=SimpleNamespace(now_ms=lambda:1000))
  exec(compile(module,'actual-v52-methods','exec'),env)
  instance=env['Wrapper']();instance._refresh_idle_admission_heartbeat=lambda:events.append('state')
  instance._publish_completed_tick=lambda *args,**kwargs:events.append('tick')
  for method in ['tick','idle_tick']:
   events.clear();getattr(instance,method)({});self.assertEqual(events,['engine','state','tick'])
   events.clear();instance.failure=True
   with self.assertRaises(ValueError):getattr(instance,method)({})
   self.assertEqual(events,['engine']);instance.failure=False

if __name__=='__main__':unittest.main()
