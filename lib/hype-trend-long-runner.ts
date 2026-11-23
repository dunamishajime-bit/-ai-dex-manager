export type HypeTrendEntryGateInput = {
  equity: number;
  availableBalance: number;
  existingCryptoGross: number;
  pendingCryptoGross: number;
  reservedCryptoGross: number;
  candidateGross: number;
  cryptoGrossCap: number;
  totalGrossBefore: number;
  totalGrossCap: number;
  coreReservationGross?: number;
};

export type HypeTrendEntryGateResult = {
  accepted: boolean;
  reason: "ACCEPTED" | "CRYPTO_GROSS_CAP_BLOCK" | "TOTAL_GROSS_CAP_BLOCK" | "CORE_RESERVATION_PRIORITY" | "AVAILABLE_BALANCE_UNAVAILABLE";
  worstCaseCryptoGross: number;
  worstCaseTotalGross: number;
};

/**
 * HYPE is a lower-priority overlay.  The calculation is deliberately
 * worst-case and includes every reservation before any order adapter can be
 * called.  A core reservation has priority over this overlay.
 */
export function evaluateHypeTrendEntryGate(input: HypeTrendEntryGateInput): HypeTrendEntryGateResult {
  const values = [
    input.equity,
    input.availableBalance,
    input.existingCryptoGross,
    input.pendingCryptoGross,
    input.reservedCryptoGross,
    input.candidateGross,
    input.cryptoGrossCap,
    input.totalGrossBefore,
    input.totalGrossCap,
    input.coreReservationGross ?? 0,
  ];
  if (!values.every((value) => Number.isFinite(value) && value >= 0) || input.equity <= 0 || input.availableBalance < 0) {
    return { accepted: false, reason: "AVAILABLE_BALANCE_UNAVAILABLE", worstCaseCryptoGross: Number.POSITIVE_INFINITY, worstCaseTotalGross: Number.POSITIVE_INFINITY };
  }
  const worstCaseCryptoGross = input.existingCryptoGross + input.pendingCryptoGross + input.reservedCryptoGross + input.candidateGross;
  const worstCaseTotalGross = input.totalGrossBefore + input.pendingCryptoGross + input.reservedCryptoGross + input.candidateGross;
  const coreReservation = input.coreReservationGross ?? 0;
  if (coreReservation > 0 && worstCaseCryptoGross + coreReservation > input.cryptoGrossCap + 1e-9) {
    return { accepted: false, reason: "CORE_RESERVATION_PRIORITY", worstCaseCryptoGross, worstCaseTotalGross };
  }
  if (worstCaseCryptoGross > input.cryptoGrossCap + 1e-9) return { accepted: false, reason: "CRYPTO_GROSS_CAP_BLOCK", worstCaseCryptoGross, worstCaseTotalGross };
  if (worstCaseTotalGross > input.totalGrossCap + 1e-9) return { accepted: false, reason: "TOTAL_GROSS_CAP_BLOCK", worstCaseCryptoGross, worstCaseTotalGross };
  return { accepted: true, reason: "ACCEPTED", worstCaseCryptoGross, worstCaseTotalGross };
}
