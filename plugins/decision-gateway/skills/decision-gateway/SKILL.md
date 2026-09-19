---
name: decision-gateway
description: Reduce large logs, diffs, and operational evidence locally, then classify whether a task can be answered from deterministic facts or should be escalated to deeper reasoning.
---

Use this skill when a task includes large logs/diffs, repeated operational checks,
deployment readiness, incident triage, or the user wants to conserve expensive model usage.

Primary goal: minimize model context and repeated reasoning without hiding uncertainty.

Workflow:
1. Prefer deterministic evidence over prose reasoning.
2. Convert mechanical facts into explicit checks with status pass/fail/unknown.
3. If large evidence and checks are both available, prefer one pipeline call to reduce tool steps.
4. Otherwise reduce text >200 lines or >20 KB before judging.
5. Treat the returned route as advisory, not as permission to take external actions.

Routing rules:
- PASS + LOCAL_ONLY: answer from verified facts; avoid extra deep reasoning.
- FAIL + LOCAL_ONLY: report the failed hard check and stop the unsafe workflow.
- UNKNOWN: gather the specifically named missing evidence before reasoning further.
- NEED_SOL: pass only sol_payload to deeper reasoning when the product surface supports it.
- Never claim that this skill itself switched models. It only recommends escalation.

Safety:
- Never authorize trading, deployment, kill-switch release, or destructive actions solely from a model score.
- For production systems, hard checks remain fail-closed.
- Preserve source identifiers, SHAs, timestamps, service names, and exact error lines.
- Do not replace contradictory evidence with a summary; contradictions force NEED_SOL.
- No external AI API is required or permitted by this skill.

For DisDex production checks, also read references/disdex-production.md.
