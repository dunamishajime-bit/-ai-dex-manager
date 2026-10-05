#!/usr/bin/env bash
set -Eeuo pipefail
old=e9f69394dacbf9abac63829529462714e8316c56
new=ba38937cb2a22316b8fa2c6b11d3a07eebf7daca
b=/var/lib/disdex/deployment-backups/resident-stop-cutover-$new
root=/home/deploy/disdex-trading
families=(v12-x1-all pengu-dual-ls-v2 quality102-causal-v1 v52-aster-only fet-brk48 hype-long idle-priority-short shared-crypto-risk v12-v52-margin-guard)
monitors=(disdex-current-runtime-coherence-guard disdex-runner-watchdog disdex-runner-position-recovery disdex-runner-health-snapshot disdex-runner-health-alert disdex-trade-fill-notifier disdex-v12-three-hour-health-check aster-trade-history-git-sync)
[[ "$(readlink -f "$root/current")" == "$root/releases/$new" ]]
[[ -f "$root/releases/$old/.disdex-release-sha" ]]
for m in "${monitors[@]}"; do systemctl stop "$m.timer" "$m.service"; done
systemctl stop disdex-v12-kill-switch-auto-repair.path disdex-v12-kill-switch-auto-repair.service
for f in "${families[@]}"; do systemctl stop "disdex-$f@$new.service"; done
trap 'echo ROLLBACK_FAIL_CLOSED_EXISTING_VENUE_STOPS_PRESERVED >&2; exit 1' ERR
set -a
. /etc/disdex/disdex-v13d-v11eq-v96.env
. /etc/disdex/disdex-v12-pengu-v2-v52.env
. /etc/disdex/disdex-quality102-causal-v1.env
. /etc/disdex/current-runtime/$new.env
set +a
cd "$root/releases/$new"
node --import tsx /var/tmp/dd1296-readonly-postflight.mts > "$b/rollback-venue-preflight.json"
python3 - "$b" "$old" <<'PY'
import json,pathlib,sys,os
b=pathlib.Path(sys.argv[1]);old=sys.argv[2]
d=json.loads((b/'rollback-venue-preflight.json').read_text())
assert len(d['positions'])==1 and len(d['orders'])==1,'POSITION_CHANGED_REQUIRES_EXPLICIT_COMPATIBILITY_RECONCILIATION'
p=d['positions'][0];o=d['orders'][0]
assert p['symbol']=='FETUSDT' and float(p['positionAmt'])==515 and float(p['entryPrice'])==0.2407
assert o['orderId']==568441254 and o['reduceOnly'] and float(o['origQty'])==515 and float(o['stopPrice'])==0.2419
root=pathlib.Path('/var/lib/disdex')
for f in ['v12-x1-all/runner.json','pengu-dual-ls-v2/runner-live.json','quality102-causal-v1/state.json','hype-zec-long/runner.json','idle-priority/state.json','idle-priority/residual-long-state.json','v52-aster-only/runner-live.json']:
 s=json.loads((root/f).read_text())
 assert not any(s.get(k) for k in ['position','positions','pending','pendingOrder','pendingEntry','manualReview']),(f,'ROLLBACK_COMPATIBILITY_REQUIRED')
# Preserve current state and accounting/cooldowns; never restore stale trading state.
for name in ['idle-priority-parity-cert.json','idle-residual-long-parity-cert.json']:
 p=root/'shared'/name
 prior=json.loads((b/name).read_text());assert prior['runtimeSha']==old
 t=p.with_suffix('.rollback-next');t.write_text(json.dumps(prior,indent=2)+'\n');os.chmod(t,p.stat().st_mode);os.chown(t,p.stat().st_uid,p.stat().st_gid);os.replace(t,p)
p=root/'shared/operator-activation/current.json';a=json.loads(p.read_text());a['approvedSha']=old
a['enabledRunners']=['V12_X1.00_ALL','PENGU_DUAL_LS_V2_FINAL','QUALITY102_CAUSAL_V1','V52_ASTER_ONLY','FET_BRK48_RESIDUAL','HYPE_TREND_LONG','IDLE_PRIORITY_SHORT']
a['rollbackFrom']='ba38937cb2a22316b8fa2c6b11d3a07eebf7daca'
t=p.with_suffix('.rollback-next');t.write_text(json.dumps(a,indent=2)+'\n');os.chmod(t,0o600);os.chown(t,0,0);os.replace(t,p)
PY
ln -s "$root/releases/$old" "$root/current.rollback-next"
mv -Tf "$root/current.rollback-next" "$root/current"
DISDEX_CURRENT_RUNTIME_DEFER_OPERATOR_AUTOMATION=true /usr/local/sbin/disdex-current-runtime-wiring --apply
for f in "${families[@]}"; do systemctl enable --now "disdex-$f@$old.service"; done
cp "$b/ui-release.conf" /etc/systemd/system/ai-dex-manager-ui.service.d/90-current-ui-release.conf
systemctl daemon-reload
systemctl restart ai-dex-manager-ui.service disdex-stock-reference-free.service
for m in "${monitors[@]}"; do systemctl start "$m.timer"; done
systemctl start disdex-v12-kill-switch-auto-repair.path
/usr/local/sbin/disdex-current-runtime-coherence-guard --check
echo ROLLBACK_SWITCHED_REQUIRES_FRESH_VENUE_STATE_RISK_HP_VERIFICATION
