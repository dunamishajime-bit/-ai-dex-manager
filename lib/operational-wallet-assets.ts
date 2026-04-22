import { NATIVE_TOKEN_ADDRESS } from "@/lib/tokens";

export type OperationalWalletTrackedAsset = {
  symbol: "BNB" | "USDT" | "ETH" | "SOL" | "LINK" | "AVAX" | "PENGU" | "DOGE" | "INJ" | "UNI" | "TWT";
  name: string;
  providerId: string;
  address: string;
  decimals: number;
  isNative?: boolean;
};

export const OPERATIONAL_WALLET_CHAIN_ID = 56;

export const OPERATIONAL_WALLET_TRACKED_ASSETS: OperationalWalletTrackedAsset[] = [
  {
    symbol: "BNB",
    name: "BNB",
    providerId: "binance-coin",
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    isNative: true,
  },
  {
    symbol: "USDT",
    name: "USDT (BNB Chain)",
    providerId: "tether",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
  },
  {
    symbol: "ETH",
    name: "ETH (BNB Chain)",
    providerId: "ethereum",
    address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    decimals: 18,
  },
  {
    symbol: "SOL",
    name: "Wrapped SOL (BNB Chain)",
    providerId: "solana",
    address: "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF",
    decimals: 18,
  },
  {
    symbol: "LINK",
    name: "BNB Pegged ChainLink",
    providerId: "chainlink",
    address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD",
    decimals: 18,
  },
  {
    symbol: "AVAX",
    name: "Binance-Peg Avalanche",
    providerId: "avalanche",
    address: "0x1CE0c2827e2eF14D5C4f29a091d735A204794041",
    decimals: 18,
  },
  {
    symbol: "PENGU",
    name: "Pudgy Penguins (BNB Chain)",
    providerId: "pudgy-penguins",
    address: "0x6418c0dd099a9FDA397C766304CDd918233E8847",
    decimals: 18,
  },
  {
    symbol: "DOGE",
    name: "Binance-Peg DOGE",
    providerId: "dogecoin",
    address: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43",
    decimals: 8,
  },
  {
    symbol: "INJ",
    name: "Injective Protocol (BNB Chain)",
    providerId: "injective-protocol",
    address: "0xa2B726B1145A4773F68593CF171187d8EBe4d495",
    decimals: 18,
  },
  {
    symbol: "UNI",
    name: "Uniswap (BNB Chain)",
    providerId: "uniswap",
    address: "0xbf5140A22578168FD562DCcF235E5D43A02ce9B1",
    decimals: 18,
  },
  {
    symbol: "TWT",
    name: "Trust Wallet Token (BNB Chain)",
    providerId: "trust-wallet-token",
    address: "0x4B0F1812e5Df2A09796481Ff14017e6005508003",
    decimals: 18,
  },
];
