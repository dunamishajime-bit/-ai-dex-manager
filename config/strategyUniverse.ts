import bnbUniverseEntries from "../data/strategy-bnb-universe.json";
import solanaUniverseEntries from "../data/strategy-solana-universe.json";

type UniverseSeedProfile = "core" | "secondary" | "experimental" | "meme" | "bnb-ecosystem";
export type StrategyUniverseChain = "BNB" | "SOLANA";

interface StrategyUniverseEntry {
    symbol: string;
    displaySymbol?: string;
    name: string;
    providerId: string;
    address: string;
    decimals: number;
    origin: string;
    chain?: StrategyUniverseChain;
}

export interface StrategyUniverseSeed {
    symbol: string;
    displaySymbol: string;
    providerId: string;
    name?: string;
    chain: StrategyUniverseChain;
    address: string;
    decimals: number;
    profile: UniverseSeedProfile;
    liquidityUsd: number;
    volume24hUsd: number;
    spreadBps: number;
    marketCapUsd: number;
    tokenAgeDays: number;
    stabilityScore: number;
    priceDataScore: number;
    tags?: string[];
    excludeFromUniverse?: boolean;
    universeExclusionReason?: string;
}

export const STRATEGY_SOLANA_EXPANSION_SYMBOLS = [
    "PENGU.SOL",
    "TRUMP.SOL",
    "MELANIA.SOL",
    "FARTCOIN.SOL",
    "MEW.SOL",
    "POPCAT.SOL",
    "GRASS.SOL",
    "ZBCN.SOL",
    "HNT.SOL",
    "JLP.SOL",
    "JITOSOL.SOL",
    "JUPSOL.SOL",
    "MSOL.SOL",
    "PIPPIN.SOL",
    "BOME.SOL",
    "PONKE.SOL",
    "TNSR.SOL",
    "GOAT.SOL",
    "JELLYJELLY.SOL",
    "GRIFFAIN.SOL",
    "MOODENG.SOL",
    "ACT.SOL",
    "PYTHIA.SOL",
    "AURA.SOL",
] as const;

export const STRATEGY_BNB_DEXSCREENER_SYMBOLS = [
    "ADA",
    "LINK",
    "AVAX",
    "LTC",
    "DOT",
    "UNI",
    "AAVE",
    "TRX",
    "INJ",
    "BCH",
    "PEPE",
] as const;

export const STRATEGY_DEXSCREENER_EXPANSION_SYMBOLS = [
    ...STRATEGY_BNB_DEXSCREENER_SYMBOLS,
    ...STRATEGY_SOLANA_EXPANSION_SYMBOLS,
] as const;

type SeedDefaults = Omit<
    StrategyUniverseSeed,
    "symbol" | "displaySymbol" | "providerId" | "name" | "chain" | "address" | "decimals" | "profile"
>;

const PROFILE_DEFAULTS: Record<UniverseSeedProfile, SeedDefaults> = {
    core: {
        liquidityUsd: 140_000_000,
        volume24hUsd: 900_000_000,
        spreadBps: 18,
        marketCapUsd: 12_000_000_000,
        tokenAgeDays: 1_900,
        stabilityScore: 90,
        priceDataScore: 95,
        tags: ["quality"],
        excludeFromUniverse: false,
        universeExclusionReason: undefined,
    },
    secondary: {
        liquidityUsd: 38_000_000,
        volume24hUsd: 210_000_000,
        spreadBps: 32,
        marketCapUsd: 2_500_000_000,
        tokenAgeDays: 1_050,
        stabilityScore: 78,
        priceDataScore: 87,
        tags: [],
        excludeFromUniverse: false,
        universeExclusionReason: undefined,
    },
    experimental: {
        liquidityUsd: 14_000_000,
        volume24hUsd: 62_000_000,
        spreadBps: 54,
        marketCapUsd: 600_000_000,
        tokenAgeDays: 480,
        stabilityScore: 62,
        priceDataScore: 77,
        tags: ["experimental"],
        excludeFromUniverse: false,
        universeExclusionReason: undefined,
    },
    meme: {
        liquidityUsd: 18_000_000,
        volume24hUsd: 130_000_000,
        spreadBps: 58,
        marketCapUsd: 800_000_000,
        tokenAgeDays: 420,
        stabilityScore: 58,
        priceDataScore: 75,
        tags: ["meme"],
        excludeFromUniverse: false,
        universeExclusionReason: undefined,
    },
    "bnb-ecosystem": {
        liquidityUsd: 32_000_000,
        volume24hUsd: 180_000_000,
        spreadBps: 28,
        marketCapUsd: 1_800_000_000,
        tokenAgeDays: 1_250,
        stabilityScore: 82,
        priceDataScore: 89,
        tags: ["ecosystem"],
        excludeFromUniverse: false,
        universeExclusionReason: undefined,
    },
};

const BNB_ECOSYSTEM_SYMBOLS = new Set([
    "BNB", "CAKE", "XVS", "TWT", "ALPACA", "DODO", "ID", "SFP", "ASTER", "WLFI",
    "ANKR", "IOTX", "KAVA", "LISTA", "HOOK", "TKO", "TLM", "TPT", "TRONPAD",
]);

const MEME_SYMBOLS = new Set([
    "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "RACA",
    "PUMP", "PENGU", "TRUMP", "MELANIA", "FARTCOIN", "MEW", "POPCAT", "PIPPIN",
    "BOME", "PONKE", "GOAT", "JELLYJELLY", "GRIFFAIN", "MOODENG", "ACT", "PYTHIA", "AURA",
]);

const SOLANA_CORE_SYMBOLS = new Set([
    "SOL", "JUP", "PYTH", "RENDER", "JTO", "KMNO",
]);

const SOLANA_SECONDARY_SYMBOLS = new Set([
    "RAY", "ORCA", "DRIFT", "W", "FIDA", "CLOUD",
    "GRASS", "ZBCN", "HNT", "JLP", "JITOSOL", "JUPSOL", "MSOL", "TNSR",
]);

function normalizeStrategyUniverseSymbol(symbol: string) {
    return symbol.trim().toUpperCase();
}

function displaySymbolFromSeedSymbol(symbol: string) {
    return normalizeStrategyUniverseSymbol(symbol).replace(/\.SOL$/, "");
}

function chainTags(chain: StrategyUniverseChain) {
    return chain === "SOLANA" ? ["solana"] : ["bnb-chain"];
}

function withOriginTags(origin: string, tags: string[]) {
    const extraTags: string[] = [];
    if (origin.includes("top100")) extraTags.push("top100");
    if (origin.includes("extended")) extraTags.push("extended");
    if (origin.includes("manual-registry")) extraTags.push("manual-registry");
    if (origin.includes("solana-seed")) extraTags.push("solana-seed");
    return Array.from(new Set([...tags, ...extraTags]));
}

function profileFor(entry: StrategyUniverseEntry, index: number): UniverseSeedProfile {
    const displaySymbol = entry.displaySymbol || displaySymbolFromSeedSymbol(entry.symbol);

    if (MEME_SYMBOLS.has(displaySymbol)) return "meme";
    if (entry.chain === "BNB" && BNB_ECOSYSTEM_SYMBOLS.has(displaySymbol)) return "bnb-ecosystem";

    if (entry.chain === "SOLANA") {
        if (SOLANA_CORE_SYMBOLS.has(displaySymbol)) return "core";
        if (SOLANA_SECONDARY_SYMBOLS.has(displaySymbol)) return "secondary";
        return "experimental";
    }

    if (index < 40) return "core";
    if (index < 96) return "secondary";
    return "experimental";
}

function overridesFor(entry: StrategyUniverseEntry, index: number) {
    const top100Boost = entry.origin.includes("top100");
    const manualBoost = entry.origin.includes("manual-registry");
    const tags = withOriginTags(entry.origin, []);
    const displaySymbol = entry.displaySymbol || displaySymbolFromSeedSymbol(entry.symbol);

    if (entry.chain === "SOLANA") {
        if (SOLANA_CORE_SYMBOLS.has(displaySymbol)) {
            return {
                tags,
                liquidityUsd: 82_000_000,
                volume24hUsd: 440_000_000,
                spreadBps: 22,
                marketCapUsd: 4_500_000_000,
                tokenAgeDays: 1_050,
                stabilityScore: 84,
                priceDataScore: 92,
            };
        }

        if (SOLANA_SECONDARY_SYMBOLS.has(displaySymbol)) {
            return {
                tags,
                liquidityUsd: 34_000_000,
                volume24hUsd: 150_000_000,
                spreadBps: 34,
                marketCapUsd: 1_200_000_000,
                tokenAgeDays: 620,
                stabilityScore: 74,
                priceDataScore: 84,
            };
        }

        if (MEME_SYMBOLS.has(displaySymbol)) {
            return {
                tags,
                liquidityUsd: 24_000_000,
                volume24hUsd: 180_000_000,
                spreadBps: 52,
                marketCapUsd: 1_000_000_000,
                tokenAgeDays: 260,
                stabilityScore: 60,
                priceDataScore: 79,
            };
        }

        return {
            tags,
            liquidityUsd: 18_000_000,
            volume24hUsd: 85_000_000,
            spreadBps: 48,
            marketCapUsd: 450_000_000,
            tokenAgeDays: 620,
            stabilityScore: 64,
            priceDataScore: 78,
        };
    }

    return {
        tags,
        liquidityUsd: top100Boost ? 56_000_000 : undefined,
        volume24hUsd: top100Boost ? 260_000_000 : undefined,
        spreadBps: top100Boost ? 24 : undefined,
        marketCapUsd: manualBoost && index < 12 ? 25_000_000_000 : undefined,
        stabilityScore: manualBoost ? 88 : undefined,
        priceDataScore: top100Boost ? 91 : undefined,
        tokenAgeDays: undefined,
    };
}

function createSeed(entry: StrategyUniverseEntry, index: number): StrategyUniverseSeed {
    const profile = profileFor(entry, index);
    const defaults = PROFILE_DEFAULTS[profile];
    const overrides = overridesFor(entry, index);
    const mergedTags = Array.from(new Set([
        ...chainTags(entry.chain || "BNB"),
        ...(defaults.tags || []),
        ...(overrides.tags || []),
    ]));

    return {
        symbol: normalizeStrategyUniverseSymbol(entry.symbol),
        displaySymbol: normalizeStrategyUniverseSymbol(entry.displaySymbol || displaySymbolFromSeedSymbol(entry.symbol)),
        providerId: entry.providerId,
        name: entry.name,
        chain: entry.chain || "BNB",
        address: entry.address,
        decimals: Number(entry.decimals || 18),
        profile,
        liquidityUsd: overrides.liquidityUsd ?? defaults.liquidityUsd,
        volume24hUsd: overrides.volume24hUsd ?? defaults.volume24hUsd,
        spreadBps: overrides.spreadBps ?? defaults.spreadBps,
        marketCapUsd: overrides.marketCapUsd ?? defaults.marketCapUsd,
        tokenAgeDays: overrides.tokenAgeDays ?? defaults.tokenAgeDays,
        stabilityScore: overrides.stabilityScore ?? defaults.stabilityScore,
        priceDataScore: overrides.priceDataScore ?? defaults.priceDataScore,
        excludeFromUniverse: defaults.excludeFromUniverse,
        universeExclusionReason: defaults.universeExclusionReason,
        tags: mergedTags,
    };
}

const BNB_UNIVERSE_ENTRIES = (bnbUniverseEntries as StrategyUniverseEntry[]).map((entry) => ({
    ...entry,
    symbol: normalizeStrategyUniverseSymbol(entry.symbol),
    displaySymbol: normalizeStrategyUniverseSymbol(entry.displaySymbol || entry.symbol),
    chain: "BNB" as const,
}));

const SOLANA_UNIVERSE_ENTRIES = (solanaUniverseEntries as StrategyUniverseEntry[]).map((entry) => ({
    ...entry,
    symbol: normalizeStrategyUniverseSymbol(entry.symbol),
    displaySymbol: normalizeStrategyUniverseSymbol(entry.displaySymbol || displaySymbolFromSeedSymbol(entry.symbol)),
    chain: "SOLANA" as const,
}));

export const STRATEGY_UNIVERSE_SEEDS: StrategyUniverseSeed[] = [
    ...BNB_UNIVERSE_ENTRIES.map((entry, index) => createSeed(entry, index)),
    ...SOLANA_UNIVERSE_ENTRIES.map((entry, index) => createSeed(entry, index)),
].filter((seed) => normalizeStrategyUniverseSymbol(seed.symbol) !== "PUMP.SOL");

export const STRATEGY_UNIVERSE_SYMBOLS = STRATEGY_UNIVERSE_SEEDS.map((seed) => seed.symbol);

export const STRATEGY_UNIVERSE_PROVIDER_MAP: Record<string, string> = Object.fromEntries(
    STRATEGY_UNIVERSE_SEEDS.map((seed) => [seed.symbol, seed.providerId]),
);

export const STRATEGY_UNIVERSE_SEED_MAP: Record<string, StrategyUniverseSeed> = Object.fromEntries(
    STRATEGY_UNIVERSE_SEEDS.map((seed) => [seed.symbol, seed]),
);

export function getStrategyUniverseSeed(symbol: string) {
    return STRATEGY_UNIVERSE_SEED_MAP[normalizeStrategyUniverseSymbol(symbol)];
}

export function getStrategyAssetMeta(symbol: string) {
    const seed = getStrategyUniverseSeed(symbol);
    const normalized = normalizeStrategyUniverseSymbol(symbol);
    return {
        symbol: normalized,
        displaySymbol: seed?.displaySymbol || displaySymbolFromSeedSymbol(normalized),
        chain: seed?.chain || "BNB",
        providerId: seed?.providerId || normalized.toLowerCase(),
        name: seed?.name || normalized,
        address: seed?.address,
    };
}
