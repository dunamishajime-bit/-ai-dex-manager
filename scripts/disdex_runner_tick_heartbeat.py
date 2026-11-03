"""A completed-cycle marker, not an operator approval or trading permission."""
import json,os,re,secrets,stat,tempfile,time
from pathlib import Path


def write_completed_runner_tick(*,root,runner_id,sha,service_unit,started_at,completed_at,status,reason,new_orders_allowed):
    now=time.time_ns()//1000000
    if (runner_id!='V52' or not isinstance(sha,str) or not re.fullmatch('[a-f0-9]{40}',sha)
        or service_unit!='disdex-v52-aster-only@'+sha+'.service'
        or type(started_at) is not int or type(completed_at) is not int
        or not 0<started_at<=completed_at<=now or type(new_orders_allowed) is not bool
        or not isinstance(status,str) or not status.strip() or not isinstance(reason,str)):
        raise ValueError('RUNNER_TICK_IDENTITY_TIME_OR_PERMISSION_INVALID')
    root=Path(root);directory=root/'ticks';directory.mkdir(parents=True,exist_ok=True,mode=0o750)
    if root.is_symlink() or directory.is_symlink():raise ValueError('RUNNER_TICK_DIRECTORY_UNTRUSTED')
    destination=directory/'v52.json'
    if destination.exists() or destination.is_symlink():
        if destination.is_symlink() or not stat.S_ISREG(destination.lstat().st_mode):raise ValueError('RUNNER_TICK_TARGET_UNTRUSTED')
    marker=dict(schema='disdex-runner-tick/v1',runnerId=runner_id,runtimeSha=sha,expectedSha=sha,
        serviceUnit=service_unit,mainPid=os.getpid(),workingDirectory=os.getcwd(),
        tickStartedAt=started_at,tickCompletedAt=completed_at,status=status.strip(),outcome=status.strip(),reason=reason,
        newOrdersAllowed=new_orders_allowed,permissionEvaluation='FINAL_PREORDER_GATES_SEPARATE')
    atomic_runner_health_json(destination,marker)
    return marker


def atomic_runner_health_json(destination,payload):
    destination=Path(destination);directory=destination.parent
    directory.mkdir(parents=True,exist_ok=True,mode=0o750)
    if directory.is_symlink() or destination.is_symlink():raise ValueError('RUNNER_HEALTH_PATH_UNTRUSTED')
    if destination.exists() and not stat.S_ISREG(destination.lstat().st_mode):raise ValueError('RUNNER_HEALTH_TARGET_UNTRUSTED')
    fd,name=tempfile.mkstemp(prefix='.'+destination.name+'.',suffix='.tmp',dir=directory);temporary=Path(name)
    try:
        with os.fdopen(fd,'w',encoding='utf-8') as stream:
            if os.name!='nt':os.fchmod(stream.fileno(),0o640)
            json.dump(payload,stream,sort_keys=True,allow_nan=False);stream.write('\n');stream.flush();os.fsync(stream.fileno())
        for attempt in range(40):
            try:os.replace(temporary,destination);break
            except PermissionError:
                if os.name!='nt' or attempt==39:raise
                time.sleep(min(100,5*(attempt+1))/1000+secrets.randbelow(25)/1000)
        if os.name!='nt':
            directory_fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(directory_fd)
            finally:os.close(directory_fd)
    finally:temporary.unlink(missing_ok=True)
