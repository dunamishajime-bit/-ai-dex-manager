import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import sgMail from "@sendgrid/mail";
import nodemailer from "nodemailer";

export const TRADE_FILL_NOTIFICATION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_TRADE_FILL_NOTIFICATION_EMAIL = "dunamis.hajime@gmail.com";
export const DEFAULT_TRADE_FILL_NOTIFICATION_SPOOL_PATH = "/var/lib/disdex/shared/trade-fill-notifications/inbox.jsonl";
export const DEFAULT_TRADE_FILL_NOTIFICATION_STATE_PATH = "/var/lib/disdex/shared/trade-fill-notifications/state.json";
export const DEFAULT_TRADE_FILL_NOTIFICATION_LOCK_PATH = "/var/lib/disdex/shared/trade-fill-notifications/notifier.lock";

export type TradeFillNotificationEventType = "ENTRY_FILL" | "EXIT_FILL" | "FILL";

export interface TradeFillNotificationEvent {
    schemaVersion: typeof TRADE_FILL_NOTIFICATION_SCHEMA_VERSION;
    strategyId: string;
    eventType: TradeFillNotificationEventType;
    symbol: string;
    side: "BUY" | "SELL";
    reduceOnly: boolean;
    status: string;
    requestId?: string;
    orderId?: string;
    clientOrderId: string;
    executedQuantity: number;
    averagePrice: number;
    quoteQuantity: number;
    executedAt: string;
    reason: string;
    metadata?: Record<string, unknown>;
}

export interface TradeFillResultLike {
    requestId?: string;
    clientOrderId?: string;
    symbol?: string;
    side?: string;
    status?: string;
    reduceOnly?: boolean;
    requestedQuantity?: number;
    submittedQuantity?: number;
    executedQuantity?: number;
    averagePrice?: number;
    quoteQuantity?: number;
    orderId?: string | number;
    updatedAt?: number;
    raw?: { updateTime?: number; reduceOnly?: boolean };
    reason?: string;
}

export interface TradeFillNotificationContext {
    env?: NodeJS.ProcessEnv;
    strategyId?: string;
    eventType?: TradeFillNotificationEventType;
    reduceOnly?: boolean;
    reason?: string;
    executedAt?: string;
    metadata?: Record<string, unknown>;
}

export interface TradeFillEmailPayload {
    subject: string;
    text: string;
    html: string;
}

export interface TradeFillNotificationSpoolOptions {
    env?: NodeJS.ProcessEnv;
    spoolPath?: string;
    statePath?: string;
    lockPath?: string;
    send?: (event: TradeFillNotificationEvent) => Promise<void>;
}

export interface TradeFillNotificationSpoolResult {
    sent: number;
    skipped: number;
    pending: boolean;
    offset: number;
}

interface TradeFillNotificationState {
    schemaVersion: typeof TRADE_FILL_NOTIFICATION_SCHEMA_VERSION;
    offset: number;
    sent: Record<string, {
        sentAt: string;
        strategyId: string;
        eventType: TradeFillNotificationEventType;
        symbol: string;
    }>;
}

function finite(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function truthy(value: unknown): boolean {
    return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function normalizedStatus(value: unknown): string {
    return String(value || "UNKNOWN").trim().toUpperCase();
}

function normalizedSide(value: unknown): "BUY" | "SELL" {
    const side = String(value || "").trim().toUpperCase();
    if (side !== "BUY" && side !== "SELL") throw new Error(`Invalid trade fill side: ${side || "missing"}`);
    return side;
}

function validSymbol(value: unknown): string {
    const symbol = String(value || "").trim().toUpperCase();
    if (!symbol) throw new Error("Trade fill symbol is missing.");
    return symbol;
}

function validClientOrderId(value: unknown): string {
    const clientOrderId = String(value || "").trim();
    if (!clientOrderId) throw new Error("Trade fill clientOrderId is missing.");
    return clientOrderId;
}

export function isConfirmedTradeFill(input: TradeFillResultLike | TradeFillNotificationEvent): boolean {
    const status = normalizedStatus(input.status);
    return (
        (status === "FILLED" || status === "PARTIALLY_FILLED")
        && finite(input.executedQuantity) > 0
        && Boolean(String(input.symbol || "").trim())
        && Boolean(String(input.clientOrderId || "").trim())
    );
}

export function resolveTradeFillStrategyId(env: NodeJS.ProcessEnv = process.env): string {
    const explicit = String(env.DISDEX_TRADE_FILL_STRATEGY_ID || "").trim();
    if (explicit) return explicit;
    const runnerId = String(env.DISDEX_RUNNER_ID || "").trim().toUpperCase();
    const mapping: Record<string, string> = {
        V12_X1_ALL: "V12_X1.00_ALL",
        PENGU_V8: "PENGU_DUAL_LS_V2_FINAL",
        QUALITY102_CAUSAL_V1: "QUALITY102_CAUSAL_V1",
        V52: "V52",
    };
    return mapping[runnerId] || runnerId || "UNKNOWN_STRATEGY";
}

function eventTimestamp(result: TradeFillResultLike, context: TradeFillNotificationContext): string {
    if (context.executedAt) return context.executedAt;
    const timestamp = finite(result.updatedAt || result.raw?.updateTime);
    if (timestamp > 0) return new Date(timestamp).toISOString();
    return new Date().toISOString();
}

export function buildTradeFillNotificationEvent(
    result: TradeFillResultLike,
    context: TradeFillNotificationContext = {},
): TradeFillNotificationEvent {
    if (!isConfirmedTradeFill(result)) throw new Error("Only a confirmed non-zero fill may be notified.");
    const reduceOnly = context.reduceOnly ?? result.reduceOnly ?? result.raw?.reduceOnly ?? false;
    const eventType = context.eventType || (reduceOnly ? "EXIT_FILL" : "ENTRY_FILL");
    const executedQuantity = finite(result.executedQuantity);
    const averagePrice = finite(result.averagePrice);
    const quoteQuantity = finite(result.quoteQuantity) || (averagePrice > 0 ? executedQuantity * averagePrice : 0);
    return {
        schemaVersion: TRADE_FILL_NOTIFICATION_SCHEMA_VERSION,
        strategyId: context.strategyId || resolveTradeFillStrategyId(context.env),
        eventType,
        symbol: validSymbol(result.symbol),
        side: normalizedSide(result.side),
        reduceOnly: Boolean(reduceOnly),
        status: normalizedStatus(result.status),
        requestId: result.requestId ? String(result.requestId) : undefined,
        orderId: result.orderId !== undefined && result.orderId !== null ? String(result.orderId) : undefined,
        clientOrderId: validClientOrderId(result.clientOrderId),
        executedQuantity,
        averagePrice,
        quoteQuantity,
        executedAt: eventTimestamp(result, context),
        reason: context.reason || result.reason || "実約定",
        metadata: context.metadata,
    };
}

export function tradeFillNotificationKey(event: TradeFillNotificationEvent): string {
    const stable = [
        event.schemaVersion,
        event.strategyId,
        event.eventType,
        event.symbol,
        event.side,
        event.reduceOnly ? "1" : "0",
        event.status,
        event.orderId || "",
        event.clientOrderId,
        event.executedQuantity.toFixed(12),
        event.averagePrice.toFixed(12),
        event.quoteQuantity.toFixed(12),
    ].join("|");
    return createHash("sha256").update(stable).digest("hex");
}

export function notificationPaths(env: NodeJS.ProcessEnv = process.env) {
    return {
        spoolPath: String(env.DISDEX_TRADE_FILL_NOTIFICATION_SPOOL_PATH || DEFAULT_TRADE_FILL_NOTIFICATION_SPOOL_PATH),
        statePath: String(env.DISDEX_TRADE_FILL_NOTIFICATION_STATE_PATH || DEFAULT_TRADE_FILL_NOTIFICATION_STATE_PATH),
        lockPath: String(env.DISDEX_TRADE_FILL_NOTIFICATION_LOCK_PATH || DEFAULT_TRADE_FILL_NOTIFICATION_LOCK_PATH),
    };
}

function htmlEscape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function japaneseTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "時刻未取得";
    return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(date).replace(/\//g, "-") + " JST";
}

export function renderTradeFillEmail(event: TradeFillNotificationEvent): TradeFillEmailPayload {
    const action = event.eventType === "EXIT_FILL" || event.reduceOnly ? "決済" : "新規";
    const timestamp = japaneseTimestamp(event.executedAt);
    const price = event.averagePrice > 0 ? event.averagePrice.toLocaleString("ja-JP", { maximumFractionDigits: 12 }) : "未取得";
    const quantity = event.executedQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 12 });
    const quote = event.quoteQuantity > 0 ? event.quoteQuantity.toLocaleString("ja-JP", { maximumFractionDigits: 2 }) : "未取得";
    const subject = `【DisDex】約定通知｜${event.strategyId}｜${action}｜${event.symbol}`;
    const text = [
        "DisDex 実約定通知",
        `ロジック: ${event.strategyId}`,
        `区分: ${action}`,
        `通貨: ${event.symbol}`,
        `売買: ${event.side}`,
        `状態: ${event.status}`,
        `約定数量: ${quantity}`,
        `平均約定価格: ${price}`,
        `約定金額: ${quote}`,
        `約定時刻: ${timestamp}`,
        `注文ID: ${event.orderId || "未取得"}`,
        `Client Order ID: ${event.clientOrderId}`,
        `理由: ${event.reason}`,
    ].join("\n");
    const rows = [
        ["ロジック", event.strategyId],
        ["区分", action],
        ["通貨", event.symbol],
        ["売買", event.side],
        ["状態", event.status],
        ["約定数量", quantity],
        ["平均約定価格", price],
        ["約定金額", quote],
        ["約定時刻", timestamp],
        ["注文ID", event.orderId || "未取得"],
        ["Client Order ID", event.clientOrderId],
        ["理由", event.reason],
    ].map(([label, value]) => `<tr><th style="text-align:left;padding:6px 12px 6px 0">${htmlEscape(label)}</th><td style="padding:6px 0">${htmlEscape(value)}</td></tr>`).join("");
    const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><body style="font-family:Arial,'Yu Gothic',Meiryo,sans-serif"><h2>DisDex 実約定通知</h2><table>${rows}</table></body></html>`;
    return { subject, text, html };
}

async function sendTradeFillEmail(event: TradeFillNotificationEvent, env: NodeJS.ProcessEnv): Promise<void> {
    const recipient = String(env.DISDEX_TRADE_FILL_NOTIFICATION_EMAIL || env.TRADE_FILL_NOTIFICATION_EMAIL || DEFAULT_TRADE_FILL_NOTIFICATION_EMAIL).trim();
    if (!recipient) throw new Error("Trade fill notification recipient is not configured.");
    const payload = renderTradeFillEmail(event);
    const gmailUser = String(env.GMAIL_USER || "").trim();
    const gmailPassword = String(env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
    const sendGridKey = String(env.SENDGRID_API_KEY || "").trim();
    if (gmailUser && gmailPassword) {
        const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPassword } });
        await transporter.sendMail({
            from: { name: "DisDex Manager", address: gmailUser },
            to: recipient,
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
            encoding: "utf-8",
        });
        return;
    }
    if (sendGridKey) {
        sgMail.setApiKey(sendGridKey);
        await sgMail.send({
            to: recipient,
            from: String(env.DISDEX_TRADE_FILL_FROM_EMAIL || "noreply@professional-dismanager.net"),
            subject: payload.subject,
            text: payload.text,
            html: payload.html,
        });
        return;
    }
    throw new Error("Gmail or SendGrid trade fill notification credentials are not configured.");
}

export async function enqueueTradeFillNotification(
    event: TradeFillNotificationEvent,
    env: NodeJS.ProcessEnv = process.env,
): Promise<{ queued: boolean; reason?: string; key?: string }> {
    if (!truthy(env.DISDEX_TRADE_FILL_NOTIFICATION_ENABLED)) return { queued: false, reason: "DISABLED" };
    if (String(env.DISDEX_TRADE_FILL_NOTIFICATION_MODE || "").trim().toLowerCase() !== "live") return { queued: false, reason: "NON_LIVE_MODE" };
    if (!isConfirmedTradeFill(event)) return { queued: false, reason: "NOT_CONFIRMED_FILL" };
    const { spoolPath } = notificationPaths(env);
    await mkdir(dirname(spoolPath), { recursive: true, mode: 0o700 });
    const handle = await open(spoolPath, "a", 0o600);
    try {
        await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    } finally {
        await handle.close();
    }
    try { await chmod(spoolPath, 0o600); } catch { /* best effort on non-POSIX development hosts */ }
    return { queued: true, key: tradeFillNotificationKey(event) };
}

async function readState(path: string): Promise<TradeFillNotificationState> {
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<TradeFillNotificationState>;
        const offset = parsed.offset;
        const sent = parsed.sent;
        if (parsed.schemaVersion !== TRADE_FILL_NOTIFICATION_SCHEMA_VERSION || !Number.isInteger(offset) || (offset as number) < 0 || !sent || typeof sent !== "object") {
            throw new Error("Trade fill notification state is invalid.");
        }
        return { schemaVersion: TRADE_FILL_NOTIFICATION_SCHEMA_VERSION, offset: offset as number, sent: sent as TradeFillNotificationState["sent"] };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: TRADE_FILL_NOTIFICATION_SCHEMA_VERSION, offset: 0, sent: {} };
        throw error;
    }
}

async function writeState(path: string, state: TradeFillNotificationState): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = join(dirname(path), `.${path.split(/[\\/]/).pop() || "state"}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
        await rename(temporary, path);
    } finally {
        await rm(temporary, { force: true }).catch(() => undefined);
    }
    try { await chmod(path, 0o600); } catch { /* best effort on non-POSIX development hosts */ }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try {
        const handle = await open(path, "wx", 0o600);
        await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }), "utf8");
        await handle.close();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
            const lockStat = await stat(path);
            if (Date.now() - lockStat.mtimeMs > 10 * 60_000) {
                await rm(path, { force: true });
                const retry = await open(path, "wx", 0o600);
                await retry.close();
            } else {
                throw new Error("Trade fill notification worker is already running.");
            }
        } catch (lockError) {
            if ((lockError as NodeJS.ErrnoException).code === "ENOENT") return acquireLock(path);
            throw lockError;
        }
    }
    return async () => { await rm(path, { force: true }); };
}

function parseEvent(line: string): TradeFillNotificationEvent {
    const parsed = JSON.parse(line) as Partial<TradeFillNotificationEvent>;
    if (parsed.schemaVersion !== TRADE_FILL_NOTIFICATION_SCHEMA_VERSION || !isConfirmedTradeFill(parsed as TradeFillNotificationEvent)) {
        throw new Error("Trade fill notification spool contains an invalid or unconfirmed event.");
    }
    return {
        schemaVersion: TRADE_FILL_NOTIFICATION_SCHEMA_VERSION,
        strategyId: String(parsed.strategyId || "").trim() || "UNKNOWN_STRATEGY",
        eventType: parsed.eventType || "FILL",
        symbol: validSymbol(parsed.symbol),
        side: normalizedSide(parsed.side),
        reduceOnly: Boolean(parsed.reduceOnly),
        status: normalizedStatus(parsed.status),
        requestId: parsed.requestId ? String(parsed.requestId) : undefined,
        orderId: parsed.orderId ? String(parsed.orderId) : undefined,
        clientOrderId: validClientOrderId(parsed.clientOrderId),
        executedQuantity: finite(parsed.executedQuantity),
        averagePrice: finite(parsed.averagePrice),
        quoteQuantity: finite(parsed.quoteQuantity),
        executedAt: String(parsed.executedAt || ""),
        reason: String(parsed.reason || "実約定"),
        metadata: parsed.metadata,
    };
}

export async function processTradeFillNotificationSpool(options: TradeFillNotificationSpoolOptions = {}): Promise<TradeFillNotificationSpoolResult> {
    const env = options.env || process.env;
    const paths = notificationPaths(env);
    const spoolPath = options.spoolPath || paths.spoolPath;
    const statePath = options.statePath || paths.statePath;
    const lockPath = options.lockPath || paths.lockPath;
    const send = options.send || ((event: TradeFillNotificationEvent) => sendTradeFillEmail(event, env));
    let release: (() => Promise<void>) | undefined;
    try {
        release = await acquireLock(lockPath);
        let contents: string;
        try {
            contents = await readFile(spoolPath, "utf8");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { sent: 0, skipped: 0, pending: false, offset: 0 };
            throw error;
        }
        const state = await readState(statePath);
        if (state.offset > contents.length) throw new Error("Trade fill notification spool was truncated behind its checkpoint.");
        let offset = state.offset;
        let sentCount = 0;
        let skippedCount = 0;
        // Persist an initial checkpoint before attempting delivery.  If the
        // provider fails, the event remains at offset 0 and can be retried on
        // the next timer invocation without losing the durable state file.
        await writeState(statePath, state);
        const remainder = contents.slice(offset);
        const completeLength = remainder.lastIndexOf("\n") + 1;
        const complete = completeLength > 0 ? remainder.slice(0, completeLength) : "";
        const lines = complete.split("\n").filter((line) => line.length > 0);
        for (const line of lines) {
            // `contents` is a JavaScript string and `slice` uses UTF-16 code
            // units, so the checkpoint must use the same unit rather than
            // UTF-8 byte length (the events contain Japanese text).
            const recordLength = line.length + 1;
            const event = parseEvent(line);
            const key = tradeFillNotificationKey(event);
            if (state.sent[key]) {
                offset += recordLength;
                skippedCount += 1;
                state.offset = offset;
                continue;
            }
            await send(event);
            state.sent[key] = { sentAt: new Date().toISOString(), strategyId: event.strategyId, eventType: event.eventType, symbol: event.symbol };
            const sentKeys = Object.keys(state.sent);
            if (sentKeys.length > 2000) {
                for (const oldKey of sentKeys.slice(0, sentKeys.length - 2000)) delete state.sent[oldKey];
            }
            offset += recordLength;
            state.offset = offset;
            await writeState(statePath, state);
            sentCount += 1;
        }
        state.offset = offset;
        if (lines.length === 0 && state.offset === 0 && !contents) return { sent: 0, skipped: 0, pending: false, offset: 0 };
        await writeState(statePath, state);
        return { sent: sentCount, skipped: skippedCount, pending: offset < contents.length, offset };
    } finally {
        if (release) await release();
    }
}
