"""Interactive owner dashboard. Close minimizes; Exit disconnects."""
import argparse
import base64
import json
import os
from pathlib import Path
import queue
import threading
import tkinter as tk
from tkinter import ttk
from urllib.parse import urlparse

from .actions import Actions
from .agent import Agent, Receipts
from .windows import Desktop, protect


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);args=parser.parse_args()
    path=Path(args.config); config=json.loads(path.read_text(encoding='utf8'))
    url=urlparse(config['server_url'])
    if url.scheme!='https' or not url.hostname or url.username or url.password: raise ValueError('HTTPS_SERVER_REQUIRED')
    # Prevent a second agent from executing the same leased operations.
    import ctypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.CreateMutexW.argtypes=[ctypes.c_void_p,ctypes.c_bool,ctypes.c_wchar_p];kernel.CreateMutexW.restype=ctypes.c_void_p
    mutex=kernel.CreateMutexW(None,False,'Local\\HajimeRemoteAgent')
    if not mutex: raise ctypes.WinError(ctypes.get_last_error())
    if ctypes.get_last_error()==183: return
    token=protect(base64.b64decode(config['token_dpapi']),True).decode()
    desktop=Desktop(); actions=Actions(Path.home(),path.parent,desktop)
    if config.get('paused',False): actions.paused.set()
    receipts=Receipts(path.parent/'receipts.db'); messages=queue.Queue()
    agent=Agent(config,token,actions,receipts,messages.put)
    root=tk.Tk();root.title('Hajime Remote');root.geometry('560x390');root.configure(bg='#111827')
    style=ttk.Style();style.theme_use('clam');style.configure('TFrame',background='#111827');style.configure('TLabel',background='#111827',foreground='#e5e7eb',font=('Yu Gothic UI',11));style.configure('TButton',font=('Yu Gothic UI',11),padding=8)
    frame=ttk.Frame(root,padding=22);frame.pack(fill='both',expand=True)
    ttk.Label(frame,text='Hajime Remote',font=('Yu Gothic UI',22,'bold')).pack(anchor='w')
    ttk.Label(frame,text='このPCとChatを、既存VPSで接続します。').pack(anchor='w',pady=(8,18))
    status=tk.StringVar(value='接続しています…');ttk.Label(frame,textvariable=status).pack(anchor='w')
    code=tk.StringVar(value='接続コードは必要なときに発行できます');ttk.Label(frame,textvariable=code).pack(anchor='w',pady=12)
    def save():
        config['paused']=actions.paused.is_set();temp=path.with_suffix('.tmp');temp.write_text(json.dumps(config),encoding='utf8');os.replace(temp,path)
    def pause():
        agent.pause();save();status.set('停止中：新しい操作を受け付けません')
    def resume():
        actions.paused.clear();save();status.set('接続しています…')
    def emergency():
        pause();threading.Thread(target=actions.stop_all,daemon=True).start();status.set('緊急停止：このアプリが起動したコマンドも停止')
    row=ttk.Frame(frame);row.pack(fill='x',pady=8)
    for label,fn in [('一時停止',pause),('再開',resume),('緊急停止',emergency)]: ttk.Button(row,text=label,command=fn).pack(side='left',padx=(0,8))
    def pairing():
        code.set('コードを発行しています…')
        def worker():
            try:
                result=agent.pair();messages.put(('pair',result))
            except Exception: messages.put(('pair_error',None))
        threading.Thread(target=worker,daemon=True).start()
    ttk.Button(frame,text='Chat接続コードを発行（3分間有効）',command=pairing).pack(fill='x',pady=8)
    def copy_url(): root.clipboard_clear();root.clipboard_append(config['server_url'].rstrip('/')+'/mcp');status.set('プラグイン接続URLをコピーしました')
    ttk.Button(frame,text='Chat用の接続URLをコピー',command=copy_url).pack(fill='x')
    def close():
        actions.paused.set();agent.stop();root.destroy()
    ttk.Button(frame,text='終了・切断',command=close).pack(anchor='e',pady=12)
    root.protocol('WM_DELETE_WINDOW',root.iconify)
    def drain():
        while not messages.empty():
            msg=messages.get_nowait()
            if isinstance(msg,tuple):
                if msg[0]=='pair':
                    pin=msg[1]['pin']
                    code.set('Chat接続コード：'+str(pin)+'（3分間有効）');root.after(180000,lambda:code.set('接続コードの有効期限が切れました'))
                else: code.set('コード発行失敗：接続状況を確認してください')
            else: status.set(msg)
        root.after(500,drain)
    threading.Thread(target=agent.run,daemon=True).start();drain();root.mainloop()

if __name__=='__main__': main()
