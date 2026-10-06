"""Win32 desktop backend; no third-party packages or elevation."""
import base64
import ctypes as C
from ctypes import wintypes as W
import os
import struct
import time
import uuid
import zlib

KEYS = {'CTRL':0x11,'ALT':0x12,'SHIFT':0x10,'WIN':0x5b,'ENTER':13,'TAB':9,'ESC':27,
        'BACKSPACE':8,'DELETE':46,'SPACE':32,'HOME':36,'END':35,'LEFT':37,'UP':38,'RIGHT':39,'DOWN':40,
        'PAGEUP':33,'PAGEDOWN':34, **{chr(i):i for i in range(65,91)}, **{str(i):48+i for i in range(10)},
        **{'F'+str(i):111+i for i in range(1,13)}}

def encode_png(width, height, bgra):
    if width < 1 or height < 1 or len(bgra) != width*height*4: raise ValueError('INVALID_BITMAP')
    rgb = bytearray(width*height*3)
    rgb[0::3], rgb[1::3], rgb[2::3] = bgra[2::4], bgra[1::4], bgra[0::4]
    rows = b''.join(b'\0'+rgb[y*width*3:(y+1)*width*3] for y in range(height))
    def chunk(kind, data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(rows,6))+chunk(b'IEND',b'')

def validate_actions(actions, width, height):
    for a in actions:
        kind = a.get('kind')
        if kind == 'click':
            if any(type(a.get(k)) is not int for k in ('x','y')) or not 0 <= a['x'] < width or not 0 <= a['y'] < height: raise ValueError('CLICK_OUTSIDE_CAPTURE')
            if a.get('button','left') not in ('left','right','double'): raise ValueError('INVALID_BUTTON')
        elif kind == 'text':
            if not isinstance(a.get('text'),str) or len(a['text'])>10000: raise ValueError('INVALID_TEXT')
        elif kind == 'keys':
            if not a.get('keys') or len(a['keys'])>6 or any(k.upper() not in KEYS for k in a['keys']): raise ValueError('UNKNOWN_KEY')
        elif kind == 'scroll':
            if type(a.get('amount')) is not int or not -20<=a['amount']<=20: raise ValueError('INVALID_SCROLL')
        else: raise ValueError('UNKNOWN_ACTION')

class DATA_BLOB(C.Structure): _fields_ = [('cbData',W.DWORD),('pbData',C.POINTER(C.c_ubyte))]

def protect(raw, decrypt=False):
    if os.name != 'nt': raise OSError('WINDOWS_REQUIRED')
    crypt, kernel = C.WinDLL('crypt32',use_last_error=True), C.WinDLL('kernel32',use_last_error=True)
    kernel.LocalFree.argtypes=[C.c_void_p]; kernel.LocalFree.restype=C.c_void_p
    buf=C.create_string_buffer(raw); source=DATA_BLOB(len(raw),C.cast(buf,C.POINTER(C.c_ubyte))); out=DATA_BLOB()
    func=crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    func.argtypes=[C.POINTER(DATA_BLOB),C.c_void_p,C.c_void_p,C.c_void_p,C.c_void_p,W.DWORD,C.POINTER(DATA_BLOB)]
    func.restype=W.BOOL
    if not func(C.byref(source),None,None,None,None,1,C.byref(out)): raise C.WinError(C.get_last_error())
    try: return C.string_at(out.pbData,out.cbData)
    finally: kernel.LocalFree(out.pbData)

class Desktop:
    def __init__(self):
        if os.name!='nt': raise OSError('WINDOWS_REQUIRED')
        self.u=C.WinDLL('user32',use_last_error=True); self.g=C.WinDLL('gdi32',use_last_error=True)
        self.captures={}
        self._bind(self.u,'SetProcessDpiAwarenessContext',W.BOOL,[C.c_void_p])
        self.u.SetProcessDpiAwarenessContext(C.c_void_p(-4))
        H=C.c_void_p
        for name,result,args in [('OpenInputDesktop',H,[W.DWORD,W.BOOL,W.DWORD]),('CloseDesktop',W.BOOL,[H]),
            ('GetUserObjectInformationW',W.BOOL,[H,C.c_int,H,W.DWORD,C.POINTER(W.DWORD)]),
            ('GetDC',H,[H]),('ReleaseDC',C.c_int,[H,H]),('GetSystemMetrics',C.c_int,[C.c_int]),
            ('SetCursorPos',W.BOOL,[C.c_int,C.c_int]),('mouse_event',None,[W.DWORD,W.DWORD,W.DWORD,W.DWORD,C.c_size_t]),
            ('SendInput',W.UINT,[W.UINT,H,C.c_int]),('IsWindowVisible',W.BOOL,[H]),
            ('GetWindowTextLengthW',C.c_int,[H]),('GetWindowTextW',C.c_int,[H,W.LPWSTR,C.c_int])]: self._bind(self.u,name,result,args)
        for name,result,args in [('CreateCompatibleDC',H,[H]),('CreateCompatibleBitmap',H,[H,C.c_int,C.c_int]),
            ('SelectObject',H,[H,H]),('DeleteObject',W.BOOL,[H]),('DeleteDC',W.BOOL,[H]),
            ('BitBlt',W.BOOL,[H,C.c_int,C.c_int,C.c_int,C.c_int,H,C.c_int,C.c_int,W.DWORD]),
            ('GetDIBits',C.c_int,[H,H,W.UINT,W.UINT,H,H,W.UINT])]: self._bind(self.g,name,result,args)
    @staticmethod
    def _bind(lib,name,result,args):
        fn=getattr(lib,name);fn.restype=result;fn.argtypes=args
    def available(self):
        handle=self.u.OpenInputDesktop(0,False,1)
        if not handle: return False
        try:
            name=C.create_unicode_buffer(256); needed=W.DWORD()
            return bool(self.u.GetUserObjectInformationW(handle,2,name,C.sizeof(name),C.byref(needed)) and name.value.lower()=='default')
        finally: self.u.CloseDesktop(handle)
    def dimensions(self): return tuple(self.u.GetSystemMetrics(i) for i in (76,77,78,79))
    def require(self):
        if not self.available(): raise ValueError('DESKTOP_LOCKED_OR_SECURE')
    def screenshot(self):
        self.require(); x,y,w,h=self.dimensions()
        if w<1 or h<1 or w*h>16_000_000: raise ValueError('SCREEN_SIZE_UNSUPPORTED')
        dc=self.u.GetDC(None); mem=None; bitmap=None; old=None
        try:
            if not dc: raise C.WinError(C.get_last_error())
            mem=self.g.CreateCompatibleDC(dc); bitmap=self.g.CreateCompatibleBitmap(dc,w,h)
            if not mem or not bitmap: raise C.WinError(C.get_last_error())
            old=self.g.SelectObject(mem,bitmap)
            if not self.g.BitBlt(mem,0,0,w,h,dc,x,y,0x40cc0020): raise C.WinError(C.get_last_error())
            self.g.SelectObject(mem,old); old=None
            info=C.create_string_buffer(struct.pack('<IiiHHIIiiII',40,w,-h,1,32,0,w*h*4,0,0,0,0))
            pixels=C.create_string_buffer(w*h*4)
            if self.g.GetDIBits(dc,bitmap,0,h,pixels,info,0)!=h: raise C.WinError(C.get_last_error())
            png=encode_png(w,h,pixels.raw)
            if len(png)>4_000_000: raise ValueError('SCREENSHOT_TOO_LARGE')
        finally:
            if old and mem: self.g.SelectObject(mem,old)
            if bitmap: self.g.DeleteObject(bitmap)
            if mem: self.g.DeleteDC(mem)
            if dc: self.u.ReleaseDC(None,dc)
        key=str(uuid.uuid4()); self.captures={key:(time.monotonic(),(x,y,w,h))}
        return {'capture_id':key,'width':w,'height':h,'origin_x':x,'origin_y':y,'image':base64.b64encode(png).decode()}
    def key(self,vk,up=False,unicode=False):
        class Mouse(C.Structure): _fields_=[('dx',W.LONG),('dy',W.LONG),('data',W.DWORD),('flags',W.DWORD),('time',W.DWORD),('extra',C.c_size_t)]
        class Key(C.Structure): _fields_=[('vk',W.WORD),('scan',W.WORD),('flags',W.DWORD),('time',W.DWORD),('extra',C.c_size_t)]
        class Hardware(C.Structure): _fields_=[('msg',W.DWORD),('low',W.WORD),('high',W.WORD)]
        class Union(C.Union): _fields_=[('mouse',Mouse),('key',Key),('hardware',Hardware)]
        class Input(C.Structure): _fields_=[('type',W.DWORD),('data',Union)]
        event=Input();event.type=1;event.data.key=Key(0 if unicode else vk,vk if unicode else 0,(2 if up else 0)|(4 if unicode else 0),0,0)
        if self.u.SendInput(1,C.byref(event),C.sizeof(event))!=1: raise ValueError('INPUT_BLOCKED_BY_WINDOWS')
    def perform(self,capture_id,actions,paused):
        capture=self.captures.get(capture_id)
        if not capture or time.monotonic()-capture[0]>120 or capture[1]!=self.dimensions(): raise ValueError('CAPTURE_EXPIRED_TAKE_SCREENSHOT_AGAIN')
        x,y,w,h=capture[1];validate_actions(actions,w,h);done=0
        try:
            for a in actions:
                if paused.is_set(): raise ValueError('PC_PAUSED')
                self.require();kind=a['kind']
                if kind=='click':
                    if not self.u.SetCursorPos(x+a['x'],y+a['y']): raise ValueError('CURSOR_FAILED')
                    button=a.get('button','left'); down,up=(8,16) if button=='right' else (2,4)
                    for _ in range(2 if button=='double' else 1): self.u.mouse_event(down,0,0,0,0);self.u.mouse_event(up,0,0,0,0)
                elif kind=='scroll': self.u.mouse_event(0x800,0,0,(a['amount']*120)&0xffffffff,0)
                elif kind=='text':
                    data=a['text'].encode('utf-16-le')
                    for i in range(0,len(data),2):
                        if paused.is_set(): raise ValueError('PC_PAUSED')
                        code=int.from_bytes(data[i:i+2],'little');self.key(code,unicode=True);self.key(code,up=True,unicode=True)
                elif kind=='keys':
                    pressed=[]
                    try:
                        for name in a['keys']: code=KEYS[name.upper()];self.key(code);pressed.append(code)
                    finally:
                        for code in reversed(pressed): self.key(code,up=True)
                done+=1
            return {'executed':done}
        except (ValueError,OSError) as e: return {'status':'error','executed':done,'error':str(e),'do_not_replay':True}
    def windows(self):
        self.require();found=[]
        callback=C.WINFUNCTYPE(W.BOOL,C.c_void_p,C.c_ssize_t)
        def visit(hwnd,param):
            if self.u.IsWindowVisible(hwnd):
                length=self.u.GetWindowTextLengthW(hwnd)
                if length:
                    text=C.create_unicode_buffer(min(length+1,1024));self.u.GetWindowTextW(hwnd,text,len(text));found.append({'handle':str(hwnd),'title':text.value})
            return len(found)<200
        self.u.EnumWindows.argtypes=[callback,C.c_ssize_t];self.u.EnumWindows.restype=W.BOOL
        self.u.EnumWindows(callback(visit),0);return found
