import { getAddress } from "viem";
import bnbUniverseEntries from "../data/strategy-bnb-universe.json";
import solanaUniverseEntries from "../data/strategy-solana-universe.json";

export const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export interface TokenInfo {
    address: string;
    decimals: number;
}

interface StrategyBnbUniverseEntry {
    symbol: string;
    address: string;
    decimals: number;
}

interface StrategySolanaUniverseEntry {
    symbol: string;
    address: string;
    decimals: number;
}

function normalizeAddress(address: string, chainId: number): string {
    if (chainId === 101) {
        return address;
    }

    if (address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
        return NATIVE_TOKEN_ADDRESS;
    }

    return getAddress(address.toLowerCase());
}

function normalizeRegistry(
    registry: Record<number, Record<string, TokenInfo>>,
): Record<number, Record<string, TokenInfo>> {
    return Object.fromEntries(
        Object.entries(registry).map(([chainId, tokens]) => [
            Number(chainId),
            Object.fromEntries(
                Object.entries(tokens).map(([symbol, token]) => [
                    symbol,
                    {
                        ...token,
                        address: normalizeAddress(token.address, Number(chainId)),
                    },
                ]),
            ),
        ]),
    );
}

const GENERATED_BNB_REGISTRY: Record<string, TokenInfo> = Object.fromEntries(
    (bnbUniverseEntries as StrategyBnbUniverseEntry[])
        .filter((entry) => entry.symbol && entry.address && entry.symbol.toUpperCase() !== "BNB")
        .map((entry) => [
            entry.symbol.toUpperCase(),
            {
                address: entry.address,
                decimals: Number(entry.decimals || 18),
            },
        ]),
);

const GENERATED_SOLANA_REGISTRY: Record<string, TokenInfo> = Object.fromEntries(
    (solanaUniverseEntries as StrategySolanaUniverseEntry[])
        .filter((entry) => entry.symbol && entry.address)
        .map((entry) => [
            entry.symbol.toUpperCase(),
            {
                address: entry.address,
                decimals: Number(entry.decimals || 9),
            },
        ]),
);

const RAW_TOKEN_REGISTRY: Record<number, Record<string, TokenInfo>> = {
    // BSC (56)
    56: {
        ...GENERATED_BNB_REGISTRY,
        "BNB": { address: NATIVE_TOKEN_ADDRESS, decimals: 18 },
        "BTC": { address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18 },
        "ETH": { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
        "SOL": { address: "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF", decimals: 18 },
        "XRP": { address: "0x1D2F0dA169ceB9fC7B3144628dB156f3F6c60dBE", decimals: 18 },
        "ADA": { address: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47", decimals: 18 },
        "AVAX": { address: "0x1CE0c2827e2eF14D5C4f29a091d735A204794041", decimals: 18 },
        "DOGE": { address: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43", decimals: 8 },
        "DOT": { address: "0x7083609fCE4d1d8Dc0C979AAb8C869Ea2C873402", decimals: 18 },
        "LTC": { address: "0x4338665CBB7B2485A8855A139b75D5e34AB0DB94", decimals: 18 },
        "BCH": { address: "0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf", decimals: 18 },
        "TRX": { address: "0xCE7de646e7208A4EF112CB6ed5038FA6CC6b12e3", decimals: 18 },
        "LINK": { address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", decimals: 18 },
        "SHIB": { address: "0x2859e4544c4bb03966803b044a93563bd2d0dd4d", decimals: 18 },
        "PEPE": { address: "0x25d887Ce7a35172C62FeBFD67a1856F20FaEbB00", decimals: 18 },
        "CAKE": { address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18 },
        "XVS": { address: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63", decimals: 18 },
        "TWT": { address: "0x4B0F1812e5Df2A09796481Ff14017e6005508003", decimals: 18 },
        "MATIC": { address: "0xCC42724C6683B7E57334C4E856F4C9965ED682BD", decimals: 18 },
        "NEAR": { address: "0x1FA4A73A3F0133F0025378AF00236F3ABDEE5D63", decimals: 18 },
        "FTM": { address: "0xAD29AbB318791D579433D831ED122aFeAf29dcfe", decimals: 18 },
        "EOS": { address: "0x56b6FB708fc5732DEC1afc8d8556423A2edcCbD6", decimals: 18 },
        "INJ": { address: "0xa2B726B1145A4773F68593CF171187d8EBe4d495", decimals: 18 },
        "AXS": { address: "0x715D400F88C167884bbCc41C5FeA407ed4D2f8A0", decimals: 18 },
        "ALPACA": { address: "0x8f0528ce5ef7b51152a59745befdd91d97091d2f", decimals: 18 },
        "DODO": { address: "0x67ee3Cb086F8a16f34beE3ca72FAD36F7Db929e2", decimals: 18 },
        "UNI": { address: "0xbf5140A22578168FD562DCcF235E5D43A02ce9B1", decimals: 18 },
        "AAVE": { address: "0xfb6115445Bff7b52FeB98650C87f44907E58f802", decimals: 18 },
        "ATOM": { address: "0x0Eb3a705fc54725037CC9e008bDede697f62F335", decimals: 18 },
        "PENGU": { address: "0x6418c0dd099a9FDA397C766304CDd918233E8847", decimals: 18 },
        "USDT": { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
        "USD1": { address: "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", decimals: 18 },
        "WLFI": { address: "0x47474747477b199288bF72a1D702f7Fe0Fb1DEeA", decimals: 18 },
        "ASTER": { address: "0x000Ae314E2A2172a039B26378814C252734f556A", decimals: 18 },
    },
    // Solana (101)
    101: {
        ...GENERATED_SOLANA_REGISTRY,
        "SOL": { address: "So11111111111111111111111111111111111111112", decimals: 9 },
        "SOL.SOL": { address: "So11111111111111111111111111111111111111112", decimals: 9 },
        "USDC": { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
        "USDT": { address: "Es9vMFrzaCERmJfrF4H2tT1cL2Qj1vDLteA94ppWKqh", decimals: 6 },
    },
};

export const TOKEN_REGISTRY = normalizeRegistry(RAW_TOKEN_REGISTRY);

export function resolveToken(symbol: string, chainId: number): TokenInfo {
    let s = symbol.toUpperCase();
    if (s === "ASTR") s = "ASTER";

    const chainTokens = TOKEN_REGISTRY[chainId];
    if (!chainTokens) throw new Error(`Chain ${chainId} not found in Token Registry`);

    const info = chainTokens[s];
    if (!info) throw new Error(`Token ${s} unsupported on chain ${chainId}. Symbol searching is forbidden.`);

    return info;
}
