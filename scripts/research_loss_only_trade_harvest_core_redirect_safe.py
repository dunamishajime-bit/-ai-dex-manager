"""Redirect-safe high-confidence core harvest.
Transport-only fix over frozen core selection and schema rules.
"""
from __future__ import annotations
import research_loss_only_trade_harvest as h
import research_loss_only_trade_harvest_core as core
import research_loss_only_trade_harvest_redirect_safe as safe

h.req_bytes=safe.redirect_safe_bytes
core.h.req_bytes=safe.redirect_safe_bytes

if __name__=="__main__":
    core.main()
