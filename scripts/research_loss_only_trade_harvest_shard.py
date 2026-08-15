"""Shard the frozen redirect-safe broad V96+ artifact harvest by artifact ID modulo N.
Transport/performance only; no selection, parser, outcome, or blocker rule changes.
"""
from __future__ import annotations
import os
import research_loss_only_trade_harvest as h
import research_loss_only_trade_harvest_redirect_safe as safe

COUNT=int(os.environ.get('LOSS_HARVEST_SHARD_COUNT','4'))
INDEX=int(os.environ['LOSS_HARVEST_SHARD_INDEX'])
if COUNT<1 or INDEX<0 or INDEX>=COUNT:raise RuntimeError('INVALID_SHARD')
base_selected=h.selected_artifacts

def selected(arts):
    cutoff,rows=base_selected(arts)
    return cutoff,[a for a in rows if int(a['id'])%COUNT==INDEX]

h.selected_artifacts=selected
h.req_bytes=safe.redirect_safe_bytes
# schema aliases fixed before discovery
h.RETURN_KEYS=safe.h.RETURN_KEYS
h.MFE_KEYS=safe.h.MFE_KEYS
h.MAE_KEYS=safe.h.MAE_KEYS

if __name__=='__main__':h.main()
