"""Semantic parity check: standalone untouched-holdout event engine vs the original locked 6h research engine."""
import contextlib, io, json, datetime as dt
with contextlib.redirect_stdout(io.StringIO()):
    import analyze_v12_failed_break_sensitivity as old
import run_v12_untouched_holdout as new

H=new.H
JULY=int(dt.datetime(2026,7,1,tzinfo=dt.timezone.utc).timestamp()*1000)
AUG11=int(dt.datetime(2026,8,11,tzinfo=dt.timezone.utc).timestamp()*1000)

# Old locked 6h selected events from frozen historical data.
old_sel=old.select(old.events['WINDOW_6H'])
old_rows=[x for x in old_sel if JULY<=x['entry_ts_ms']<AUG11]
old_keys={(x['symbol'],x['side'],x['entry_ts_ms']) for x in old_rows}

# Re-run the independently written holdout engine on the separately refetched, parity-proven data.
new.START=JULY
new.ENTRY_END=AUG11
h1={s:new.load(s) for s in new.SYMS}
h2={s:new.h2_series(h1[s]) for s in new.SYMS}
maps={s:{b['end']:i for i,b in enumerate(a)} for s,a in h2.items()}
new_rows=new.select(new.build_events(h1,h2,maps))
new_keys={(x['symbol'],x['side'],x['entry_ts_ms']) for x in new_rows}

report={
 'window':'2026-07-01T00:00Z..2026-08-11T00:00Z',
 'old_selected':len(old_rows),'new_selected':len(new_rows),
 'common':len(old_keys&new_keys),
 'old_only':[list(x) for x in sorted(old_keys-new_keys)],
 'new_only':[list(x) for x in sorted(new_keys-old_keys)],
 'exact_event_key_parity':old_keys==new_keys
}
out=new.BASE/'semantic-parity-report.json'
out.write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2))
if not report['exact_event_key_parity']: raise SystemExit(2)
