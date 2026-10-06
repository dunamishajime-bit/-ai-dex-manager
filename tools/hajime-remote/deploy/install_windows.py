import argparse
import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from remote_app.windows import protect

def install(source,token,server_url,launch=True):
    app=Path(os.environ['LOCALAPPDATA'])/'HajimeRemote';app.mkdir(exist_ok=True)
    for name in ('remote_app','tests'):
        shutil.copytree(Path(source)/name,app/name,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__'))
    config=app/'config.json'
    paused=json.loads(config.read_text()).get('paused',False) if config.exists() else False
    config.write_text(json.dumps({'server_url':server_url,'token_dpapi':base64.b64encode(protect(token.encode())).decode(),'paused':paused}),encoding='utf8')
    pythonw=Path(sys.executable).with_name('pythonw.exe')
    startup=Path(os.environ['APPDATA'])/'Microsoft/Windows/Start Menu/Programs/Startup/HajimeRemote.vbs'
    launch_script='Set shell = CreateObject("WScript.Shell")\n'
    launch_script+='shell.CurrentDirectory = "'+str(app)+'"\n'
    command='"'+str(pythonw)+'" -m remote_app.desktop --config "'+str(config)+'"'
    launch_script+='shell.Run "'+command.replace('"','""')+'", 0, False\n'
    startup.write_text(launch_script,encoding='utf8')
    (Path.home()/'Desktop/HajimeRemote.vbs').write_text(launch_script,encoding='utf8')
    if launch: subprocess.Popen([str(pythonw),'-m','remote_app.desktop','--config',str(config)],cwd=app)
    return app

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',required=True);parser.add_argument('--credentials',required=True);args=parser.parse_args()
    credentials=json.loads(Path(args.credentials).read_text());install(args.source,credentials['token'],credentials['server_url'])
