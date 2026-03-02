export const SUPPORTED_CHAINS = {
    56: "BNB Chain",
    137: "Polygon"
} as const;

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS;

export function isSupportedChain(chainId: number): chainId is SupportedChainId {
    return chainId in SUPPORTED_CHAINS;
}
