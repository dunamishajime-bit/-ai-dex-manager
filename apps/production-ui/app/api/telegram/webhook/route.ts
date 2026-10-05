import { NextRequest, NextResponse } from "next/server";
import { buildTelegramMessage, sendTelegramMessage } from "@/lib/telegram-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TelegramUpdate = {
  update_id?: number;
  message?: {
    message_id?: number;
    text?: string;
    chat?: {
      id?: number | string;
      type?: string;
      title?: string;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    from?: {
      id?: number | string;
      username?: string;
      first_name?: string;
      last_name?: string;
      is_bot?: boolean;
    };
  };
};

type TelegramMessage = NonNullable<TelegramUpdate["message"]>;

function displayName(user?: TelegramMessage["from"], chat?: TelegramMessage["chat"]) {
  if (user?.username) return `@${user.username}`;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (chat?.title) return chat.title;
  return "unknown";
}

function isSecretValid(request: NextRequest) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  if (!expected) return true;
  const incoming = request.headers.get("x-telegram-bot-api-secret-token") || "";
  return incoming === expected;
}

function buildReplyText(text: string) {
  const normalized = text.trim();
  if (!normalized) return "Message received.";
  if (normalized === "/start" || normalized === "/help") {
    return "Dis-DEXManager Telegram desk is online. Your message was received.";
  }
  if (normalized === "/id") {
    return "This bot is used for notifications and message intake.";
  }
  if (normalized === "/ping") {
    return "pong";
  }
  return "Message received. Forwarded to the admin channel.";
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "telegram-webhook",
  });
}

export async function POST(request: NextRequest) {
  if (!isSecretValid(request)) {
    console.log("[telegram-webhook] forbidden: secret mismatch");
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    console.log("[telegram-webhook] invalid json");
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  const text = (message?.text || "").trim();

  console.log(
    `[telegram-webhook] incoming update_id=${String(update.update_id || "")} chat_id=${String(chatId || "")} text=${text}`,
  );

  if (!chatId || !text) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const replyText = buildReplyText(text);
  const replyResult = await sendTelegramMessage(replyText, String(chatId));
  console.log(
    `[telegram-webhook] reply success=${String(replyResult.success)} error=${replyResult.error || ""}`,
  );

  const sender = displayName(message?.from, message?.chat);
  const adminForward = buildTelegramMessage("Telegram Intake", [
    `Sender: ${sender}`,
    `chat_id: ${String(chatId)}`,
    `Text: ${text}`,
    replyResult.success ? "reply: sent" : `reply_error: ${replyResult.error || "unknown"}`,
  ]);

  try {
    const forwardResult = await sendTelegramMessage(adminForward);
    console.log(
      `[telegram-webhook] forward success=${String(forwardResult.success)} error=${forwardResult.error || ""}`,
    );
  } catch (error) {
    console.log(`[telegram-webhook] forward exception=${String(error)}`);
  }

  return NextResponse.json({ ok: true, replySent: replyResult.success });
}
