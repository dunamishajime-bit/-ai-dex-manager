import { config as dotenvConfig } from "dotenv";
import fs from "fs";
import path from "path";

dotenvConfig({ path: ".env.local" });

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const adminChatId = process.env.TELEGRAM_CHAT_ID || "";
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const model = process.env.OPENAI_TELEGRAM_MODEL || "gpt-5.4-nano-2026-03-17";
const pollTimeoutSeconds = 25;
const pollDelayMs = 1500;
const offsetFile = path.join(process.cwd(), "data", "telegram-offset.json");

if (!token) {
  console.error("[telegram-poller] TELEGRAM_BOT_TOKEN is missing");
  process.exit(1);
}

const PROJECT_CONTEXTS = [
  {
    file: "app/page.tsx",
    title: "ホーム",
    keywords: ["ホーム", "home", "トップ", "判定", "入れ替え", "時間", "カウントダウン"],
  },
  {
    file: "app/positions/page.tsx",
    title: "ダッシュボード",
    keywords: ["ポジション", "取得単価", "現在値", "損益", "dashboard", "position", "markprice", "entryprice"],
  },
  {
    file: "app/settings/page.tsx",
    title: "設定",
    keywords: ["設定", "メール", "2段階", "attack", "balance", "モード", "strategy"],
  },
  {
    file: "app/wallets/page.tsx",
    title: "運用ウォレット",
    keywords: ["ウォレット", "wallet", "アドレス", "作成", "接続"],
  },
  {
    file: "app/withdraw/page.tsx",
    title: "出金申請",
    keywords: ["出金", "withdraw", "申請"],
  },
  {
    file: "app/admin/page.tsx",
    title: "管理者ページ",
    keywords: ["管理者", "admin", "ai改善", "通知", "問い合わせ"],
  },
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch (error) {
    console.error("[telegram-poller] failed to write json", error);
  }
}

function readOffset() {
  const parsed = readJson(offsetFile, { offset: 0 });
  return Number(parsed.offset || 0);
}

function writeOffset(offset) {
  writeJson(offsetFile, { offset });
}

async function telegramApi(method, payload = undefined) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.description || `telegram_${method}_failed`);
  }
  return json.result;
}

async function sendMessage(chatId, text) {
  return telegramApi("sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

function displayName(message) {
  const user = message?.from;
  const chat = message?.chat;
  if (user?.username) return `@${user.username}`;
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (chat?.title) return chat.title;
  return "unknown";
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function readFileSnippet(relativeFile, maxChars = 2600) {
  try {
    const absolutePath = path.join(process.cwd(), relativeFile);
    const raw = fs.readFileSync(absolutePath, "utf8");
    return raw.slice(0, maxChars);
  } catch {
    return "";
  }
}

function buildProjectContext(userText) {
  const normalized = normalizeText(userText);
  const selected = PROJECT_CONTEXTS.filter((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );

  const contexts = (selected.length > 0 ? selected : PROJECT_CONTEXTS.slice(0, 3)).slice(0, 3);
  return contexts
    .map((entry) => {
      const snippet = readFileSnippet(entry.file);
      return snippet
        ? `## ${entry.title}\nFILE: ${entry.file}\n${snippet}`
        : `## ${entry.title}\nFILE: ${entry.file}\n(読み込み失敗)`;
    })
    .join("\n\n");
}

async function generateAssistantReply(userText) {
  if (!openAiApiKey) {
    return "OpenAI の設定が未完了のため、今は回答できません。";
  }

  const contextText = buildProjectContext(userText);
  const systemPrompt = [
    "あなたは Dis-DEXManager のサポート bot です。",
    "返答は必ず日本語にしてください。",
    "推測で断定せず、与えられた現在のコード断片だけを根拠に答えてください。",
    "現在の HP 実装や表示の質問には、コードから確認できることを優先して説明してください。",
    "不具合の可能性が高い場合は、原因候補を短く具体的に述べてください。",
    "トレードロジックの詳細は公開しすぎないでください。",
    "答えは 2〜5 文程度で簡潔にしてください。",
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            "以下は現在の Dis-DEXManager の実装断片です。",
            contextText,
            "",
            `ユーザーの質問: ${userText}`,
          ].join("\n"),
        },
      ],
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json?.error?.message || "openai_chat_failed");
  }

  const content = json?.choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim()
    ? content.trim()
    : "確認しましたが、今回は有効な回答を生成できませんでした。";
}

async function handleUpdate(update) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();
  if (!chatId || !text) return;

  if (text.startsWith("/start")) {
    await sendMessage(chatId, "こんにちは。Dis-DEXManager の現在仕様を確認しながら、画面や設定について日本語で案内します。");
    return;
  }

  if (adminChatId && String(adminChatId) !== String(chatId)) {
    const forwardText = [
      "Telegram Intake",
      `Sender: ${displayName(message)}`,
      `chat_id: ${String(chatId)}`,
      `Text: ${text}`,
    ].join("\n");

    try {
      await sendMessage(adminChatId, forwardText);
      console.log(`[telegram-poller] forwarded chat_id=${String(chatId)} text=${text}`);
    } catch (error) {
      console.error("[telegram-poller] admin forward failed", error);
    }
  }

  try {
    const reply = await generateAssistantReply(text);
    await sendMessage(chatId, reply);
    console.log(`[telegram-poller] replied chat_id=${String(chatId)} text=${text}`);
  } catch (error) {
    console.error("[telegram-poller] reply failed", error);
    await sendMessage(chatId, "確認中にエラーが出ました。少し置いてからもう一度送ってください。");
  }
}

async function clearWebhook() {
  try {
    await telegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("[telegram-poller] webhook deleted");
  } catch (error) {
    console.error("[telegram-poller] deleteWebhook failed", error);
  }
}

async function pollLoop() {
  let offset = readOffset();
  await clearWebhook();

  while (true) {
    try {
      const updates = await telegramApi("getUpdates", {
        offset,
        timeout: pollTimeoutSeconds,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        const nextOffset = Number(update.update_id || 0) + 1;
        if (nextOffset > offset) {
          offset = nextOffset;
          writeOffset(offset);
        }
        await handleUpdate(update);
      }
    } catch (error) {
      console.error("[telegram-poller] polling failed", error);
      await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
    }
  }
}

pollLoop().catch((error) => {
  console.error("[telegram-poller] fatal", error);
  process.exit(1);
});
