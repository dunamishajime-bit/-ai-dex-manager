from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"Expected patch anchor not found in {relative}: {old[:120]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_all(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    text = path.read_text(encoding="utf-8")
    if old not in text:
        return
    path.write_text(text.replace(old, new), encoding="utf-8")


# Autonomous runner: discard unrelated legacy champions and seed the deep loop from
# three Win80/Ultra90-related research proxies. Production logic is never imported
# as a mutable target and is never auto-promoted.
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    'import { buildChampionDeepDiscussion } from "../lib/research-lab/perp/deep-discussion";\n',
    'import { buildChampionDeepDiscussion } from "../lib/research-lab/perp/deep-discussion";\n'
    'import {\n'
    '  buildMainStrategyResearchAnchors,\n'
    '  focusChampionStateOnMainStrategyLineage,\n'
    '  focusPreviousResultOnMainStrategyLineage,\n'
    '  isMainStrategyLineageGenome,\n'
    '  MAIN_STRATEGY_RESEARCH_POLICY,\n'
    '  mainStrategyResearchPolicyMarkdown,\n'
    '} from "../lib/research-lab/perp/main-strategy-research-policy";\n',
)
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    '  const config = perpResearchConfigFromEnvironment();\n'
    '  config.seed = previous.seed;\n'
    '  config.rounds = 1;\n',
    '  const config = perpResearchConfigFromEnvironment();\n'
    '  config.seed = previous.seed;\n'
    '  config.rounds = 1;\n'
    '  const mainStrategyAnchors = buildMainStrategyResearchAnchors(config);\n'
    '  const focusedDeepState = focusChampionStateOnMainStrategyLineage(previousDeepState);\n'
    '  const focusedPreviousResult = focusPreviousResultOnMainStrategyLineage(previousResult);\n'
    '  const previousLineageElites = previous.eliteGenomes.filter(isMainStrategyLineageGenome);\n',
)
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    '    `[ChampionDeepResearch] cycle=${previous.cycle + 1} profile=${config.profile} champions=${championCount} experimentsPerChampion=${experimentsPerChampion} historicalLogic=${previousLogicRegistry.fingerprints.length}`,\n',
    '    `[MainLineageResearch] cycle=${previous.cycle + 1} main=${MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId} profile=${config.profile} champions=${championCount} experimentsPerChampion=${experimentsPerChampion} previousLineageChampions=${focusedDeepState.champions.length} historicalLogic=${previousLogicRegistry.fingerprints.length}`,\n',
)
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    '    previousState: previousDeepState,\n'
    '    previousResult,\n'
    '    fallbackGenomes: previous.eliteGenomes,\n',
    '    previousState: focusedDeepState,\n'
    '    previousResult: focusedPreviousResult,\n'
    '    fallbackGenomes: [...mainStrategyAnchors, ...previousLineageElites],\n',
)
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    '  const reportMarkdown = `${reflection.markdown}\\n## Deep Discussion Summary\\n\\n${discussion.summary}\\n\\n**CIO Decision:** ${discussion.decision}\\n\\n${dedupReport}`;\n',
    '  const reportMarkdown = `${mainStrategyResearchPolicyMarkdown()}\\n\\n${reflection.markdown}\\n## Deep Discussion Summary\\n\\n${discussion.summary}\\n\\n**CIO Decision:** ${discussion.decision}\\n\\n${dedupReport}`;\n',
)
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    '    profile: deep.profile,\n'
    '    championsBefore: deep.championsBefore,\n',
    '    profile: deep.profile,\n'
    '    researchFocus: MAIN_STRATEGY_RESEARCH_POLICY,\n'
    '    championsBefore: deep.championsBefore,\n',
)
replace_once(
    "scripts/research-lab-autonomous-runner.ts",
    '  await fs.writeFile(deepStatePath, JSON.stringify(deep.state, null, 2), "utf8");\n',
    '  await fs.writeFile(\n'
    '    deepStatePath,\n'
    '    JSON.stringify({ ...deep.state, researchFocus: MAIN_STRATEGY_RESEARCH_POLICY }, null, 2),\n'
    '    "utf8",\n'
    '  );\n',
)
replace_all("scripts/research-lab-autonomous-runner.ts", 'mode: "champion_deep"', 'mode: "win80_ultra90_lineage"')
replace_all("scripts/research-lab-autonomous-runner.ts", 'research_mode: "champion_deep"', 'research_mode: "win80_ultra90_lineage"')
replace_all("scripts/research-lab-autonomous-runner.ts", "[ChampionDeepResearch] completed", "[MainLineageResearch] completed")
replace_all("scripts/research-lab-autonomous-runner.ts", "[ChampionDeepResearch] failed", "[MainLineageResearch] failed")

# Markdown/report language must make the production lock explicit.
replace_once(
    "lib/research-lab/perp/deep-autonomous.ts",
    '    `# Champion Deep Research Cycle ${summary.cycle}`,\n',
    '    `# Win80 / Ultra90 Main-Lineage Research Cycle ${summary.cycle}`,\n',
)
replace_once(
    "lib/research-lab/perp/deep-autonomous.ts",
    '    `- Profile: ${summary.profile}`,\n',
    '    `- Fixed production main: WIN80_ULTRA90_TOP1_V1`,\n'
    '    `- Production auto-promotion: disabled`,\n'
    '    `- Profile: ${summary.profile}`,\n',
)
replace_once(
    "lib/research-lab/perp/deep-autonomous.ts",
    '    "- A child is inherited only when it improves its own parent",\n',
    '    "- A child is inherited only when it improves its own parent",\n'
    '    "- Inheritance applies to the research lineage only and never replaces the production main strategy",\n',
)

# Package command and both CI paths.
package_path = ROOT / "package.json"
package_data = json.loads(package_path.read_text(encoding="utf-8"))
package_data.setdefault("scripts", {})["research:main-lineage:selftest"] = "tsx scripts/research-lab-main-strategy-policy-selftest.ts"
package_path.write_text(json.dumps(package_data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

replace_once(
    ".github/workflows/research-lab-ci.yml",
    '      - name: Research discussion self-test\n'
    '        run: npm run research:discussion:selftest\n',
    '      - name: Main strategy lineage policy self-test\n'
    '        run: npm run research:main-lineage:selftest\n'
    '      - name: Research discussion self-test\n'
    '        run: npm run research:discussion:selftest\n',
)

replace_once(
    ".github/workflows/research-lab-autonomous.yml",
    "name: Champion Deep Research Lab\n",
    "name: Win80 Ultra90 Main-Lineage Research Lab\n",
)
replace_once(
    ".github/workflows/research-lab-autonomous.yml",
    '      - "lib/research-lab/perp/deep-discussion.ts"\n',
    '      - "lib/research-lab/perp/deep-discussion.ts"\n'
    '      - "lib/research-lab/perp/main-strategy-research-policy.ts"\n'
    '      - "scripts/research-lab-main-strategy-policy-selftest.ts"\n',
)
replace_once(
    ".github/workflows/research-lab-autonomous.yml",
    '          echo "PERP_RESEARCH_ROUNDS=1" >> "$GITHUB_ENV"\n',
    '          echo "PERP_RESEARCH_MODE=win80_ultra90_lineage" >> "$GITHUB_ENV"\n'
    '          echo "PERP_RESEARCH_ROUNDS=1" >> "$GITHUB_ENV"\n',
)
replace_once(
    ".github/workflows/research-lab-autonomous.yml",
    '      - name: Research discussion self-test\n'
    '        working-directory: source\n'
    '        run: npm run research:discussion:selftest\n',
    '      - name: Main strategy lineage policy self-test\n'
    '        working-directory: source\n'
    '        run: npm run research:main-lineage:selftest\n'
    '      - name: Research discussion self-test\n'
    '        working-directory: source\n'
    '        run: npm run research:discussion:selftest\n',
)
replace_all(".github/workflows/research-lab-autonomous.yml", "Run Champion Deep Research cycle", "Run Win80 Ultra90 Main-Lineage Research cycle")
replace_all(".github/workflows/research-lab-autonomous.yml", "Champion Deep Research: Forward Paper candidate", "Win80 Ultra90 Lineage: Forward Paper candidate")
replace_all(".github/workflows/research-lab-autonomous.yml", "Champion Deep Research Lab failure", "Win80 Ultra90 Main-Lineage Research failure")
replace_all(".github/workflows/research-lab-autonomous.yml", "Champion Deep Research failed", "Win80 Ultra90 Main-Lineage Research failed")
replace_all(".github/workflows/research-lab-autonomous.yml", "Champion Deep Research recovered", "Win80 Ultra90 Main-Lineage Research recovered")

# Dashboard contract and API normalization.
replace_once(
    "lib/research-lab/dashboard-types.ts",
    'export interface ChampionDeepDashboardSummary {\n'
    '  mode: "champion_deep";\n',
    'export interface MainStrategyResearchFocusSummary {\n'
    '  mode: "win80_ultra90_lineage";\n'
    '  title: string;\n'
    '  mainStrategyId: string;\n'
    '  mainStrategyLocked: boolean;\n'
    '  autoPromotionToMain: boolean;\n'
    '  productionLogicMutable: boolean;\n'
    '  researchTracks: string[];\n'
    '  guardrails: string[];\n'
    '}\n'
    '\n'
    'export interface ChampionDeepDashboardSummary {\n'
    '  mode: "champion_deep" | "win80_ultra90_lineage";\n',
)
replace_once(
    "lib/research-lab/dashboard-types.ts",
    '  nextPlan: string[];\n'
    '}\n'
    '\n'
    'export interface ResearchDashboardPayload {\n',
    '  nextPlan: string[];\n'
    '  researchFocus: MainStrategyResearchFocusSummary | null;\n'
    '}\n'
    '\n'
    'export interface ResearchDashboardPayload {\n',
)

replace_once(
    "app/api/research-lab/latest/route.ts",
    '  nextPlan?: unknown;\n'
    '}\n'
    '\n'
    'function finiteNumber',
    '  nextPlan?: unknown;\n'
    '  researchFocus?: unknown;\n'
    '}\n'
    '\n'
    'function finiteNumber',
)
replace_once(
    "app/api/research-lab/latest/route.ts",
    'function normalizeDeepResearch(value: RawChampionDeepState | null): ChampionDeepDashboardSummary | null {\n',
    'function normalizeResearchFocus(value: unknown): ChampionDeepDashboardSummary["researchFocus"] {\n'
    '  if (!value || typeof value !== "object") return null;\n'
    '  const item = value as Record<string, unknown>;\n'
    '  if (item.mode !== "win80_ultra90_lineage") return null;\n'
    '  return {\n'
    '    mode: "win80_ultra90_lineage",\n'
    '    title: stringValue(item.title, "Win80 / Ultra90 Main-Lineage Research"),\n'
    '    mainStrategyId: stringValue(item.mainStrategyId, "WIN80_ULTRA90_TOP1_V1"),\n'
    '    mainStrategyLocked: item.mainStrategyLocked === true,\n'
    '    autoPromotionToMain: item.autoPromotionToMain === true,\n'
    '    productionLogicMutable: item.productionLogicMutable === true,\n'
    '    researchTracks: stringArray(item.researchTracks),\n'
    '    guardrails: stringArray(item.guardrails),\n'
    '  };\n'
    '}\n'
    '\n'
    'function normalizeDeepResearch(value: RawChampionDeepState | null): ChampionDeepDashboardSummary | null {\n',
)
replace_once(
    "app/api/research-lab/latest/route.ts",
    '  if (!champions.length && !experiments.length) return null;\n'
    '  return {\n'
    '    mode: "champion_deep",\n',
    '  if (!champions.length && !experiments.length) return null;\n'
    '  const researchFocus = normalizeResearchFocus(value.researchFocus);\n'
    '  return {\n'
    '    mode: researchFocus?.mode ?? "champion_deep",\n',
)
replace_once(
    "app/api/research-lab/latest/route.ts",
    '    nextPlan: stringArray(value.nextPlan),\n'
    '  };\n',
    '    nextPlan: stringArray(value.nextPlan),\n'
    '    researchFocus,\n'
    '  };\n',
)

# Dashboard copy and a prominent production-lock banner.
replace_once(
    "components/research-lab/ChampionDeepResearchPanel.tsx",
    '            <h2 className="text-xl font-black text-white md:text-2xl">Champion Deep Research Loop</h2>\n'
    '          </div>\n'
    '          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/60">\n'
    '            上位3ロジックを親として再評価し、各実験は1パラメータだけ変更します。改善基準を複数案が通っても、各Championで最も総合改善が大きい子1件だけを次Cycleへ継承します。\n'
    '          </p>\n',
    '            <h2 className="text-xl font-black text-white md:text-2xl">\n'
    '              {deep.mode === "win80_ultra90_lineage" ? "Win80 / Ultra90 Main-Lineage Research" : "Champion Deep Research Loop"}\n'
    '            </h2>\n'
    '          </div>\n'
    '          <p className="mt-2 max-w-3xl text-xs leading-5 text-white/60">\n'
    '            {deep.mode === "win80_ultra90_lineage"\n'
    '              ? "現在のメイン戦略を固定したまま、厳選Top-1・Ultra90級シグナル・低回転Rotationの近縁ロジックだけを親子比較します。研究結果は自動で本番へ昇格しません。"\n'
    '              : "上位3ロジックを親として再評価し、各実験は1パラメータだけ変更します。改善基準を複数案が通っても、各Championで最も総合改善が大きい子1件だけを次Cycleへ継承します。"}\n'
    '          </p>\n',
)
replace_once(
    "components/research-lab/ChampionDeepResearchPanel.tsx",
    '      </div>\n'
    '\n'
    '      <div className="grid gap-3 xl:grid-cols-3">\n',
    '      </div>\n'
    '\n'
    '      {deep.researchFocus ? (\n'
    '        <div className="rounded-[20px] border border-emerald-300/20 bg-emerald-500/[0.055] p-4">\n'
    '          <div className="flex flex-wrap items-start justify-between gap-3">\n'
    '            <div>\n'
    '              <div className="text-[10px] font-black tracking-[0.16em] text-emerald-200/80">PRODUCTION MAIN LOCKED</div>\n'
    '              <div className="mt-1 text-sm font-black text-white">{deep.researchFocus.mainStrategyId}</div>\n'
    '              <p className="mt-2 text-xs leading-5 text-white/60">\n'
    '                メインロジックは変更せず、研究系統だけを改善します。採用された子もForward Paper候補までで、自動昇格は無効です。\n'
    '              </p>\n'
    '            </div>\n'
    '            <span className="rounded-full border border-emerald-300/25 bg-emerald-500/10 px-3 py-2 text-[10px] font-black text-emerald-100">\n'
    '              MAIN FIXED / AUTO PROMOTION OFF\n'
    '            </span>\n'
    '          </div>\n'
    '          <div className="mt-3 grid gap-2 md:grid-cols-3">\n'
    '            {deep.researchFocus.researchTracks.map((track) => (\n'
    '              <div key={track} className="rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-[11px] leading-5 text-white/60">{track}</div>\n'
    '            ))}\n'
    '          </div>\n'
    '        </div>\n'
    '      ) : null}\n'
    '\n'
    '      <div className="grid gap-3 xl:grid-cols-3">\n',
)

# Documentation: preserve old history, append the new operating policy.
docs_path = ROOT / "docs/research-lab-autonomous.md"
docs = docs_path.read_text(encoding="utf-8")
marker = "## Win80 / Ultra90 Main-Lineage Researchへの方向転換"
if marker not in docs:
    docs += """

## Win80 / Ultra90 Main-Lineage Researchへの方向転換

2026-07-17以降、AI研究ラボの主目的をランダムな上位Champion探索から、既存メイン戦略`WIN80_ULTRA90_TOP1_V1`の深掘りと近縁ロジック開発へ変更する。

### 固定するもの

- 本番メイン戦略は`WIN80_ULTRA90_TOP1_V1`のまま変更しない。
- 研究結果からメイン戦略を自動置換しない。
- 実売買、Wallet、API Key、注文経路へ研究コードを接続しない。
- 同一期間で損失分析後に条件追加した歴史値を、完全未使用OOSと表現しない。

### 新しい3研究系統

1. Win80厳選Top-1: 相対強度、BTCレジーム、Edge/Cost、出来高、時間足の深掘り。
2. Ultra90近縁: 強いBreakoutとVolumeを使い、Score90級の高選別思想を別Familyで再現。
3. Rotation近縁: 利益中50%分割とUltra90優先70%移動の思想を、低回転・高Cost耐性の先物研究Proxyで検証。

旧ChampionがこのLineageに属さない場合は次Cycleの親から外す。以後はLineage内の親と、1パラメータだけ変更した子を比較する。合格した子もForward Paper候補までであり、本番メインへの採用は別途手動承認を必要とする。
"""
    docs_path.write_text(docs, encoding="utf-8")

print("RESEARCH_LAB_MAIN_LINEAGE_PATCH_OK")
