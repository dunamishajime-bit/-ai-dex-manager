from pathlib import Path
import json,os,subprocess,sys,argparse
parser=argparse.ArgumentParser();parser.add_argument('--expected-sha',required=True);parser.add_argument('--source-dir',required=True);args=parser.parse_args()
assert os.geteuid()==0
root=Path('/home/deploy/disdex-trading/current').resolve();sha=root.name
assert sha==args.expected_sha and len(sha)==40
src=Path('/usr/local/libexec');src.mkdir(parents=True,exist_ok=True)
payload={name:(Path(args.source_dir)/name).read_text() for name in ['disdex-account-config-policy.mjs','disdex-account-config-readiness.ts','disdex-q102-pending-recovery-retry.py']}
for name,text in payload.items():
 p=src/name;assert not p.is_symlink();p.write_text(text);os.chmod(p,0o644)
symbols=sorted(set(x+'USDT' for x in ['BTC','ETH','BNB','SOL','LINK','AVAX','DOGE','INJ','XRP','ADA','LTC','ATOM','AAVE','NEAR','APT','ARB','ENA','FIL','ONDO','OP','SEI','SUI','TRX','DOT','FET','LDO','RENDER','UNI','PENGU','HYPE','TIA','AMZN','META','MSFT','NVDA','TSLA']))
Path('/etc/disdex/account-config-symbols.json').write_text(json.dumps(symbols));os.chmod('/etc/disdex/account-config-symbols.json',0o644)
unit=f"""[Unit]
Description=DisDex flat-account 5x Cross configuration readiness
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
User=deploy
Group=deploy
WorkingDirectory={root}
EnvironmentFile=/etc/disdex/disdex-v13d-v11eq-v96.env
EnvironmentFile=/etc/disdex/disdex-v12-pengu-v2-v52.env
EnvironmentFile=/etc/disdex/current-runtime/{sha}.env
Environment=DISDEX_CONFIG_RUNTIME_SHA={sha}
ExecStart={root}/node_modules/.bin/tsx /usr/local/libexec/disdex-account-config-readiness.ts --apply --ack-flat-config-5x-cross
TimeoutStartSec=180s
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/disdex/shared
UMask=0077
"""
Path('/etc/systemd/system/disdex-account-config-readiness.service').write_text(unit)
Path('/etc/systemd/system/disdex-account-config-readiness.timer').write_text("""[Unit]
Description=Audit and repair only flat DisDex symbol account configuration
[Timer]
OnBootSec=2min
OnUnitInactiveSec=5min
RandomizedDelaySec=15s
Unit=disdex-account-config-readiness.service
[Install]
WantedBy=timers.target
""")
archive=Path('/var/lib/disdex/quality102-causal-v1/recovery-archive');assert not archive.is_symlink()
drop=Path('/etc/systemd/system/disdex-quality102-causal-v1@.service.d/95-recovery-archive-ownership.conf')
drop.parent.mkdir(parents=True,exist_ok=True);assert not drop.is_symlink()
base=Path('/etc/systemd/system/disdex-quality102-causal-v1@.service').read_text()
pre=[line for line in base.splitlines() if line.startswith('ExecStartPre=')]
assert any('scripts/disdex-quality102-pending-order-recovery.ts' in line for line in pre)
early=["ExecStartPre=+/usr/bin/install -d -o deploy -g deploy -m 0700 /var/lib/disdex/quality102-causal-v1","ExecStartPre=+/usr/bin/test ! -L /var/lib/disdex/quality102-causal-v1/recovery-archive","ExecStartPre=+/usr/bin/install -d -o deploy -g deploy -m 0700 /var/lib/disdex/quality102-causal-v1/recovery-archive"]
pre=[("ExecStartPre=/usr/bin/python3 /usr/local/libexec/disdex-q102-pending-recovery-retry.py %i" if 'scripts/disdex-quality102-pending-order-recovery.ts' in line else line) for line in pre]
drop.write_text("[Service]\nExecStartPre=\n"+"\n".join(early+pre)+"\n")

subprocess.run(['install','-d','-o','deploy','-g','deploy','-m','0700',str(archive)],check=True)
subprocess.run(['systemctl','daemon-reload'],check=True)
subprocess.run(['systemd-analyze','verify','/etc/systemd/system/disdex-account-config-readiness.service','/etc/systemd/system/disdex-account-config-readiness.timer'],check=True)
subprocess.run(['systemctl','start','--no-block','disdex-account-config-readiness.service'],check=True)
print('CONFIG_READINESS_SUBMITTED',len(symbols))
