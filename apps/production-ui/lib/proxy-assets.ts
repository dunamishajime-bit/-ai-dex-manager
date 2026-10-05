export const PROXY_EXECUTION_ASSET_LABELS: Record<string, string> = {
    "0xb7c0007ab75350c582d5eab1862b872b5cf53f0c": "pumpBTC Governance token (PUMP)",
    "0x6418c0dd099a9fda397c766304cdd918233e8847": "PENGU",
};

export const PROXY_EXECUTION_HEADING_LABELS: Record<string, string> = {
    "0xb7c0007ab75350c582d5eab1862b872b5cf53f0c": "PUMPBTC",
    "0x6418c0dd099a9fda397c766304cdd918233e8847": "PENGU",
};

export const PROXY_EXECUTION_PREFERRED_DISPLAY_SYMBOLS: Record<string, string> = {
    "0xb7c0007ab75350c582d5eab1862b872b5cf53f0c": "PUMPBTC",
    "0x6418c0dd099a9fda397c766304cdd918233e8847": "PENGU",
};

export const AUTO_TRADE_EXCLUDED_EXECUTION_TARGETS = new Set([
    "0xb7c0007ab75350c582d5eab1862b872b5cf53f0c",
]);

export function normalizeExecutionTarget(value?: string) {
    return String(value || "").trim().toLowerCase();
}

export function getProxyExecutionAssetLabel(executionTarget?: string, fallback?: string) {
    const normalized = normalizeExecutionTarget(executionTarget);
    return PROXY_EXECUTION_ASSET_LABELS[normalized] || fallback || "";
}

export function getProxyExecutionHeadingLabel(executionTarget?: string, fallback?: string) {
    const normalized = normalizeExecutionTarget(executionTarget);
    return PROXY_EXECUTION_HEADING_LABELS[normalized] || fallback || "";
}

export function getProxyPreferredDisplaySymbol(executionTarget?: string, fallback?: string) {
    const normalized = normalizeExecutionTarget(executionTarget);
    return PROXY_EXECUTION_PREFERRED_DISPLAY_SYMBOLS[normalized] || fallback || "";
}

export function isKnownProxyExecutionTarget(executionTarget?: string) {
    return Boolean(PROXY_EXECUTION_ASSET_LABELS[normalizeExecutionTarget(executionTarget)]);
}

export function isAutoTradeExcludedExecutionTarget(executionTarget?: string) {
    return AUTO_TRADE_EXCLUDED_EXECUTION_TARGETS.has(normalizeExecutionTarget(executionTarget));
}
