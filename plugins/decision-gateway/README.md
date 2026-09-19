# Decision Gateway

A zero-API-cost local gate for ChatGPT/Codex workflows.

It has two jobs:
1. Reduce large logs/diffs before they reach the model.
2. Return PASS / FAIL / UNKNOWN / NEED_SOL from explicit checks.

The plugin never places orders, changes production state, or calls paid AI APIs.

## Local use

Reduce a large log before giving it to a model:

```
python scripts/decision_gateway.py reduce --input app.log --max-lines 80
```

Judge explicit checks:

```
python scripts/decision_gateway.py judge --input examples/disdex-health-input.json
```

Reduce evidence and judge in one call:

```
python scripts/decision_gateway.py pipeline --input checks.json --evidence app.log
```

Routes:
- LOCAL_ONLY: deterministic result is sufficient.
- GATHER_EVIDENCE: collect named missing facts.
- SOL_RECOMMENDED: contradictory or genuinely reasoning-heavy evidence remains.

This is an advisory router. It does not switch the selected ChatGPT/Codex model by itself.
