export const SUPPORTED_CHAINS = {
    56: "BNB Chain",
    137: "Polygon",
    42161: "Arbitrum",
    8453: "Base"
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

export function isSupportedChain(chainId: number): chainId is SupportedChainId {
    return chainId in SUPPORTED_CHAINS;
}
