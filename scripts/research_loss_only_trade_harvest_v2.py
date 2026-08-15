"""Authenticated artifact-harvest transport fix only.

Imports the frozen V96+ loss-only harvester and replaces ONLY artifact ZIP transport:
GitHub's API endpoint is called with GITHUB_TOKEN, but the signed Blob Storage
redirect is followed without forwarding Authorization. Selection, parsing,
normalization, partitioning, loser labels, and all research rules remain unchanged.
"""
from __future__ import annotations

import time
import urllib.error
import urllib.request

import research_loss_only_trade_harvest as base


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def req_bytes(url: str) -> bytes:
    last = None
    opener = urllib.request.build_opener(_NoRedirect)
    for k in range(4):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "Authorization": f"Bearer {base.TOKEN}",
                    "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "User-Agent": "loss-only-trade-harvest-v2",
                },
            )
            try:
                with opener.open(req, timeout=60) as r:
                    return r.read()
            except urllib.error.HTTPError as e:
                if e.code not in (301, 302, 303, 307, 308):
                    raise
                location = e.headers.get("Location")
                if not location:
                    raise RuntimeError("ARTIFACT_REDIRECT_WITHOUT_LOCATION")
                # Signed blob URL must not receive the GitHub bearer token.
                clean_req = urllib.request.Request(
                    location,
                    headers={"User-Agent": "loss-only-trade-harvest-v2-blob"},
                )
                with urllib.request.urlopen(clean_req, timeout=120) as r:
                    return r.read()
        except Exception as exc:
            last = exc
            time.sleep(0.5 * (2**k))
    raise last


base.req_bytes = req_bytes

if __name__ == "__main__":
    base.main()
