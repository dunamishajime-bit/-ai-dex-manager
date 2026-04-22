import "dotenv/config";

import { runLiveHybridAutotrade } from "@/lib/server/live-hybrid-autotrade";

async function main() {
    const summary = await runLiveHybridAutotrade();
    console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
    console.error("[run-live-hybrid-once] failed:", error);
    process.exitCode = 1;
});
