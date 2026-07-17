import fs from "node:fs";
import path from "node:path";

type Evidence = {
  kind: string;
  summary: string;
  url: string;
};

type Candidate = {
  id: string;
  label: string;
  address: string | null;
  chain: string;
  type: string;
  copyFit: string;
  status: string;
  confidence: number;
  whyItMatters: string;
  evidence: Evidence[];
};

type ContractRef = {
  name: string;
  chain: string;
  address: string;
  confidence: string;
  sourceUrl: string;
  notes: string;
};

type Dataset = {
  generatedAt: string;
  trackedContracts: ContractRef[];
  candidateWallets: Candidate[];
  excludedWallets: Array<{
    label: string;
    address: string | null;
    reason: string;
    sourceUrl: string;
  }>;
};

const root = process.cwd();
const dataPath = path.join(root, "data", "aster-copy-candidates.json");
const outDir = path.join(root, "reports", "aster-copy-candidates");
const outPath = path.join(outDir, "result.md");

const raw = fs.readFileSync(dataPath, "utf8");
const dataset = JSON.parse(raw) as Dataset;

const scored = [...dataset.candidateWallets].sort((a, b) => {
  const scoreA = a.confidence + a.evidence.length * 0.05 + (a.address ? 0.08 : 0);
  const scoreB = b.confidence + b.evidence.length * 0.05 + (b.address ? 0.08 : 0);
  return scoreB - scoreA;
});

const lines: string[] = [];
lines.push("# Aster Copy-Trade Candidate Report");
lines.push("");
lines.push(`Generated: ${dataset.generatedAt}`);
lines.push("");
lines.push("## Tracked Contracts");
lines.push("");
for (const contract of dataset.trackedContracts) {
  lines.push(
    `- ${contract.name} | ${contract.chain} | \`${contract.address}\` | confidence: ${contract.confidence}`
  );
  lines.push(`  - Source: ${contract.sourceUrl}`);
  lines.push(`  - Notes: ${contract.notes}`);
}

lines.push("");
lines.push("## Ranked Candidates");
lines.push("");
for (const candidate of scored) {
  lines.push(
    `### ${candidate.label} (${candidate.chain})`
  );
  lines.push("");
  lines.push(`- Address: ${candidate.address ?? "unresolved (truncated only)"}`);
  lines.push(`- Type: ${candidate.type}`);
  lines.push(`- Copy fit: ${candidate.copyFit}`);
  lines.push(`- Status: ${candidate.status}`);
  lines.push(`- Confidence: ${(candidate.confidence * 100).toFixed(0)}%`);
  lines.push(`- Why it matters: ${candidate.whyItMatters}`);
  lines.push(`- Evidence count: ${candidate.evidence.length}`);
  lines.push("");
  for (const item of candidate.evidence) {
    lines.push(`  - [${item.kind}] ${item.summary}`);
    lines.push(`    - ${item.url}`);
  }
  lines.push("");
}

lines.push("## Excluded / False Positives");
lines.push("");
for (const item of dataset.excludedWallets) {
  lines.push(`- ${item.label} | ${item.address ?? "address unresolved"}`);
  lines.push(`  - Reason: ${item.reason}`);
  lines.push(`  - Source: ${item.sourceUrl}`);
}

lines.push("");
lines.push("## Recommended Next Step");
lines.push("");
lines.push(
  "1. Start with the article-backed whale `0x1527...fa7c2` as the highest-value identity candidate once a full address is recovered."
);
lines.push(
  "2. In parallel, watch the BNB-chain wallets with full addresses because they are immediately traceable and already proven to touch `Aster: Trading` repeatedly."
);
lines.push(
  "3. Prioritize extracting daily patterns from the 1001x trading contract (`0x1b6f...feb0`) instead of Treasury, because it exposes actual Open Market Trade / Close Trade behavior."
);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(`Wrote ${path.relative(root, outPath)}`);
