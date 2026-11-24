import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

/** Only the exact SHA-pinned immutable release may update the shared risk latch. */
export class SharedRiskWriterNotPinnedError extends Error {
    constructor() {
        super("SHARED_RISK_WRITER_NOT_PINNED");
        this.name = "SharedRiskWriterNotPinnedError";
    }
}

type PinIdentityOptions = {
    pinsPath?: string;
    releaseBase?: string;
    workingDirectory?: string;
};

const SHA_RE = /^[0-9a-f]{40}$/;

export async function checkSharedRiskWriterPin(options: PinIdentityOptions = {}): Promise<{
    pinned: boolean;
    pinnedSha: string;
    runtimeSha: string;
}> {
    const pinsPath = options.pinsPath ?? "/etc/disdex/runner-pins.json";
    const releaseBase = options.releaseBase ?? "/home/deploy/disdex-trading/releases";
    const workingDirectory = options.workingDirectory ?? process.cwd();
    const stat = await lstat(pinsPath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("SHARED_RISK_PINS_NOT_REGULAR");
    const pins = JSON.parse(await readFile(pinsPath, "utf8")) as {
        runners?: { SHARED_CRYPTO_RISK?: { sha?: unknown; serviceUnit?: unknown } };
    };
    const row = pins?.runners?.SHARED_CRYPTO_RISK;
    const pinnedSha = row?.sha;
    if (typeof pinnedSha !== "string" || !SHA_RE.test(pinnedSha)
        || row?.serviceUnit !== "disdex-shared-crypto-risk@" + pinnedSha + ".service") {
        throw new Error("SHARED_RISK_PIN_IDENTITY_INVALID");
    }
    const [base, cwd] = await Promise.all([realpath(releaseBase), realpath(workingDirectory)]);
    const runtimeSha = path.basename(cwd);
    if (path.dirname(cwd) !== base || !SHA_RE.test(runtimeSha)) {
        throw new Error("SHARED_RISK_EXECUTION_RELEASE_INVALID");
    }
    const markerPath = path.join(cwd, ".disdex-release-sha");
    const markerStat = await lstat(markerPath);
    if (!markerStat.isFile() || markerStat.isSymbolicLink()
        || (await readFile(markerPath, "utf8")).trim() !== runtimeSha) {
        throw new Error("SHARED_RISK_EXECUTION_MARKER_INVALID");
    }
    return { pinned: runtimeSha === pinnedSha, pinnedSha, runtimeSha };
}

export async function assertSharedRiskWriterPinned(options: PinIdentityOptions = {}): Promise<void> {
    const result = await checkSharedRiskWriterPin(options);
    if (!result.pinned) throw new SharedRiskWriterNotPinnedError();
}
