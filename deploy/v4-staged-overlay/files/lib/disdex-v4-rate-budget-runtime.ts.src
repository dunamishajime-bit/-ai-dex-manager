export type V4BudgetBrokerRuntime = {
  sha: string; cwd: string;
  releaseIsDirectory: boolean; releaseIsSymlink: boolean; releaseUid: number; releaseMode: number;
  markerIsFile: boolean; markerIsSymlink: boolean; markerUid: number; markerMode: number; markerSha: string;
  socketDirectoryIsDirectory: boolean; socketDirectoryIsSymlink: boolean;
  socketDirectoryUid: number; socketDirectoryGid: number; socketDirectoryMode: number;
  uid: number; gid: number; deployUid: number; deployGid: number; proxyEnvironmentPresent: boolean;
};

export function validateV4BudgetBrokerRuntime(value: V4BudgetBrokerRuntime): true {
  if (!/^[a-f0-9]{40}$/.test(value.sha)
      || value.cwd !== `/home/deploy/disdex-trading/releases/${value.sha}`
      || !value.releaseIsDirectory || value.releaseIsSymlink || value.releaseUid !== 0 || (value.releaseMode & 0o222) !== 0
      || !value.markerIsFile || value.markerIsSymlink || value.markerUid !== 0 || (value.markerMode & 0o222) !== 0
      || value.markerSha !== value.sha
      || !Number.isSafeInteger(value.deployUid) || !Number.isSafeInteger(value.deployGid)
      || value.deployUid <= 0 || value.deployGid <= 0 || value.uid !== value.deployUid || value.gid !== value.deployGid
      || !value.socketDirectoryIsDirectory || value.socketDirectoryIsSymlink
      || value.socketDirectoryUid !== value.deployUid || value.socketDirectoryGid !== value.deployGid
      || (value.socketDirectoryMode & 0o777) !== 0o750 || value.proxyEnvironmentPresent) {
    throw new Error("V4_BUDGET_BROKER_RUNTIME_UNTRUSTED");
  }
  return true;
}
