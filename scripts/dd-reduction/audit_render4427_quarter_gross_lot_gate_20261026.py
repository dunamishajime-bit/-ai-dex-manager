#!/usr/bin/env python3
"""Read-only, pinned-source RENDER #4427 quantity-gate audit. No Native8 imports or orders."""
import hashlib
import json
import re
import subprocess
import urllib.request

REF = "939b59da49ce7960485a2004b0068dc63417ae82"
PINS = {
    "lib/idle-quantity-feasibility.ts": "4d87b6456f75077aabb1db2422c960d95386ae6ffbb924b878d40a8eeeef664d",
    "lib/idle-priority-short-runner.ts": "0a5682f30add54b7f03714c8b40596af80f6b80cd04b360c6009f62f3cb22f33",
    "lib/idle-priority-short-live.ts": "185e0991cb810bba903dfa299df70f5a1e805fe6d9b76242247e672bcd30889c",
    "config/idlePriorityShortPolicy.ts": "6e08ee22503bc44da771cad89320f9d53ac75682881a5efd6eeaf6286e7d7aa8",
}
BASE = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/" + REF + "/"

def load_pinned():
    result = {}
    for path, expected in PINS.items():
        with urllib.request.urlopen(BASE + path, timeout=20) as response:
            raw = response.read()
        actual = hashlib.sha256(raw).hexdigest()
        if actual != expected:
            raise RuntimeError("PIN_MISMATCH:" + path)
        result[path] = raw.decode("utf-8")
    return result

# The only TypeScript evaluated is the pinned, pure quantity-feasibility module,
# stripped of its type annotations by Node's own stripTypeScriptTypes. It has
# no imports, external dependencies, filesystem writes, Native8 or venue calls.
NODE = r"""
const { stripTypeScriptTypes } = require('node:module');
let source = '';
process.stdin.on('data', c => source += c);
process.stdin.on('end', async () => {
  const stripped = stripTypeScriptTypes(source, { mode: 'strip' });
  const mod = await import('data:text/javascript;base64,' + Buffer.from(stripped).toString('base64'));
  const cases = [
    ['RENDER_025', 0.25, 10000, 100, 0.01],
    ['DOT_025', 0.25, 10000, 100, 0.01],
    ['RENDER_025_ALT_PRICE', 0.25, 10000, 25, 0.01],
    ['RENDER_0125', 0.125, 10000, 100, 0.01],
    ['ONE_X_CONTROL', 1, 10000, 100, 0.01],
    ['ONE_X_FLOOR', 1, 10000, 101, 1]
  ];
  const results = cases.map(([name,gross,equity,price,step]) => {
    const targetQty = equity * gross / price;
    const qty = Math.floor((targetQty + 1e-12) / step) * step;
    const verdict = mod.evaluateIdleOneStepFloor({
      symbol: name.startsWith('DOT') ? 'DOTUSDT' : 'RENDERUSDT',
      equityUsd: equity, referencePrice: price,
      normalizedQuantity: qty, normalizedNotional: qty * price,
      minQuantity: 0.001, maxQuantity: 100000, quantityStep: step,
      minNotional: 5
    });
    return {name, gross, verdict};
  });
  process.stdout.write(JSON.stringify(results));
});
"""

def main():
    src = load_pinned()
    lot = src["lib/idle-quantity-feasibility.ts"]
    runner = src["lib/idle-priority-short-runner.ts"]
    live = src["lib/idle-priority-short-live.ts"]
    policy = src["config/idlePriorityShortPolicy.ts"]
    if re.search(r"(?m)^\s*import\b", lot):
        raise RuntimeError("LOT_MODULE_NOT_PURE")
    for sym in ("DOTUSDT", "RENDERUSDT"):
        if not re.search(r"\b" + sym + r":\s*\{[^}]*\bgross:\s*0\.25\b", policy):
            raise RuntimeError("ROUTE_GROSS_NOT_PINNED:" + sym)
    if not all(s in lot for s in (
        "const desired = x.equityUsd / x.referencePrice;",
        "const expectedFloor = Math.floor((desired + toler) / x.quantityStep) * x.quantityStep;",
        "requiredGross:1", "if (gross < 0.99-1e-9)"
    )):
        raise RuntimeError("ONE_X_LOT_CONTRACT_CHANGED")
    if not all(s in live for s in (
        "const requestedGross = input.symbol ? IDLE_PRIORITY_SHORT_POLICY.routes[input.symbol].gross : 1;",
        "gross: requestedGross"
    )):
        raise RuntimeError("ADMISSION_GROSS_CONTRACT_CHANGED")
    needles = [
        "const requestedGross = IDLE_PRIORITY_SHORT_POLICY.routes[symbol].gross;",
        "normalizeMarketQuantity(symbol, equity * requestedGross / quote.bidPrice, quote.bidPrice)",
        "const lot = evaluateIdleOneStepFloor({",
        "if (!lot.accepted) {",
        "const reservation = await lock.reserve(",
        "this.dependencies.executor.executeMarket({"
    ]
    positions = [runner.index(s) for s in needles]
    if positions != sorted(positions):
        raise RuntimeError("RUNNER_ORDER_CHANGED")
    process = subprocess.run(
        ["node", "--no-warnings", "-e", NODE],
        input=lot.encode("utf-8"), stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, timeout=30, check=True
    )
    cases = json.loads(process.stdout)
    expected = {
        "RENDER_025": (False, "QUANTITY_NOT_ONE_STEP_FLOOR"),
        "DOT_025": (False, "QUANTITY_NOT_ONE_STEP_FLOOR"),
        "RENDER_025_ALT_PRICE": (False, "QUANTITY_NOT_ONE_STEP_FLOOR"),
        "RENDER_0125": (False, "QUANTITY_NOT_ONE_STEP_FLOOR"),
        "ONE_X_CONTROL": (True, "FULL_1X_EXACT"),
        "ONE_X_FLOOR": (True, "VENUE_STEP_ROUNDING_OK"),
    }
    for item in cases:
        verdict = item["verdict"]
        if (verdict["accepted"], verdict["code"]) != expected[item["name"]]:
            raise RuntimeError("UNEXPECTED_NATIVE_TS_VERDICT:" + item["name"])
    payload = {
        "schema": "render4427-pinned-quarter-gross-lot-audit/v1",
        "source_ref": REF,
        "source_sha256": PINS,
        "static_chain": "route_025 -> admission_025 -> normalize_025 -> hardcoded_1x_lot_gate -> reject_before_reservation",
        "cases": cases,
        "order_authorized": False,
        "native8_parity_verified": False,
        "production_changed": False,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()
    print(json.dumps({"audit_sha256": hashlib.sha256(canonical).hexdigest(), "result": payload}, sort_keys=True))

if __name__ == "__main__":
    main()
