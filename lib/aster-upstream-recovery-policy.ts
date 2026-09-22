function normalized(value: unknown) {
    return String(value || "").trim().toLowerCase();
}

function hasAsterCommunicationFailure(value: string) {
    return value.includes("http 429")
        || value.includes("http 418")
        || value.includes("ip banned")
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

export function isRecoverableV52ReferenceKillReason(reason: unknown) {
    const value = normalized(reason);
    return value.startsWith("v52 fatal tick error: http 503 http://127.0.0.1:8797/quote?symbol=")
        && value.includes('"error":"stale_quote"');
}

export function isRecoverableV12AsterManualReview(reason: unknown) {
    const value = normalized(reason);
    if (!value) return true;
    return value.startsWith("aster ") && hasAsterCommunicationFailure(value);
}

// A pre-cutover V52 daemon can write this exact state-lineage reason after a
// newer Q102 state has already been migrated.  It is recoverable only after
// the release-conflicting daemon has been stopped and the authenticated flat
// recovery gate has passed; all other state mismatches remain fail-closed.
export function isRecoverableV12RuntimeLineageKillReason(reason: unknown) {
    return normalized(reason) === "v52 upstream state unavailable: quality102_state_mismatch:runtimecommitsha";
}

export function isRecoverableV12RuntimeLineageManualReview(reason: unknown) {
    return normalized(reason) === "quality102_ownership_runtime_sha_mismatch";
}
