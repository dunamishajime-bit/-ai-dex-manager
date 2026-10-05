import dns from "node:dns";

type TelegramSendResult = {
  success: boolean;
  simulated: boolean;
  error?: string;
};

dns.setDefaultResultOrder("ipv4first");

const TELEGRAM_SEND_TIMEOUT_MS = 20_000;
const TELEGRAM_SEND_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTelegramConfig(chatId?: string) {
  return {
    token: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: chatId || process.env.TELEGRAM_CHAT_ID || "",
  };
}

export function isTelegramConfigured() {
  const config = getTelegramConfig();
  return Boolean(config.token && config.chatId);
}

export function buildTelegramMessage(title: string, lines: string[]) {
  return [title, ...lines].filter(Boolean).join("\n");
}

export async function sendTelegramMessage(message: string, chatId?: string): Promise<TelegramSendResult> {
  const config = getTelegramConfig(chatId);
  if (!config.token || !config.chatId) {
    console.warn("[Telegram] Skipped because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
    return { success: false, simulated: true, error: "missing_telegram_config" };
  }

  let lastError = "telegram_fetch_failed";
  for (let attempt = 1; attempt <= TELEGRAM_SEND_RETRIES; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`https://api.telegram.org/bot${config.token}/sendMessage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: message,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_SEND_TIMEOUT_MS),
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : "telegram_fetch_failed";
      if (attempt < TELEGRAM_SEND_RETRIES) await sleep(1000 * attempt);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      lastError = text || `telegram_http_${response.status}`;
      if (response.status >= 500 && attempt < TELEGRAM_SEND_RETRIES) {
        await sleep(1000 * attempt);
        continue;
      }
      return { success: false, simulated: false, error: lastError };
    }

    return { success: true, simulated: false };
  }

  return { success: false, simulated: false, error: lastError };
}
