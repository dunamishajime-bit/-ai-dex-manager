import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface SharedKillSwitchView {
    configuredPaths: string[];
    active: boolean;
    action?: "HOLD_PROTECTED" | "FLATTEN_MANAGED";
    scope?: "GLOBAL" | "V52_REFERENCE_ONLY";
    operator?: string;
    recoverable?: boolean;
    reason?: string;
    sourcePath?: string;
}

export type SharedKillSwitchConsumer = "GLOBAL" | "V4_CRYPTO";

/**
 * A stale US-equity reference quote is a V52 stock-sleeve hold.  It must be
 * explicitly scoped and attributable; an unscoped or malformed hold remains
 * global fail-closed.
 */
export function isV52ReferenceOnlyHold(value: Pick<SharedKillSwitchView, "active" | "action" | "scope" | "operator" | "recoverable" | "reason">) {
    const reason = String(value.reason || "");
    return value.active === true
        && value.action === "HOLD_PROTECTED"
        && value.scope === "V52_REFERENCE_ONLY"
        && value.operator === "disdex-v52-aster-only"
        && value.recoverable === true
        && reason.startsWith("V52 recoverable tick error: HTTP 503 http://127.0.0.1:8797/quote?symbol=")
        && reason.includes('{"error":"stale_quote"');
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
        const parsed = JSON.parse(await readFile(path, "utf8")) as { active?: unknown; action?: unknown; scope?: unknown; operator?: unknown; recoverable?: unknown; reason?: unknown };
        if (!parsed || typeof parsed !== "object" || typeof parsed.active !== "boolean") throw new Error("SHARED_KILL_SWITCH_MALFORMED");
        const action: SharedKillSwitchView["action"] = parsed.action === "HOLD_PROTECTED" || parsed.action === "FLATTEN_MANAGED"
            ? parsed.action
            : undefined;
        const scope: SharedKillSwitchView["scope"] = parsed.scope === "GLOBAL" || parsed.scope === "V52_REFERENCE_ONLY"
            ? parsed.scope
            : undefined;
        if (parsed.active && !action) throw new Error("SHARED_KILL_SWITCH_MALFORMED");
        const view: SharedKillSwitchView = {
            configuredPaths: paths,
            active: parsed.active,
            action,
            scope,
            operator: typeof parsed.operator === "string" ? parsed.operator : undefined,
            recoverable: parsed.recoverable === true ? true : undefined,
            reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
            sourcePath: path,
        };
        if (view.active && view.scope === "V52_REFERENCE_ONLY" && !isV52ReferenceOnlyHold(view)) {
            throw new Error("SHARED_KILL_SWITCH_MALFORMED");
        }
        return view;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        // Existing production semantics treat an absent kill-switch file as inactive.
        // A malformed or unreadable file is never treated as clear.
        if (code === "ENOENT") return { configuredPaths: paths, active: false, sourcePath: path };
        if (error instanceof Error && error.message === "SHARED_KILL_SWITCH_MALFORMED") throw error;
        throw new Error(`SHARED_KILL_SWITCH_READ_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function assertSharedKillSwitchAllowsNewEntry(
    env: NodeJS.ProcessEnv = process.env,
    options: { consumer?: SharedKillSwitchConsumer } = {},
) {
    const state = await readSharedKillSwitch(env);
    const scopedV52Hold = options.consumer === "V4_CRYPTO" && isV52ReferenceOnlyHold(state);
    if (state.active && !scopedV52Hold) throw new Error(`SHARED_KILL_SWITCH_ACTIVE:${state.reason || "UNSPECIFIED"}`);
    return state;
}
