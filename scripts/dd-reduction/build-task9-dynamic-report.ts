import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Task9DynamicRun } from "./run-task9-dynamic";

export interface Task9DynamicReport {
    readonly reportVersion: 1;
    readonly classification: Task9DynamicRun["cumulativeGate"]["status"];
    readonly economicAcceptanceEligible: boolean;
    readonly sourceCoverage: Task9DynamicRun["sourceCoverage"];
    readonly cumulativeGate: Task9DynamicRun["cumulativeGate"];
    readonly cases: readonly {
        readonly caseName: Task9DynamicRun["cases"][number]["caseName"];
        readonly costBps: Task9DynamicRun["cases"][number]["costBps"];
        readonly classification: Task9DynamicRun["cases"][number]["classification"];
        readonly economicAcceptanceEligible: boolean;
        readonly economicMetrics: Task9DynamicRun["cases"][number]["economicMetrics"];
        readonly diagnosticMetrics: Task9DynamicRun["cases"][number]["diagnosticMetrics"];
        readonly stopEvents: number;
        readonly originalWinnerStops: number;
        readonly originalLoserStops: number;
        readonly originalUnknownStops: number;
        readonly cooldownExclusions: number;
        readonly grossReadmissions: number;
        readonly dynamicLotObservations: number;
        readonly preemptionCount: number;
        readonly maximumSameDirectionGross: number | null;
        readonly accountingStatus: "PASS" | "FAIL" | "UNAVAILABLE";
        readonly resultHash: string;
        readonly ledgerHashes: Readonly<Record<string, string>>;
    }[];
    readonly productionChanges: 0;
    readonly liveClaim: false;
    readonly hashes: Task9DynamicRun["hashes"];
}

export function buildTask9DynamicReport(run: Task9DynamicRun): Task9DynamicReport {
    const sourceClassifications = new Set(run.cases.map((item) => item.classification));
    const classification = run.cumulativeGate.status === "BLOCKED_INCOMPLETE_SOURCE_COVERAGE"
        ? run.cumulativeGate.status
        : sourceClassifications.has("BLOCKED_REPLAY") ? "BLOCKED_REPLAY" : run.cumulativeGate.status;
    return {
        reportVersion: 1,
        classification,
        economicAcceptanceEligible: run.cumulativeGate.economicAcceptanceEligible,
        sourceCoverage: run.sourceCoverage,
        cumulativeGate: run.cumulativeGate,
        cases: run.cases.map((item) => ({
            caseName: item.caseName,
            costBps: item.costBps,
            classification: item.classification,
            economicAcceptanceEligible: item.economicAcceptanceEligible,
            economicMetrics: item.economicMetrics,
            diagnosticMetrics: item.diagnosticMetrics,
            stopEvents: item.stopEvents.length,
            originalWinnerStops: item.stopEvents.filter((event) => event.originalOutcome === "WINNER").length,
            originalLoserStops: item.stopEvents.filter((event) => event.originalOutcome === "LOSER").length,
            originalUnknownStops: item.stopEvents.filter((event) => event.originalOutcome === "UNKNOWN").length,
            cooldownExclusions: item.lifecycleAudit.cooldownExclusions,
            grossReadmissions: item.lifecycleAudit.grossReadmissions,
            dynamicLotObservations: item.lifecycleAudit.dynamicLotObservations,
            preemptionCount: item.lifecycleAudit.preemptionCount,
            maximumSameDirectionGross: item.lifecycleAudit.maximumSameDirectionGross,
            accountingStatus: item.economicMetrics?.accountingStatus ?? "UNAVAILABLE",
            resultHash: item.resultHash,
            ledgerHashes: item.ledgerHashes,
        })),
        productionChanges: 0,
        liveClaim: false,
        hashes: run.hashes,
    };
}

export async function writeTask9DynamicReport(run: Task9DynamicRun, outputPath: string): Promise<string> {
    const path = resolve(outputPath);
    await writeFile(path, `${JSON.stringify(buildTask9DynamicReport(run), null, 2)}\n`, "utf8");
    return path;
}

async function main(args: readonly string[]): Promise<void> {
    const input = args[args.indexOf("--input") + 1];
    const output = args[args.indexOf("--output") + 1];
    if (input === undefined || output === undefined) throw new Error("--input and --output are required");
    const run = JSON.parse(await readFile(resolve(input), "utf8")) as Task9DynamicRun;
    await writeTask9DynamicReport(run, output);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main(process.argv.slice(2)).catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}
