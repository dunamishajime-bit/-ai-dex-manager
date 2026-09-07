import { processTradeFillNotificationSpool } from "@/lib/trade-fill-notification";

async function main() {
    const result = await processTradeFillNotificationSpool();
    console.log(JSON.stringify({ component: "trade-fill-notifier", ...result }, null, 2));
}

main().catch((error) => {
    console.error(JSON.stringify({
        component: "trade-fill-notifier",
        status: "ERROR",
        error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
});

