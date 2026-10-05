export type SafeInspectionResult = {
  safeAddress: string;
  rpcUrl: string;
  chainId: string;
  deployed: boolean;
  owners: string[];
  threshold: number;
  signerPresent: boolean;
};

const DEFAULT_BSC_RPC = "https://bsc-dataseed.binance.org";

export async function inspectSafeAddress(safeAddress: string): Promise<SafeInspectionResult> {
  const rpcUrl = process.env.RPC_URL_BSC?.trim() || DEFAULT_BSC_RPC;

  return {
    safeAddress,
    rpcUrl,
    chainId: "56",
    deployed: false,
    owners: [],
    threshold: 0,
    signerPresent: false,
  };
}
