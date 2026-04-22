import fs from "fs/promises";
import path from "path";

import { renderComparisonMarkdown, writeBacktestArtifacts } from "@/lib/backtest/reporting";
import { runHybridComparison } from "@/lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "hybrid-retq22");

async function main() {
    const { baseline, retq22 } = await runHybridComparison();

    await fs.mkdir(REPORT_DIR, { recursive: true });
    const baselineFiles = await writeBacktestArtifacts(baseline, REPORT_DIR);
    const retq22Files = await writeBacktestArtifacts(retq22, REPORT_DIR);
    const comparisonMd = path.join(REPORT_DIR, "comparison.md");
    await fs.writeFile(comparisonMd, renderComparisonMarkdown(baseline, retq22), "utf8");

    const output = {
        comparison: {
            baseline: baseline.summary,
            retq22: retq22.summary,
        },
        files: {
            baseline: baselineFiles,
            retq22: retq22Files,
            comparisonMd,
        },
    };

    console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
