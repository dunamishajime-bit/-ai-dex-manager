import assert from "node:assert/strict";

import { resolveV52PenguPaths } from "./disdex-v52-pengu-paths";

const previousStateRoot = process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR;
const previousStockStateRoot = process.env.DISDEX_V52_ASTER_ONLY_STATE_DIR;

try {
    process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR = "/srv/shared/disdex-v13d-v11eq-v96";
    process.env.DISDEX_V52_ASTER_ONLY_STATE_DIR = "/srv/shared/disdex-v13d-v11eq-v96/stock";
    const explicit = resolveV52PenguPaths();
    assert.equal(explicit.stockStateRoot.endsWith(`${process.platform === "win32" ? "\\" : "/"}stock`), true);
    assert.ok(!explicit.stockStateRoot.endsWith("stock-v52"));

    delete process.env.DISDEX_V52_ASTER_ONLY_STATE_DIR;
    const derived = resolveV52PenguPaths();
    assert.equal(derived.stockStateRoot.endsWith(`${process.platform === "win32" ? "\\" : "/"}stock`), true);

    console.log(JSON.stringify({
        status: "DISDEX_V52_PENGU_STATE_PATH_SELFTEST_PASS",
        explicitStatePath: explicit.stockStateRoot,
        derivedStatePath: derived.stockStateRoot,
        legacyStockV52PathCreated: false,
    }));
} finally {
    if (previousStateRoot === undefined) delete process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR;
    else process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR = previousStateRoot;
    if (previousStockStateRoot === undefined) delete process.env.DISDEX_V52_ASTER_ONLY_STATE_DIR;
    else process.env.DISDEX_V52_ASTER_ONLY_STATE_DIR = previousStockStateRoot;
}
