from __future__ import annotations

import json
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("research-results/repaired-independent-20260925")


def audit(root: Path = ROOT) -> dict:
    summary = json.loads((root / "summary.json").read_text())
    source_audit = json.loads((root / "audit-report.json").read_text())
    output: dict = {
        "status": "RESEARCH_DIAGNOSTIC_NOT_PRODUCTION_PARITY",
        "rawBundleSha256": source_audit["rawValidation"]["sha256"],
        "fullOneYear": source_audit["rawValidation"]["period"],
        "v52Included": False,
        "sourceChecksumValidated": True,
        "scenarios": {},
    }
    for key, record in sorted(summary.items()):
        path = root / (key.lower().replace("_current", "-current").replace("_q60_dd170_h72", "-q60_dd170_h72") + "-events.json")
        events = json.loads(path.read_text())
        equity_path = path.with_name(path.name.replace("-events.json", "-equity.json"))
        equity = json.loads(equity_path.read_text())
        entries = [x for x in events if x.get("type") == "ENTRY"]
        exits = [x for x in events if x.get("type") == "EXIT"]
        fees_at_entry = {x["positionId"]: float(x.get("fee", 0)) for x in entries}
        by_logic = defaultdict(lambda: {"entries": 0, "closed": 0, "netPnl": 0.0})
        for event in entries:
            by_logic[event["strategy"]]["entries"] += 1
        for event in exits:
            row = by_logic[event["strategy"]]
            row["closed"] += 1
            row["netPnl"] += (
                float(event["pnl"]) - float(event.get("fee", 0)) +
                float(event.get("funding", 0)) -
                fees_at_entry.get(event["positionId"], 0)
            )
        deposits = [x for x in events if x.get("type") == "DEPOSIT"]
        if len(deposits) != 13 or sum(float(x["amount"]) for x in deposits) != 130000:
            raise RuntimeError("MONTHLY_DEPOSIT_CONTRACT_MISMATCH")
        if len(entries) != len(exits):
            raise RuntimeError("UNCLOSED_POSITION_OR_DUPLICATE_LEDGER")
        if len(entries) != record["tradeCount"]:
            raise RuntimeError("TRADE_COUNT_MISMATCH")
        if not record["metrics"]["ledgerReconciled"]:
            raise RuntimeError("LEDGER_NOT_RECONCILED")
        max_crypto = max((float(x["cryptoGross"]) for x in equity), default=0)
        max_total = max((float(x["totalGross"]) for x in equity), default=0)
        if max_crypto > 3.0 + 1e-9 or max_total > 4.25 + 1e-9:
            raise RuntimeError("PORTFOLIO_GROSS_EXCEEDED_RESEARCH_CAP")
        rejected = Counter(str(x.get("reason")) for x in events if x.get("type") == "REJECT")
        output["scenarios"][key] = {
            "finalEquity": record["finalEquity"],
            "netPf": record["metrics"]["profitFactor"],
            "maxDrawdownPct": record["metrics"]["maxDrawdownPct"],
            "tradeCount": record["tradeCount"],
            "maxCryptoGross": max_crypto,
            "maxTotalGross": max_total,
            "preemptions": len(record["preemptions"]),
            "monthlyDepositCount": len(deposits),
            "lastDepositUtc": datetime.fromtimestamp(max(x["ts_ms"] for x in deposits) / 1000, timezone.utc).isoformat(),
            "sleeves": {name: data for name, data in sorted(by_logic.items())},
            "topRejectReasons": dict(rejected.most_common(8)),
        }
    (root / "audit-detail.json").write_text(json.dumps(output, indent=2, sort_keys=True), encoding="utf-8")
    return output


if __name__ == "__main__":
    print(json.dumps(audit(), sort_keys=True))
