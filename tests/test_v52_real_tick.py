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
