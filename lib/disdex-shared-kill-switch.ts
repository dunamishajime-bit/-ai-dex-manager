import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SharedKillSwitchView {
    configuredPaths: string[];
    active: boolean;
    reason?: string;
    sourcePath?: string;
}

const ENV_NAMES = [
    "DISDEX_SHARED_KILL_SWITCH_FILE",
    "DISDEX_V13D_V11EQ_V96_KILL_SWITCH_FILE",
    "DISDEX_V52_ASTER_ONLY_KILL_SWITCH_FILE",
    "DISDEX_V96_KILL_SWITCH_FILE",
    "PENGU_DUAL_LS_V2_KILL_SWITCH_FILE",
] as const;

function configuredPaths(env: NodeJS.ProcessEnv = process.env) {
    return [...new Set(ENV_NAMES.map((name) => String(env[name] || "").trim()).filter(Boolean).map((value) => resolve(value)))];
}

export async function readSharedKillSwitch(env: NodeJS.ProcessEnv = process.env): Promise<SharedKillSwitchView> {
    const paths = configuredPaths(env);
    if (paths.length > 1) throw new Error(`SHARED_KILL_SWITCH_PATH_MISMATCH:${paths.join(",")}`);
    if (!paths.length) return { configuredPaths: [], active: false };
    const path = paths[0];
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as { active?: unknown; reason?: unknown };
        if (!parsed || typeof parsed !== "object" || typeof parsed.active !== "boolean") throw new Error("SHARED_KILL_SWITCH_MALFORMED");
        return {
            configuredPaths: paths,
            active: parsed.active,
            reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
            sourcePath: path,
        };
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        // Existing production semantics treat an absent kill-switch file as inactive.
        // A malformed or unreadable file is never treated as clear.
        if (code === "ENOENT") return { configuredPaths: paths, active: false, sourcePath: path };
        if (error instanceof Error && error.message === "SHARED_KILL_SWITCH_MALFORMED") throw error;
        throw new Error(`SHARED_KILL_SWITCH_READ_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function assertSharedKillSwitchAllowsNewEntry(env: NodeJS.ProcessEnv = process.env) {
    const state = await readSharedKillSwitch(env);
    if (state.active) throw new Error(`SHARED_KILL_SWITCH_ACTIVE:${state.reason || "UNSPECIFIED"}`);
    return state;
}
