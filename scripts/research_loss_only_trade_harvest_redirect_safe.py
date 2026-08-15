"""Redirect-safe wrapper for the frozen V96+ trade harvest.

Fixes only GitHub artifact download transport: authenticate the GitHub API request,
then fetch GitHub's signed cross-host redirect WITHOUT forwarding Authorization.
Also enables previously documented record-field aliases (netContributionPct/pnl and
maxFavorable/maxAdverse). Artifact selection, dedupe and one-way research boundaries
remain unchanged. No strategy or blocker rule changes.
"""
from __future__ import annotations

import time
import urllib.error
import urllib.request

import research_loss_only_trade_harvest as h

# Machine-readable schema aliases documented before any blocker discovery.
h.RETURN_KEYS=("netContributionPct","netReturnPct","net_return_pct","netPct","net_pct","tradeReturnPct","trade_return_pct","netPnlPct","net_pnl_pct","pnlPct","pnl_pct","returnPct","return_pct","profitPct","roiPct","pnl")
h.MFE_KEYS=("mfePct","mfe_pct","mfe","maxFavorablePct","maxFavorable")
h.MAE_KEYS=("maePct","mae_pct","mae","maxAdversePct","maxAdverse")

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def redirect_safe_bytes(url):
    last=None
    for k in range(5):
        try:
            api_req=urllib.request.Request(url,headers={
                "Authorization":f"Bearer {h.TOKEN}",
                "Accept":"application/vnd.github+json",
                "X-GitHub-Api-Version":"2022-11-28",
                "User-Agent":"loss-only-trade-harvest-redirect-safe",
            })
            opener=urllib.request.build_opener(_NoRedirect)
            try:
                with opener.open(api_req,timeout=60) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code not in (301,302,303,307,308):
                    raise
                signed=e.headers.get("Location")
                if not signed:
                    raise RuntimeError("ARTIFACT_REDIRECT_WITHOUT_LOCATION")
                # Critical: do NOT send GitHub Authorization to the signed storage host.
                storage_req=urllib.request.Request(signed,headers={"User-Agent":"loss-only-trade-harvest-redirect-safe"})
                with urllib.request.urlopen(storage_req,timeout=120) as r:
                    return r.read()
        except Exception as exc:
            last=exc
            time.sleep(0.75*(2**k))
    raise last

h.req_bytes=redirect_safe_bytes

if __name__=="__main__":
    h.main()
