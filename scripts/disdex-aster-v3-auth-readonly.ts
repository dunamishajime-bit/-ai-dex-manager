import "dotenv/config";

import { createHash } from "node:crypto";
import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function normalizeAddress(value?: string) {
    const trimmed = String(value || "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
        throw new Error("ASTER_USER_ADDRESS must be a 20-byte 0x-prefixed EVM address.");
    }
    return trimmed.toLowerCase();
}

function normalizePrivateKeyForValidation(value?: string) {
    const trimmed = String(value || "").trim();
    const normalized = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
    if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
        throw new Error("ASTER_API_PRIVATE_KEY must be a 32-byte hex private key.");
    }
    return normalized;
}

function fingerprint(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function classifyAsterError(error: AsterApiError) {
    switch (error.code) {
        case -2014:
            return "BAD_API_KEY_FORMAT_OR_LEGACY_AUTH_PATH";
        case -2015:
            return "CREDENTIAL_IP_OR_PERMISSION_REJECTED";
        case -1022:
            return "SIGNATURE_REJECTED";
        case -1021:
            return "TIMESTAMP_OR_RECV_WINDOW_REJECTED";
        default:
            return `ASTER_HTTP_${error.status}_CODE_${error.code ?? "UNKNOWN"}`;
    }
}

async function main() {
    const userAddress = normalizeAddress(process.env.ASTER_USER_ADDRESS);
    const privateKey = normalizePrivateKeyForValidation(process.env.ASTER_API_PRIVATE_KEY);
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL || "https://fapi3.asterdex.com",
        userAddress,
        privateKey: privateKey as `0x${string}`,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-Aster-V3-Auth-ReadOnly/1.0",
    });

    if (!client.hasTradingCredentials()) {
        throw new Error("Aster V3 credentials are incomplete.");
    }

    const ping = await client.ping();
    void ping;
    const serverTime = await client.getServerTime();
    const balances = await client.getBalances();
    const positions = await client.getPositions();
    const openOrders = await client.getOpenOrders();

    console.log(JSON.stringify({
        status: "ASTER_V3_AUTH_READONLY_PASS",
        baseUrl: client.baseUrl,
        userAddress,
        signerAddress: client.signerAddress,
        credentialFingerprint: fingerprint(`${userAddress}:${client.signerAddress}`),
        serverTime: serverTime.serverTime,
        balanceRows: Array.isArray(balances) ? balances.length : -1,
        positionRows: Array.isArray(positions) ? positions.length : -1,
        openOrderRows: Array.isArray(openOrders) ? openOrders.length : -1,
        ordersSent: false,
        cancelSent: false,
        marginTypeChanged: false,
        leverageChanged: false,
        secretsPrinted: false,
    }));
}

main().catch((error) => {
    if (error instanceof AsterApiError) {
        console.error(JSON.stringify({
            status: "ASTER_V3_AUTH_READONLY_FAIL_CLOSED",
            classification: classifyAsterError(error),
            httpStatus: error.status,
            asterCode: error.code,
            message: error.message,
            ordersSent: false,
            cancelSent: false,
            marginTypeChanged: false,
            leverageChanged: false,
            secretsPrinted: false,
        }));
    } else {
        console.error(JSON.stringify({
            status: "ASTER_V3_AUTH_READONLY_FAIL_CLOSED",
            classification: "LOCAL_CREDENTIAL_VALIDATION_OR_RUNTIME_ERROR",
            message: error instanceof Error ? error.message : String(error),
            ordersSent: false,
            cancelSent: false,
            marginTypeChanged: false,
            leverageChanged: false,
            secretsPrinted: false,
        }));
    }
    process.exitCode = 1;
});
