/**
 * CoinGecko API 最適化レイヤー
 * Demo plan制限（10,000 calls/月、30 calls/分）内で安定稼働するための
 * レートリミット管理・キャッシュ戦略・スマートフェッチング
 */

// ========== Rate Limit Manager ==========

interface RateLimitState {
    callsThisMinute: number;
    callsThisMonth: number;
    minuteResetTime: number;
    monthResetTime: number;
    retryAfter: number | null;
    lastError: string | null;
}

const RATE_LIMITS = {
    maxPerMinute: 25, // 30制限に対して5バッファ
    maxPerMonth: 9500, // 10000制限に対して500バッファ
    retryBaseMs: 1000,
    retryMaxMs: 30000,
    maxRetries: 3,
};

let rateLimitState: RateLimitState = {
    callsThisMinute: 0,
    callsThisMonth: 0,
    minuteResetTime: Date.now() + 60000,
    monthResetTime: Date.now() + 30 * 24 * 60 * 60 * 1000,
    retryAfter: null,
    lastError: null,
};

// localStorage persistence (browser only)
const isBrowser = typeof window !== "undefined";
const RATE_STATE_KEY = "jdex_rate_limit_state";

function loadRateLimitState(): void {
    if (!isBrowser) return;
    try {
        const saved = localStorage.getItem(RATE_STATE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            rateLimitState = { ...rateLimitState, ...parsed };
        }
    } catch { /* ignore */ }
}

function saveRateLimitState(): void {
    if (!isBrowser) return;
    try {
        localStorage.setItem(RATE_STATE_KEY, JSON.stringify(rateLimitState));
    } catch { /* ignore */ }
}

function resetMinuteCounterIfNeeded(): void {
    if (Date.now() > rateLimitState.minuteResetTime) {
        rateLimitState.callsThisMinute = 0;
        rateLimitState.minuteResetTime = Date.now() + 60000;
        saveRateLimitState();
    }
}

function canMakeCall(): { allowed: boolean; waitMs: number; reason?: string } {
    resetMinuteCounterIfNeeded();

    if (rateLimitState.retryAfter && Date.now() < rateLimitState.retryAfter) {
        return { allowed: false, waitMs: rateLimitState.retryAfter - Date.now(), reason: "429 retry-after" };
    }

    if (rateLimitState.callsThisMinute >= RATE_LIMITS.maxPerMinute) {
        const waitMs = rateLimitState.minuteResetTime - Date.now();
        return { allowed: false, waitMs: Math.max(0, waitMs), reason: `分間制限 (${rateLimitState.callsThisMinute}/${RATE_LIMITS.maxPerMinute})` };
    }

    if (rateLimitState.callsThisMonth >= RATE_LIMITS.maxPerMonth) {
        return { allowed: false, waitMs: 0, reason: `月間制限超過 (${rateLimitState.callsThisMonth}/${RATE_LIMITS.maxPerMonth})` };
    }

    return { allowed: true, waitMs: 0 };
}

function recordCall(): void {
    rateLimitState.callsThisMinute++;
    rateLimitState.callsThisMonth++;
    rateLimitState.lastError = null;
    saveRateLimitState();
}

function recordError(status: number, retryAfterHeader?: string): void {
    if (status === 429) {
        const retryMs = retryAfterHeader ? parseInt(retryAfterHeader) * 1000 : 60000;
        rateLimitState.retryAfter = Date.now() + retryMs;
    }
    rateLimitState.lastError = `HTTP ${status}`;
    saveRateLimitState();
}

// ========== Multi-TTL Cache ==========

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    ttl: number;
    etag?: string;
}

const memoryCache = new Map<string, CacheEntry<any>>();

// エンドポイント別TTL (ミリ秒)
const ENDPOINT_TTL: Record<string, number> = {
    "/simple/price": 30000,           // 30秒
    "/coins/markets": 60000,          // 1分
    "/exchanges": 60000,              // 1分
    "/search/trending": 300000,       // 5分
    "/search": 300000,                // 5分
    "/coins/top_gainers_losers": 120000, // 2分
    "/onchain/": 120000,              // 2分
    default: 60000,                   // デフォルト1分
};

function getTTLForEndpoint(url: string): number {
    for (const [pattern, ttl] of Object.entries(ENDPOINT_TTL)) {
        if (pattern !== "default" && url.includes(pattern)) return ttl;
    }
    return ENDPOINT_TTL.default;
}

function getCached<T>(key: string): T | null {
    const entry = memoryCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
        memoryCache.delete(key);
        return null;
    }
    return entry.data;
}

function setCache<T>(key: string, data: T, ttl: number, etag?: string): void {
    memoryCache.set(key, { data, timestamp: Date.now(), ttl, etag });
    // メモリキャッシュ上限管理（LRU簡易版）
    if (memoryCache.size > 200) {
        const oldest = memoryCache.keys().next().value;
        if (oldest) memoryCache.delete(oldest);
    }
}

// ========== Smart Fetch with Rate Limiting ==========

const COINGECKO_BASE = "https://api.coingecko.com/api/v3";
const DEMO_API_KEY = isBrowser ? (typeof process !== "undefined" ? "" : "") : "";

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export async function smartFetch<T>(endpoint: string, options?: { forceRefresh?: boolean }): Promise<T | null> {
    // Determine the API path (relative to CoinGecko base)
    const apiPath = endpoint.startsWith("http") ? endpoint.replace(COINGECKO_BASE, "") : endpoint;

    // Browser: use proxy to bypass CORS. Server: call CoinGecko directly.
    const url = isBrowser
        ? `/api/coingecko?path=${encodeURIComponent(apiPath)}`
        : `${COINGECKO_BASE}${apiPath}`;
    const cacheKey = `${COINGECKO_BASE}${apiPath}`; // Consistent cache key

    // 1. Check cache first
    if (!options?.forceRefresh) {
        const cached = getCached<T>(cacheKey);
        if (cached) return cached;
    }

    // 2. Check rate limit
    const rateCheck = canMakeCall();
    if (!rateCheck.allowed) {
        console.warn(`[CoinGecko] Rate limited: ${rateCheck.reason}, wait ${rateCheck.waitMs}ms`);
        // Return stale cache if available
        const staleEntry = memoryCache.get(cacheKey);
        if (staleEntry) {
            console.warn("[CoinGecko] Returning stale cache");
            return staleEntry.data;
        }
        return null;
    }

    // 3. Fetch with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= RATE_LIMITS.maxRetries; attempt++) {
        try {
            const headers: Record<string, string> = {
                "Accept": "application/json",
            };

            // Cache entry for ETag / 304 support
            const existingEntry = memoryCache.get(cacheKey);

            // Only add CoinGecko-specific headers when calling directly (server-side)
            if (!isBrowser) {
                if (DEMO_API_KEY) {
                    headers["x-cg-demo-api-key"] = DEMO_API_KEY;
                }
                if (existingEntry?.etag) {
                    headers["If-None-Match"] = existingEntry.etag;
                }
            }

            recordCall();
            const response = await fetch(url, { headers });

            // 304 Not Modified - return cached
            if (response.status === 304 && existingEntry) {
                existingEntry.timestamp = Date.now(); // Refresh TTL
                return existingEntry.data;
            }

            if (response.status === 429) {
                const retryAfter = response.headers.get("Retry-After") || undefined;
                recordError(429, retryAfter);
                const backoffMs = Math.min(
                    RATE_LIMITS.retryBaseMs * Math.pow(2, attempt),
                    RATE_LIMITS.retryMaxMs
                );
                console.warn(`[CoinGecko] 429 - Retrying in ${backoffMs}ms (attempt ${attempt + 1})`);
                await sleep(backoffMs);
                continue;
            }

            if (response.status === 503) {
                recordError(503);
                await sleep(2000);
                continue;
            }

            if (!response.ok) {
                recordError(response.status);
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            const ttl = getTTLForEndpoint(url);
            const etag = response.headers.get("ETag") || undefined;
            setCache(cacheKey, data, ttl, etag);
            return data;
        } catch (e) {
            lastError = e as Error;
            if (attempt < RATE_LIMITS.maxRetries) {
                await sleep(RATE_LIMITS.retryBaseMs * Math.pow(2, attempt));
            }
        }
    }

    console.error(`[CoinGecko] All retries failed for ${endpoint}:`, lastError?.message);

    // Fallback to stale cache
    const staleEntry = memoryCache.get(cacheKey);
    if (staleEntry) {
        console.warn("[CoinGecko] Returning stale cache due to error");
        return staleEntry.data;
    }

    // Fallback to Mock Data (Critical for CORS/RateLimit in Demo)
    console.warn("[CoinGecko] Returning MOCK data due to failure");
    return getMockDataForEndpoint(url);
}

function getMockDataForEndpoint(url: string): any {
    if (url.includes("/search/trending")) {
        return { coins: Array.from({ length: 5 }).map((_, i) => ({ item: { id: `mock-${i}`, name: `Mock Coin ${i}`, symbol: `MCK${i}`, market_cap_rank: i + 1, thumb: "", price_btc: 0.0001, score: i, data: { price: "¥100", price_change_percentage_24h: { usd: 5.5 }, total_volume: "¥100M" } } })) };
    }
    if (url.includes("/search")) {
        return {
            coins: Array.from({ length: 15 }).map((_, i) => ({
                id: `mock-token-${i}`,
                symbol: `MOCK${i}`,
                name: `Mock Token ${i}`,
                image: "",
                market_cap_rank: i + 1,
            }))
        };
    }
    if (url.includes("/coins/markets")) {
        return Array.from({ length: 15 }).map((_, i) => ({
            id: `mock-token-${i}`,
            symbol: `MOCK${i}`,
            name: `Mock Token ${i}`,
            image: "",
            current_price: 100 + i * 10,
            market_cap: 1000000000,
            market_cap_rank: i + 1,
            price_change_percentage_24h: (Math.random() - 0.5) * 10,
            total_volume: 50000000,
            sparkline_in_7d: { price: Array.from({ length: 20 }).map(() => 100 + Math.random() * 20) }
        }));
    }
    return null; // data
}

// ========== Optimized Bulk Endpoints ==========

/** バルク: 上位250通貨を1コールで取得 */
export async function fetchTopCoinsMarkets(page = 1, perPage = 250): Promise<any[]> {
    const data = await smartFetch<any[]>(
        `/coins/markets?vs_currency=jpy&order=volume_desc&per_page=${perPage}&page=${page}&sparkline=true`
    );
    return data || [];
}

/** トレンドコイン取得 */
export async function fetchTrending(): Promise<any> {
    return await smartFetch<any>("/search/trending");
}

/** トップゲイナー/ルーザー */
export async function fetchTopGainersLosers(): Promise<any> {
    return await smartFetch<any>("/coins/top_gainers_losers?vs_currency=jpy&duration=24h");
}

/** AI推奨通貨のスコアリング */
export interface AIRecommendation {
    id: string;
    symbol: string;
    name: string;
    image: string;
    currentPrice: number;
    priceChange24h: number;
    volume24h: number;
    marketCap: number;
    score: number;
    reason: string;
}

export async function fetchAIRecommendations(): Promise<AIRecommendation[]> {
    // 1. バルクで上位通貨取得（1コール）
    const markets = await fetchTopCoinsMarkets(1, 250);
    if (!markets.length) return [];

    // 2. トレンド情報（1コール）
    const trending = await fetchTrending();
    const trendingIds = new Set(
        trending?.coins?.map((c: any) => c.item.id) || []
    );

    // 3. スコアリング
    const scored: AIRecommendation[] = markets
        .filter((c: any) => c.total_volume > 100000000) // 1億円以上ボリューム
        .map((coin: any) => {
            let score = 0;
            const reasons: string[] = [];

            // 変動率スコア
            const changeAbs = Math.abs(coin.price_change_percentage_24h || 0);
            if (changeAbs > 20) { score += 30; reasons.push(`変動率${changeAbs.toFixed(1)}%`); }
            else if (changeAbs > 10) { score += 20; reasons.push(`変動率${changeAbs.toFixed(1)}%`); }
            else if (changeAbs > 5) { score += 10; }

            // ボリュームスコア
            if (coin.total_volume > 10000000000) { score += 20; reasons.push("超高ボリューム"); }
            else if (coin.total_volume > 1000000000) { score += 15; }
            else if (coin.total_volume > 100000000) { score += 10; }

            // トレンドスコア
            if (trendingIds.has(coin.id)) { score += 25; reasons.push("トレンド入り🔥"); }

            // 時価総額バランス
            if (coin.market_cap > 100000000000) { score += 5; }
            else if (coin.market_cap < 10000000000) { score += 15; reasons.push("中小型成長候補"); }

            // ATHからの乖離
            if (coin.ath && coin.current_price) {
                const athRatio = coin.current_price / coin.ath;
                if (athRatio < 0.3) { score += 10; reasons.push("ATH比-70%以上"); }
            }

            return {
                id: coin.id,
                symbol: coin.symbol?.toUpperCase(),
                name: coin.name,
                image: coin.image,
                currentPrice: coin.current_price || 0,
                priceChange24h: coin.price_change_percentage_24h || 0,
                volume24h: coin.total_volume || 0,
                marketCap: coin.market_cap || 0,
                score,
                reason: reasons.join(" / ") || "安定銘柄",
            };
        })
        .sort((a: AIRecommendation, b: AIRecommendation) => b.score - a.score)
        .slice(0, 10);

    return scored;
}

// ========== On-chain DEX Data ==========

/** On-chain: トレンドプール取得 */
export async function fetchOnchainPools(network = "solana", page = 1): Promise<any[]> {
    const data = await smartFetch<any>(
        `/onchain/networks/${network}/dexes?page=${page}`
    );
    return data?.data || [];
}

/** On-chain: 新着プール */
export async function fetchNewPools(network = "ethereum"): Promise<any[]> {
    const data = await smartFetch<any>(
        `/onchain/networks/${network}/new_pools?page=1`
    );
    return data?.data || [];
}

/** On-chain: トークン価格一括取得 */
export async function fetchOnchainTokenPrices(
    network: string,
    addresses: string[]
): Promise<Record<string, any>> {
    if (addresses.length === 0) return {};
    const joined = addresses.slice(0, 30).join(","); // 最大30アドレス
    const data = await smartFetch<any>(
        `/onchain/simple/${network}/token_price/${joined}?vs_currencies=jpy`
    );
    return data || {};
}

/** On-chain: プールOHLCVデータ（6ヶ月以内） */
export async function fetchPoolOHLCV(
    network: string,
    poolAddress: string,
    timeframe = "1h",
    limit = 168 // 7日分
): Promise<any[]> {
    const data = await smartFetch<any>(
        `/onchain/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?limit=${limit}`
    );
    return data?.data?.attributes?.ohlcv_list || [];
}

// ========== WebSocket Polling Optimizer ==========

interface PollingConfig {
    interval: number; // ms
    endpoints: string[];
    onChange?: (key: string, data: any) => void;
}

let pollingIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();
let previousData: Map<string, string> = new Map(); // JSON hash for diff detection

export function startOptimizedPolling(config: PollingConfig): () => void {
    // Clear existing intervals first
    stopAllPolling();

    const poll = async () => {
        for (const endpoint of config.endpoints) {
            const data = await smartFetch(endpoint);
            if (!data) continue;

            const dataHash = JSON.stringify(data);
            const prevHash = previousData.get(endpoint);

            // Only notify on change (diff-based)
            if (dataHash !== prevHash) {
                previousData.set(endpoint, dataHash);
                config.onChange?.(endpoint, data);
            }
        }
    };

    // Initial fetch
    poll();

    // Set interval
    const intervalId = setInterval(poll, config.interval);
    pollingIntervals.set("main", intervalId);

    // Return cleanup function
    return stopAllPolling;
}

export function stopAllPolling(): void {
    pollingIntervals.forEach(interval => clearInterval(interval));
    pollingIntervals.clear();
}

// ========== Monitoring & Status ==========

export function getAPIStatus(): {
    callsThisMinute: number;
    callsThisMonth: number;
    maxPerMinute: number;
    maxPerMonth: number;
    cacheSize: number;
    lastError: string | null;
    isHealthy: boolean;
} {
    loadRateLimitState();
    resetMinuteCounterIfNeeded();
    return {
        callsThisMinute: rateLimitState.callsThisMinute,
        callsThisMonth: rateLimitState.callsThisMonth,
        maxPerMinute: RATE_LIMITS.maxPerMinute,
        maxPerMonth: RATE_LIMITS.maxPerMonth,
        cacheSize: memoryCache.size,
        lastError: rateLimitState.lastError,
        isHealthy: rateLimitState.callsThisMonth < RATE_LIMITS.maxPerMonth * 0.9,
    };
}

/** 月間コール推定（現在使用ペース） */
export function estimateMonthlyUsage(): { dailyAvg: number; projectedMonthly: number; withinBudget: boolean } {
    // 簡易推定
    const dayOfMonth = new Date().getDate();
    const dailyAvg = dayOfMonth > 0 ? rateLimitState.callsThisMonth / dayOfMonth : 0;
    const projectedMonthly = dailyAvg * 30;
    return {
        dailyAvg: Math.round(dailyAvg),
        projectedMonthly: Math.round(projectedMonthly),
        withinBudget: projectedMonthly < RATE_LIMITS.maxPerMonth,
    };
}

// Initialize state on load
loadRateLimitState();
