export type V12ObservationStatusInput = {
  decisionDetailsAvailable: boolean;
  errors: readonly string[];
  warnings: readonly string[];
};

export type V12ObservationStatus = "確認済み" | "要確認" | "未取得";

/**
 * The firing path depends on runner/decision data. Optional history warnings
 * must not downgrade an otherwise readable current decision.
 */
export function v12ObservationStatus(input: V12ObservationStatusInput): V12ObservationStatus {
  if (input.errors.length > 0) return "要確認";
  return input.decisionDetailsAvailable ? "確認済み" : "未取得";
}
