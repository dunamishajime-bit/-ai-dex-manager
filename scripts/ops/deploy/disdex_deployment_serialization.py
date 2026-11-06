"""Kernel serialization for deployments; no API/account lock is disabled.

Monitor-only mutations stay mutually exclusive and exclude every trading
cutover, while permitting the existing shared no-order maintenance lease.
All remaining deployment scopes keep the original exclusive global lock.
"""
import os
from contextlib import contextmanager
from disdex_deployment_contract import SCOPES,validate_order_permission

@contextmanager
def deployment_lock(root,scope,orders_enabled):
    import fcntl
    from disdex_unified_root_gate import _assert_execution_root,assert_private_dir,assert_regular_secure
    if scope not in SCOPES:raise ValueError('unknown deployment serialization scope')
    validate_order_permission(scope,orders_enabled);_assert_execution_root(0);assert_private_dir(root,root_uid=0)
    descriptors=[]
    def take(name,flag):
        path=root/name
        if path.is_symlink():raise ValueError('untrusted deployment lock symlink')
        fd=os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);descriptors.append(fd)
        metadata=assert_regular_secure(path,root_uid=0,private=True);opened=os.fstat(fd)
        if (metadata.st_dev,metadata.st_ino)!=(opened.st_dev,opened.st_ino):raise ValueError('deployment lock identity changed')
        try:fcntl.flock(fd,flag|fcntl.LOCK_NB)
        except BlockingIOError:raise ValueError('another root deployment is in progress')from None
    try:
        if scope=='API_MONITORS':
            take('monitor-execution.lock',fcntl.LOCK_EX)
            take('deployment-execution.lock',fcntl.LOCK_SH)
        else:take('deployment-execution.lock',fcntl.LOCK_EX)
        yield
    finally:
        for fd in reversed(descriptors):os.close(fd)
