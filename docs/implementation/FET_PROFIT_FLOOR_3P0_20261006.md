# FET Profit Floor 3.0% Production Change — 2026-10-06

Approved change only:
- Keep entry gate: 72h return >= +2%.
- Keep hard stop: -5%.
- Keep profit-floor trigger: +5%.
- Change armed profit floor from +0.5% to **+3.0%**.
- Keep maximum hold: 24h.
- Keep post-exit cooldown: 24h.
- Keep Gross and all other strategy logic unchanged.

Integrated 10bps comparison using the same DD12.96 portfolio engine:
- Current +0.5% floor: JPY 4.067358397bn / PF 2.9602 / max DD -12.9646%.
- +2.0% floor: JPY 4.18770bn / PF 2.9623 / max DD -12.9646%.
- +2.5% floor: JPY 4.22819bn / PF 2.9630 / max DD -12.9646%.
- **+3.0% floor: JPY 4.26887bn / PF 2.9637 / max DD -12.9646%.**
- +3.5% and higher degraded the portfolio; peak-trailing variants also degraded it.

Production invariant:
The +3.0% floor begins only after the +5% trigger is observed. It must never loosen once armed.
