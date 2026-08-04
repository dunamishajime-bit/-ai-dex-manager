import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  disDexV96OperatorOverrideArtifactSha256,
  type DisDexV96OperatorOverrideApproval,
} from "../lib/disdex-v96-live-risk-controls";

function required(name: string) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function main() {
  const output = resolve(process.argv[2] || ".runtime-approval/disdex-v96-operator-override.json");
  const operator = required("DISDEX_V96_REVOKE_OPERATOR");
  const reason = required("DISDEX_V96_REVOKE_REASON");
  const current = JSON.parse(await readFile(output, "utf8")) as DisDexV96OperatorOverrideApproval;
  if (current.status !== "APPROVED") throw new Error("Operator Override is not currently approved.");
  const base: Omit<DisDexV96OperatorOverrideApproval, "artifactSha256"> = {
    ...current,
    status: "REVOKED",
    revokedAt: new Date().toISOString(),
    revokedBy: operator,
    revokeReason: reason,
  };
  const next: DisDexV96OperatorOverrideApproval = {
    ...base,
    artifactSha256: disDexV96OperatorOverrideArtifactSha256(base),
  };
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, output);
  console.log(JSON.stringify({ status: "DISDEX_V96_OPERATOR_OVERRIDE_REVOKED", output, revokedAt: next.revokedAt, revokedBy: next.revokedBy }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
