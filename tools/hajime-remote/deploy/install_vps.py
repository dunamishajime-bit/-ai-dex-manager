"""Install only the independent Hajime Remote service, with nginx rollback."""
import argparse
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import time

ROUTES='''
    # BEGIN HAJIME REMOTE
    location ^~ /hajime-remote/ {
        proxy_pass http://127.0.0.1:8798;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 35s;
        client_max_body_size 8m;
    }
    location = /.well-known/oauth-authorization-server/hajime-remote {
        proxy_pass http://127.0.0.1:8798;
    }
    location = /.well-known/oauth-protected-resource/hajime-remote/mcp {
        proxy_pass http://127.0.0.1:8798;
    }
    # END HAJIME REMOTE
'''

def nginx_config(text):
    if '# BEGIN HAJIME REMOTE' in text: return text
    # Match this known TLS virtual host, leaving all existing locations intact.
    host=re.search(r'server_name\s+professional-dismanager\.net[^;]*;',text)
    if not host: raise ValueError('EXPECTED_NGINX_HOST_NOT_FOUND')
    start=text.rfind('server {',0,host.start())
    if start<0 or not re.search(r'listen\s+443\b',text[start:host.start()]): raise ValueError('EXPECTED_TLS_SERVER_NOT_FOUND')
    return text[:host.end()]+ROUTES+text[host.end():]

def run(*args): subprocess.run(args,check=True,stdout=subprocess.DEVNULL)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--source',required=True);args=parser.parse_args()
    if os.geteuid()!=0: raise ValueError('ROOT_INSTALLER_REQUIRED')
    config=json.loads(Path(args.config).read_text())
    try: account=pwd.getpwnam('hajime-remote')
    except KeyError:
        run('useradd','--system','--home','/var/lib/hajime-remote','--shell','/usr/sbin/nologin','hajime-remote');account=pwd.getpwnam('hajime-remote')
    confdir=Path('/etc/hajime-remote');state=Path('/var/lib/hajime-remote');confdir.mkdir(exist_ok=True);state.mkdir(exist_ok=True)
    os.chown(state,account.pw_uid,account.pw_gid);state.chmod(0o700)
    config['database_path']=str(state/'state.db')
    target=confdir/'config.json';target.write_text(json.dumps(config));os.chown(target,account.pw_uid,account.pw_gid);target.chmod(0o600)
    source=Path(args.source).resolve()
    unit=f'''[Unit]
Description=Hajime Remote authenticated desktop relay
After=network.target
[Service]
User=hajime-remote
Group=hajime-remote
WorkingDirectory={source}
ExecStart=/usr/bin/python3 -m remote_app.server --config /etc/hajime-remote/config.json
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/hajime-remote
MemoryMax=160M
CPUQuota=20%
TasksMax=64
UMask=0077
[Install]
WantedBy=multi-user.target
'''
    Path('/etc/systemd/system/hajime-remote.service').write_text(unit)
    nginx=Path('/etc/nginx/sites-enabled/ai-dex-manager').resolve();old=nginx.read_text();new=nginx_config(old)
    if old!=new:
        shutil.copy2(nginx,str(nginx)+'.hajime-backup-'+str(int(time.time())))
        nginx.write_text(new)
        try: run('nginx','-t')
        except Exception:
            nginx.write_text(old);raise
    try:
        run('systemctl','daemon-reload');run('systemctl','enable','--now','hajime-remote.service')
        run('systemctl','restart','hajime-remote.service');run('systemctl','reload','nginx')
    except Exception:
        if old!=new: nginx.write_text(old);run('nginx','-t');run('systemctl','reload','nginx')
        raise
    print('HAJIME_VPS_INSTALLED')

if __name__=='__main__': main()
