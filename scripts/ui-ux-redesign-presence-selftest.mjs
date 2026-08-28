import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const requiredFiles = [
  "components/features/DecisionUi.tsx",
  "hooks/useDecisionStatus.ts",
  "lib/ui/disterminal-ui-view-model.ts",
];
const missing = requiredFiles.filter((file) => !existsSync(join(root, file)));
const homePage = readFileSync(join(root, "app/page.tsx"), "utf8");

if (missing.length || !homePage.includes("buildDecisionViewModel") || !homePage.includes("MetricCard")) {
  throw new Error(`UI_UX_REDESIGN_MISSING files=${missing.join(",") || "none"}`);
}

console.log("UI_UX_REDESIGN_PRESENT");
