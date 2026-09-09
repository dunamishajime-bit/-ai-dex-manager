function normalized(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function hasAsterCommunicationFailure(value: string) {
    return value.includes("http 429")
        || value.includes("too many requests")
        || value.includes("rate limit")
        || value.includes("connection reset by peer")
        || value.includes("connectionreseterror")
        || value.includes("device time must match the actual time");
}

export function isAsterUpstreamKillReason(reason: unknown) {
    const value = normalized(reason);
    const v52Upstream = value.startsWith("v52 fatal tick error:") || value.startsWith("v52 upstream state unavailable:");
    return v52Upstream && hasAsterCommunicationFailure(value);
}

export function isRecoverableV12AsterManualReview(reason: unknown) {
    const value = normalized(reason);
    if (!value) return true;
    return value.startsWith("aster ") && hasAsterCommunicationFailure(value);
}
