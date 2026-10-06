"""Windows Job Object owns every managed child, including after parent exit."""
import ctypes as C
from ctypes import wintypes as W

class Job:
    def __init__(self):
        self.k=C.WinDLL('kernel32',use_last_error=True)
        class Basic(C.Structure):
            _fields_=[('process_time',C.c_longlong),('job_time',C.c_longlong),('flags',W.DWORD),('min_working',C.c_size_t),('max_working',C.c_size_t),('active',W.DWORD),('affinity',C.c_size_t),('priority',W.DWORD),('scheduling',W.DWORD)]
        class IO(C.Structure): _fields_=[(name,C.c_ulonglong) for name in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
        class Extended(C.Structure): _fields_=[('basic',Basic),('io',IO),('process_memory',C.c_size_t),('job_memory',C.c_size_t),('peak_process',C.c_size_t),('peak_job',C.c_size_t)]
        for name,result,args in [('CreateJobObjectW',C.c_void_p,[C.c_void_p,W.LPCWSTR]),('SetInformationJobObject',W.BOOL,[C.c_void_p,C.c_int,C.c_void_p,W.DWORD]),('AssignProcessToJobObject',W.BOOL,[C.c_void_p,C.c_void_p]),('TerminateJobObject',W.BOOL,[C.c_void_p,W.UINT]),('CloseHandle',W.BOOL,[C.c_void_p])]:
            fn=getattr(self.k,name);fn.restype=result;fn.argtypes=args
        self.handle=self.k.CreateJobObjectW(None,None)
        if not self.handle: raise C.WinError(C.get_last_error())
        info=Extended();info.basic.flags=0x2000 # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not self.k.SetInformationJobObject(self.handle,9,C.byref(info),C.sizeof(info)):
            self.close();raise C.WinError(C.get_last_error())
    def attach_and_resume(self,process):
        if not self.k.AssignProcessToJobObject(self.handle,int(process._handle)): raise C.WinError(C.get_last_error())
        n=C.WinDLL('ntdll');n.NtResumeProcess.argtypes=[C.c_void_p];n.NtResumeProcess.restype=W.LONG
        if n.NtResumeProcess(int(process._handle))!=0: raise OSError('MANAGED_PROCESS_RESUME_FAILED')
    def stop(self):
        if self.handle: self.k.TerminateJobObject(self.handle,1)
    def close(self):
        if self.handle: self.k.CloseHandle(self.handle);self.handle=None
