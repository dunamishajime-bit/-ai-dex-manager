# VPS Runner Deployment Layout Addendum

This addendum is authoritative for `docs/implementation/PLUS_VPS_RUNNER_HANDOFF.md`.

The current deploy scripts intentionally fail closed until Codex reviews the real VPS layout. Configure this additional repository variable:

| Variable | Required value |
|---|---|
| `VPS_DEPLOYMENT_LAYOUT_MODE` | Leave unset during initial inspection. Set to `in-place-reviewed` only after confirming that checkout, `npm ci`, build and reload in `VPS_APP_DIR` cannot corrupt a currently running UI or trading process. |

Before setting `in-place-reviewed`, Codex must verify all of the following over SSH:

1. The live UI can safely tolerate an in-place source checkout and `.next` rebuild before its reload.
2. The running trading daemon does not dynamically import changed source files before an approved restart.
3. `.env` and runtime state are untracked and survive exact-SHA checkout.
4. `npm ci` and build cannot delete or overwrite runtime state.
5. Rollback to the previous SHA and rebuild is valid for the actual service layout.

If any point is false or uncertain, do **not** set `in-place-reviewed`. Modify `vps-deploy-ui.sh` and `vps-deploy-trading-code.sh` to use the VPS's existing atomic release/symlink layout, add focused static tests, and document the exact release paths. Do not weaken or remove the fail-closed layout gate merely to make a workflow pass.

The initial permitted sequence is therefore:

1. install the dedicated `disdex-vps` runner;
2. configure read-only inspection variables;
3. run inspection;
4. review the deployment layout;
5. either set `VPS_DEPLOYMENT_LAYOUT_MODE=in-place-reviewed` with evidence or implement atomic releases;
6. only then test UI deployment and trading-code staging;
7. keep `VPS_ENABLE_APPROVED_TRADING_RESTART=false` and do not restart the trading daemon in this setup task.
