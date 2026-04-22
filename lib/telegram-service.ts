type TelegramSendResult = {
  success: boolean;
  simulated: boolean;
  error?: string;
};

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export function isTelegramConfigured() {
  return Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID);
}

export function buildTelegramMessage(title: string, lines: string[]) {
  return [title, ...lines].filter(Boolean).join("\n");
}

export async function sendTelegramMessage(message: string, chatId?: string): Promise<TelegramSendResult> {
  if (!TELEGRAM_BOT_TOKEN || !(chatId || TELEGRAM_CHAT_ID)) {
    console.warn("[Telegram] Skipped because TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing");
    return { success: true, simulated: true };
  }

  const targetChatId = chatId || TELEGRAM_CHAT_ID;
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: targetChatId,
      text: message,
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { success: false, simulated: false, error: text || `telegram_http_${response.status}` };
  }

  return { success: true, simulated: false };
}
