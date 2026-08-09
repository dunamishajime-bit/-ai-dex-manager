import { resolve } from "node:path";

export function resolveV52PenguPaths() {
    const stateRoot = resolve(process.env.DISDEX_V52_PENGU_STATE_DIR || process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || ".runtime-state/disdex-v52-pengu");
    // The integrated LIVE unit owns the shared Stock state at the explicit
    // DISDEX_V52_ASTER_ONLY_STATE_DIR path. Do not derive a second
    // `stock-v52` directory from the combined root: that silently hides the
    // formally migrated runner-live.json and makes startup fail closed.
    const configuredStockStateRoot = process.env.DISDEX_V52_ASTER_ONLY_STATE_DIR;
    return {
        stateRoot,
        penguStateRoot: resolve(stateRoot, "pengu-dual-ls-v1"),
        stockStateRoot: resolve(configuredStockStateRoot || resolve(stateRoot, "stock")),
        killSwitchPath: resolve(process.env.DISDEX_V52_PENGU_KILL_SWITCH_FILE || resolve(stateRoot, "kill-switch.json")),
    };
}
