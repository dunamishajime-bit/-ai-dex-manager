#!/usr/bin/env bash
# After owner-approved UI cutover. Never touches trading/STOP/Kill Switch.
set -Eeuo pipefail
umask 077
[[ "$EUID" == '0' ]]
[[ "${TARGET_SHA:-}" =~ ^[a-f0-9]{40}$ ]] || { echo INVALID_TARGET_SHA; exit 40; }
svc='ai-dex-manager-ui.service'
cfg='/etc/nginx/sites-enabled/ai-dex-manager'
cwd="$(systemctl show "$svc" -p WorkingDirectory --value)"
[[ "$(systemctl is-active "$svc")" == 'active' ]]
[[ -d "$cwd" && ! -L "$cwd" && -f "$cwd/.disdex-release-sha" ]]
[[ "$(tr -d '[:space:]' < "$cwd/.disdex-release-sha")" == "$TARGET_SHA" ]] || { echo UI_SHA_MISMATCH; exit 41; }
[[ -f "$cfg" && ! -L "$cfg" && "$(stat -c %u "$cfg")" == '0' ]]
for route in owner-session-probe live-portfolio; do
 code="$(curl -sS --max-time 12 -o /dev/null -w '%{http_code}' "http://127.0.0.1:3001/api/system/$route")"
 [[ "$code" == '401' ]] || { echo "ANON_DENIAL_PRECHECK_FAILED:$route:$code"; exit 42; }
done
backup="/var/lib/disdex-hp-deploy/owner-probe-$TARGET_SHA-$(date -u +%Y%m%dT%H%M%SZ)"
install -d -o root -g root -m 0700 "$backup"
cp -a -- "$cfg" "$backup/nginx-before.conf"
rollback() {
 rc=$?
 trap - ERR
 set +e
 cp -a -- "$backup/nginx-before.conf" "$cfg"
 nginx -t >/dev/null 2>&1 && systemctl reload nginx >/dev/null 2>&1
 echo NGINX_AUTH_PROBE_ROLLBACK_ATTEMPTED
 exit "$rc"
}
trap rollback ERR
python3 - "$cfg" <<'PY'
from pathlib import Path
import os,sys,tempfile
p=Path(sys.argv[1]);s=p.read_text()
start='location = /__disdex_auth_probe_protected_readonly {'
old='proxy_pass http://127.0.0.1:3001/api/system/runner-health;'
new='proxy_pass http://127.0.0.1:3001/api/system/owner-session-probe;'
if s.count(start)!=1:raise SystemExit('OWNER_PROBE_BLOCK_NOT_UNIQUE')
a,b=s.split(start,1);block,tail=b.split('}',1)
if 'internal;' not in block or 'proxy_set_header Cookie ' not in block:raise SystemExit('OWNER_PROBE_GUARDS_MISSING')
if s.count('auth_request /__disdex_auth_probe_protected_readonly;')<7:raise SystemExit('AUTH_GATES_MISSING')
if block.count(new)==1 and old not in block:
 print('NGINX_PROBE_ALREADY_CORRECT');sys.exit(0)
if block.count(old)!=1 or new in block:raise SystemExit('OWNER_PROBE_UNEXPECTED_TARGET')
newtext=a+start+block.replace(old,new)+'}'+tail
fd,tmp=tempfile.mkstemp(prefix='.disdex-owner-probe-',dir=p.parent)
try:
 os.fchmod(fd,0o644)
 with os.fdopen(fd,'w') as f:
  f.write(newtext);f.flush();os.fsync(f.fileno())
 os.replace(tmp,p)
except:
 if os.path.exists(tmp):os.unlink(tmp)
 raise
PY
nginx -t >/dev/null
systemctl reload nginx
anon="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' 'https://professional-dismanager.net/api/system/live-portfolio')"
home="$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' 'https://professional-dismanager.net/')"
[[ "$anon" == '401' && "$home" == '200' ]] || { echo NGINX_OWNER_PROBE_POSTCHECK_FAILED; false; }
trap - ERR
echo STATUS=NGINX_SIGNED_OWNER_PROBE_VERIFIED
echo TRADING_MUTATION=0