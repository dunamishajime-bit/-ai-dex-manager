import "dotenv/config";

import { AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

async function main() {
    const killSwitch = await readSharedKillSwitch();
    if (!killSwitch.active || !killSwitch.sourcePath) throw new Error("ASTER_READONLY_RECOVERY_REQUIRES_ACTIVE_KILL_SWITCH");

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
        readOnlyRateLimitMaxRetries: 0,
        userAgent: `DisDex-Aster-Recovery/${String(process.env.DISDEX_RELEASE_SHA || "unknown").slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("ASTER_READONLY_RECOVERY_CREDENTIALS_MISSING");

    const result = await runAsterReadOnlyRecoveryGate(client, {
        requiredConsecutiveSuccesses: numberEnv("DISDEX_ASTER_RECOVERY_CONSECUTIVE_SUCCESSES", 3),
        requestSpacingMs: numberEnv("DISDEX_ASTER_RECOVERY_REQUEST_SPACING_MS", 750),
        roundSpacingMs: numberEnv("DISDEX_ASTER_RECOVERY_ROUND_SPACING_MS", 5_000),
        requireFlat: true,
    });
    console.log(JSON.stringify({
        ...result,
        killSwitchActive: true,
        killSwitchReason: String(killSwitch.reason || ""),
        releaseSha: String(process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || ""),
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "ASTER_READONLY_RECOVERY_STREAK_FAIL",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
    process.exitCode = 1;
});
