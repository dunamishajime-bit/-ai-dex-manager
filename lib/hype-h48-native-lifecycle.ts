/**
 * H48 native lifecycle ATTESTATION ONLY. No order, cancel, STOP, or position
 * mutation method exists here. Kept separate from the TREND+STOP LIVE runner.
 *
 * The production wired executor must eventually perform its OWN independent
 * checks and signed venue reads before any real submission, then persist exact
 * in-flight and fill reconciliation evidence. Neither these attestations nor
 * a passed fixture test is authorization to deploy or enable trading.
 */
import type { AccountLockHandle } from "./disdex-account-order-lock";
import type { HypeH48TimeOnlyContract, HypeH48PolicyEvidence } from "./hype-stable4-time-only-contract";
import {
  evaluateHypeH48TimeOnlyExit, validateHypeH48PolicyEvidence,
  validateHypeH48TimeOnlyContract,
} from "./hype-stable4-time-only-contract";
import type { H48EntrySignal } from "./hype-h48-research-entry";

type H48Phase = "ENTRY" | "POSITION";
export interface H48AttestationAuthority {
  authorize(input: {
    phase: H48Phase;
    runtimeSha: string;
    contract: HypeH48TimeOnlyContract;
    quantity: number;
    lease: AccountLockHandle;
  }): Promise<HypeH48PolicyEvidence>;
}

function requireQuantity(quantity: number) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("HYPE_H48_ATTESTATION_INVALID_QUANTITY");
}

function validateAuthorityEvidence(evidence: HypeH48PolicyEvidence, input: {
  runtimeSha: string; contract: HypeH48TimeOnlyContract; quantity: number; now: number;
}) {
  const approved = validateHypeH48PolicyEvidence(evidence, input);
  if (input.runtimeSha !== approved.runtimeSha) throw new Error("HYPE_H48_ATTESTATION_SOURCE_MISMATCH");
  return approved;
}

export async function attestH48EntryReadOnly(input: {
  signal: H48EntrySignal;
  runtimeSha: string;
  quantity: number;
  now: number;
  lease: AccountLockHandle;
  authority: H48AttestationAuthority;
}) {
  requireQuantity(input.quantity);
  if (input.signal.status !== "CANDIDATE" || input.signal.route !== "HYPE_REDESIGN_CAUSAL_H48R4_WSIG") {
    throw new Error("HYPE_H48_ATTESTATION_NOT_A_CANDIDATE");
  }
  const contract = validateHypeH48TimeOnlyContract(input.signal.contract, input.signal.contract);
  if (input.runtimeSha !== contract.sourceSha || input.signal.logicalEntryTs !== contract.logicalEntryTs
      || input.signal.logicalExitTs !== contract.logicalExitTs || input.signal.signalTs !== contract.logicalEntryTs - 3_600_000
      || !Number.isSafeInteger(input.now) || input.now < contract.logicalEntryTs
      || input.now - contract.logicalEntryTs > 120_000) {
    throw new Error("HYPE_H48_ATTESTATION_ENTRY_BINDING_INVALID");
  }
  const proof = await input.authority.authorize({
    phase: "ENTRY", runtimeSha: input.runtimeSha, contract,
    quantity: input.quantity, lease: input.lease,
  });
  const evidence = validateAuthorityEvidence(proof, {
    runtimeSha: input.runtimeSha, contract, quantity: input.quantity, now: input.now,
  });
  return Object.freeze({ status: "H48_ENTRY_ATTESTED_READ_ONLY" as const,
    contract, evidence, ordersSent: 0 as const, cancelsSent: 0 as const, positionChangesSent: 0 as const });
}

export async function attestH48ExitReadOnly(input: {
  contract: HypeH48TimeOnlyContract;
  runtimeSha: string;
  quantity: number;
  now: number;
  boundary?: { openTs: number; open: number; observedAt: number };
  lease: AccountLockHandle;
  authority: H48AttestationAuthority;
}) {
  requireQuantity(input.quantity);
  const contract = validateHypeH48TimeOnlyContract(input.contract, input.contract);
  if (input.runtimeSha !== contract.sourceSha) throw new Error("HYPE_H48_ATTESTATION_SOURCE_MISMATCH");
  const due = evaluateHypeH48TimeOnlyExit(contract, input.now, input.boundary);
  if (!due.due) return Object.freeze({ status: "H48_NOT_DUE_READ_ONLY" as const,
    ordersSent: 0 as const, cancelsSent: 0 as const, positionChangesSent: 0 as const });
  const proof = await input.authority.authorize({
    phase: "POSITION", runtimeSha: input.runtimeSha, contract,
    quantity: input.quantity, lease: input.lease,
  });
  const evidence = validateAuthorityEvidence(proof, input);
  return Object.freeze({ status: "H48_EXIT_ATTESTED_READ_ONLY" as const,
    contract, evidence, boundary: due,
    ordersSent: 0 as const, cancelsSent: 0 as const, positionChangesSent: 0 as const });
}
