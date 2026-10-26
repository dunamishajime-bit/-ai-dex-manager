/**
 * Read-only validation helpers for the two RENDER route certificates.
 *
 * These helpers report certificate state for telemetry and reuse the exact
 * validation used by the order path. They never enable a route and never send
 * an order.
 */
import { lstat, readFile } from "node:fs/promises";
import { RENDER_ENTRY_POLICY, RENDER_INDEPENDENT_ROUTE } from "./render-highwr-and-legacy-stop";
import { assertRenderLegacyAdverseCert } from "./render-legacy-adverse-cert";

export const RENDER_INDEPENDENT_CERT_SCHEMA = "disdex-render-independent-venue-certificate/v1" as const;

export type RenderIndependentCertificate = {
  schema?: string;
  approvedSha?: string;
  route?: string;
  gross?: number;
  holdMinutes?: number;
  stopPct?: number;
  takeProfitPct?: number;
  venueStopReadback?: boolean;
  partialFillVerified?: boolean;
  timeoutExitVerified?: boolean;
  integrated10And30BpsVerified?: boolean;
  operatorApproval?: string;
};

export type RenderCertificateInspection = {
  status: "VALID" | "MISSING" | "UNTRUSTED" | "INVALID" | "UNPROVEN";
  reason: string;
};

export function assertRenderIndependentCert(raw: unknown, sha: string): void {
  if (!raw || typeof raw !== "object") throw new Error("RENDER_INDEPENDENT_CERT_MALFORMED");
  const cert = raw as RenderIndependentCertificate;
  if (cert.schema !== RENDER_INDEPENDENT_CERT_SCHEMA
    || cert.approvedSha !== sha
    || cert.route !== RENDER_INDEPENDENT_ROUTE
    || cert.gross !== RENDER_ENTRY_POLICY.independentRequestedGross
    || cert.holdMinutes !== RENDER_ENTRY_POLICY.independentRealMaxMinutes
    || cert.stopPct !== RENDER_ENTRY_POLICY.independentRealStopLossPct
    || cert.takeProfitPct !== RENDER_ENTRY_POLICY.independentRealTakeProfitPct
    || cert.venueStopReadback !== true
    || cert.partialFillVerified !== true
    || cert.timeoutExitVerified !== true
    || cert.integrated10And30BpsVerified !== true
    || cert.operatorApproval !== "APPROVE_RENDER_INDEPENDENT_SHORT_AT_BOUND_SHA") {
    throw new Error("RENDER_INDEPENDENT_CERT_UNPROVEN");
  }
}

export async function inspectRenderCertificate(
  path: string,
  sha: string,
  assertCertificate: (raw: unknown, sha: string) => void,
): Promise<RenderCertificateInspection> {
  let stats;
  try {
    stats = await lstat(path);
  } catch {
    return { status: "MISSING", reason: "CERTIFICATE_MISSING" };
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    return { status: "UNTRUSTED", reason: "CERTIFICATE_NOT_REGULAR_FILE" };
  }
  if (typeof stats.uid === "number" && (stats.uid !== 0 || stats.gid !== 0)) {
    return { status: "UNTRUSTED", reason: "CERTIFICATE_NOT_ROOT_OWNED" };
  }
  if ((stats.mode & 0o022) !== 0) {
    return { status: "UNTRUSTED", reason: "CERTIFICATE_WRITABLE_BY_NON_ROOT" };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch {
    return { status: "INVALID", reason: "CERTIFICATE_JSON_INVALID" };
  }
  try {
    assertCertificate(raw, sha);
    return { status: "VALID", reason: "CERTIFICATE_VALID_AT_BOUND_SHA" };
  } catch (error) {
    return { status: "UNPROVEN", reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function inspectRenderIndependentCertificate(path: string, sha: string) {
  return inspectRenderCertificate(path, sha, assertRenderIndependentCert);
}

export async function inspectRenderLegacyAdverseCertificate(path: string, sha: string) {
  return inspectRenderCertificate(path, sha, assertRenderLegacyAdverseCert);
}
