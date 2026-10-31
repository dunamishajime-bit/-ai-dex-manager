export type PenguFailureDisplayState = {
  killSwitchLabel: "ACTIVE" | "inactive";
  historyLabel: "現在のFail-Closed履歴" | "過去のFail-Closed履歴（監査用）";
  historyKind: "active" | "historical";
  failureCount: number;
};

export function penguFailureDisplayState(killSwitchActive: boolean, failureCount: number): PenguFailureDisplayState {
  const active = killSwitchActive === true;
  return {
    killSwitchLabel: active ? "ACTIVE" : "inactive",
    historyLabel: active ? "現在のFail-Closed履歴" : "過去のFail-Closed履歴（監査用）",
    historyKind: active ? "active" : "historical",
    failureCount: Math.max(0, Math.trunc(Number.isFinite(failureCount) ? failureCount : 0)),
  };
}
