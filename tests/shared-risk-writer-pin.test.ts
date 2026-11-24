import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
    assertSharedRiskWriterPinned,
    checkSharedRiskWriterPin,
    SharedRiskWriterNotPinnedError,
} from "../lib/disdex-shared-risk-writer-pin";

const sha1 = "a".repeat(40);
const sha2 = "b".repeat(40);

async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), "shared-risk-pin-"));
    const releases = path.join(root, "releases");
    const current = path.join(releases, sha1);
    const other = path.join(releases, sha2);
    const pinsPath = path.join(root, "pins.json");
    await mkdir(current, { recursive: true });
    await mkdir(other, { recursive: true });
    await writeFile(path.join(current, ".disdex-release-sha"), sha1 + "\n");
    await writeFile(path.join(other, ".disdex-release-sha"), sha2 + "\n");
    const setPinned = async (sha: string) => writeFile(pinsPath, JSON.stringify({
        runners: { SHARED_CRYPTO_RISK: { sha, serviceUnit: "disdex-shared-crypto-risk@" + sha + ".service" } },
    }));
    await setPinned(sha1);
    return { root, releases, current, other, pinsPath, setPinned, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("only exact pinned immutable release may refresh risk", async () => {
    const f = await fixture();
    try {
        assert.equal((await checkSharedRiskWriterPin({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.current })).pinned, true);
        await assertSharedRiskWriterPinned({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.current });
        assert.equal((await checkSharedRiskWriterPin({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.other })).pinned, false);
        await assert.rejects(
            assertSharedRiskWriterPinned({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.other }),
            SharedRiskWriterNotPinnedError,
        );
        await f.setPinned(sha2);
        await assert.rejects(
            assertSharedRiskWriterPinned({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.current }),
            SharedRiskWriterNotPinnedError,
        );
        await assertSharedRiskWriterPinned({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.other });
    } finally { await f.cleanup(); }
});

test("rejects stale/missing pin contracts and forged release marker", async () => {
    const f = await fixture();
    try {
        const opts = { pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.current };
        await writeFile(f.pinsPath, JSON.stringify({ runners: { SHARED_CRYPTO_RISK: { sha: sha1, serviceUnit: "wrong" } } }));
        await assert.rejects(checkSharedRiskWriterPin(opts), /SHARED_RISK_PIN_IDENTITY_INVALID/);
        await f.setPinned(sha1);
        await writeFile(path.join(f.current, ".disdex-release-sha"), sha2);
        await assert.rejects(checkSharedRiskWriterPin(opts), /SHARED_RISK_EXECUTION_MARKER_INVALID/);
        await writeFile(path.join(f.current, ".disdex-release-sha"), sha1);
        await assert.rejects(checkSharedRiskWriterPin({ ...opts, workingDirectory: f.root }), /SHARED_RISK_EXECUTION_RELEASE_INVALID/);
        await rm(f.pinsPath);
        await assert.rejects(checkSharedRiskWriterPin(opts), /ENOENT/);
    } finally { await f.cleanup(); }
});

test("symlinked pin file is not accepted", async (t) => {
    const f = await fixture();
    try {
        const realPins = path.join(f.root, "real-pins.json");
        await writeFile(realPins, await (await import("node:fs/promises")).readFile(f.pinsPath));
        await rm(f.pinsPath);
        try {
            await symlink(realPins, f.pinsPath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EPERM") {
                t.skip("Windows host does not permit unprivileged symlinks; Linux CI covers this case");
                return;
            }
            throw error;
        }
        await assert.rejects(
            checkSharedRiskWriterPin({ pinsPath: f.pinsPath, releaseBase: f.releases, workingDirectory: f.current }),
            /SHARED_RISK_PINS_NOT_REGULAR/,
        );
    } finally { await f.cleanup(); }
});
