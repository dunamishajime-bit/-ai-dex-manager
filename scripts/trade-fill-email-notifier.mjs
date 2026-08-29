import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const DEFAULT_RECIPIENT = "dunamis.hajime@gmail.com";
const STATE_PATH = process.env.DISDEX_TRADE_FILL_NOTIFICATION_STATE_PATH || "/var/lib/disdex/shared/trade-fill-notification-state.json";
const LOCK_PATH = `${STATE_PATH}.lock`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function numberText(value, maximumFractionDigits = 12) {
    const number = finite(value);
    if (number === undefined) return "-";
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits }).format(number);
}

function jstText(value) {
    const date = new Date(value || Date.now());
    if (Number.isNaN(date.getTime())) return "-";
    return new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        dateStyle: "medium",
        timeStyle: "medium",
    }).format(date);
}

function text(value, fallback = "-") {
    const result = String(value ?? "").trim();
    return result || fallback;
}

function eventKey(event) {
    if (text(event.eventId, "")) return text(event.eventId, "");
    const material = [
        event.strategyId,
        event.eventType,
        event.symbol,
        event.orderId,
        event.clientOrderId,
        event.executedAt,
        event.filledPrice,
        event.filledQuantity,
    ].map((value) => text(value, "")).join("|");
    return `fill-${createHash("sha256").update(material).digest("hex")}`;
}

function metadataText(value) {
    if (!value || typeof value !== "object") return "-";
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return "-";
    }
}

function renderMessage(event) {
    if (text(event.eventType) === "STALE_REFERENCE_ALERT") {
        const metadata = event.metadata && typeof event.metadata === "object" ? event.metadata : {};
        const subject = `[DisDex データ取得失敗] V52 ${text(event.symbol)}`;
        const lines = [
            "V52の参照データ再取得に失敗しました。",
            "",
            `ロジック: ${text(event.strategyId, "V52")}`,
            `銘柄: ${text(event.symbol)}`,
            `検知時刻（JST）: ${jstText(metadata.detectedAt)}`,
            `5分後の再取得時刻（JST）: ${jstText(metadata.retryAttemptedAt)}`,
            `再取得結果: ${text(metadata.retryResult)}`,
            `最終データ時刻: ${text(metadata.lastSourceTimestampMs)}`,
            `最終データ経過時間: ${numberText(metadata.lastAgeMs, 0)} ms`,
            `失敗理由: ${text(metadata.lastError)}`,
            `参照データ状態: ${text(metadata.referenceDataStatus)}`,
            "",
            "この通知は同一stale事象につき1回だけ送信されます。",
        ];
        return { subject, text: lines.join("\n") };
    }
    const symbol = text(event.symbol);
    const baseAsset = text(event.baseAsset, symbol.replace(/USDT$|USD$|USDC$/i, "") || symbol);
    const quoteAsset = text(event.quoteAsset, "USDT");
    const filledPrice = finite(event.filledPrice);
    const filledQuantity = finite(event.filledQuantity);
    const quoteQuantity = finite(event.quoteQuantity) ?? (filledPrice !== undefined && filledQuantity !== undefined ? filledPrice * filledQuantity : undefined);
    const eventType = text(event.eventType);
    const positionSide = text(event.positionSide);
    const orderSide = text(event.orderSide || event.side);
    const strategyId = text(event.strategyId);
    const subject = `[DisDex 約定通知] ${strategyId} ${eventType} ${symbol} ${positionSide}`;
    const lines = [
        "DisDexの実約定を検知しました。",
        "",
        `ロジック: ${strategyId}`,
        `区分: ${eventType}（${eventType === "ENTRY_FILL" ? "新規" : eventType === "EXIT_FILL" ? "決済" : "約定"}）`,
        `通貨: ${baseAsset}/${quoteAsset}（symbol=${symbol}）`,
        `ポジション方向: ${positionSide}`,
        `注文方向: ${orderSide}`,
        `約定価格: ${numberText(filledPrice)} ${quoteAsset}`,
        `約定数量: ${numberText(filledQuantity)} ${baseAsset}`,
        `約定金額: ${numberText(quoteQuantity)} ${quoteAsset}`,
        `約定時刻（JST）: ${jstText(event.executedAt)}`,
        `取引所: ${text(event.exchange, "Aster")}`,
        `orderId: ${text(event.orderId)}`,
        `clientOrderId: ${text(event.clientOrderId)}`,
        `通知ID: ${eventKey(event)}`,
        `判定理由: ${text(event.reason)}`,
        event.fee !== undefined ? `手数料: ${numberText(event.fee)} ${text(event.feeAsset, quoteAsset)}` : null,
        event.pnl !== undefined ? `実現損益: ${numberText(event.pnl)} ${quoteAsset}` : null,
        "",
        "補足:",
        metadataText(event.metadata),
    ].filter((line) => line !== null);
    return { subject, text: lines.join("\n") };
}

async function sendMail(event) {
    const recipient = process.env.DISDEX_TRADE_FILL_NOTIFICATION_EMAIL || process.env.TRADE_FILL_NOTIFICATION_EMAIL || DEFAULT_RECIPIENT;
    const { subject, text: body } = renderMessage(event);
    const gmailUser = String(process.env.GMAIL_USER || "").trim();
    const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
    if (gmailUser && gmailPassword) {
        const nodemailer = (await import("nodemailer")).default;
        const transport = nodemailer.createTransport({ service: "gmail", auth: { user: gmailUser, pass: gmailPassword } });
        await transport.sendMail({ from: gmailUser, to: recipient, subject, text: body });
        return "gmail";
    }

    const sendgridKey = String(process.env.SENDGRID_API_KEY || "").trim();
    if (sendgridKey) {
        const sendgrid = await import("@sendgrid/mail");
        const client = sendgrid.default || sendgrid;
        client.setApiKey(sendgridKey);
        await client.send({
            to: recipient,
            from: process.env.SENDGRID_FROM_EMAIL || recipient,
            subject,
            text: body,
        });
        return "sendgrid";
    }
    throw new Error("TRADE_FILL_NOTIFICATION_PROVIDER_NOT_CONFIGURED");
}

async function readState() {
    try {
        const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
        return parsed && typeof parsed === "object" ? parsed : { schemaVersion: 1, sent: {} };
    } catch (error) {
        if (error?.code === "ENOENT") return { schemaVersion: 1, sent: {} };
        throw error;
    }
}

async function writeState(state) {
    const sent = state.sent && typeof state.sent === "object" ? state.sent : {};
    const keys = Object.keys(sent).slice(-2000);
    const compact = { schemaVersion: 1, updatedAt: new Date().toISOString(), sent: Object.fromEntries(keys.map((key) => [key, sent[key]])) };
    const temporary = `${STATE_PATH}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(compact, null, 2)}\n`, { mode: 0o640 });
    await rename(temporary, STATE_PATH);
}

async function withStateLock(callback) {
    await mkdir(dirname(STATE_PATH), { recursive: true, mode: 0o750 });
    let handle;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
            handle = await open(LOCK_PATH, "wx", 0o640);
            break;
        } catch (error) {
            if (error?.code !== "EEXIST") throw error;
            try {
                const lockStat = await stat(LOCK_PATH);
                if (Date.now() - lockStat.mtimeMs > 120000) await unlink(LOCK_PATH);
            } catch (statError) {
                if (statError?.code !== "ENOENT") throw statError;
            }
            await sleep(150);
        }
    }
    if (!handle) throw new Error("TRADE_FILL_NOTIFICATION_LOCK_BUSY");
    try {
        return await callback();
    } finally {
        await handle.close();
        await unlink(LOCK_PATH).catch(() => undefined);
    }
}

async function notify(event) {
    const key = eventKey(event);
    return withStateLock(async () => {
        const state = await readState();
        state.sent = state.sent && typeof state.sent === "object" ? state.sent : {};
        if (state.sent[key]) {
            console.error(`[trade-fill-notifier] duplicate skipped: ${key}`);
            return;
        }
        let provider;
        let lastError;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
            try {
                provider = await sendMail(event);
                break;
            } catch (error) {
                lastError = error;
                if (attempt < 3) await sleep(attempt * 500);
            }
        }
        if (!provider) throw lastError || new Error("TRADE_FILL_NOTIFICATION_SEND_FAILED");
        state.sent[key] = { sentAt: new Date().toISOString(), provider, strategyId: text(event.strategyId), eventType: text(event.eventType), symbol: text(event.symbol) };
        await writeState(state);
        console.error(`[trade-fill-notifier] sent: ${key}`);
    });
}

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try {
    const event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!event || typeof event !== "object") throw new Error("TRADE_FILL_NOTIFICATION_EVENT_INVALID");
    await notify(event);
} catch (error) {
    console.error(`[trade-fill-notifier] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
}
