import { config as dotenvConfig } from "dotenv";
import dns from "dns";
import fs from "fs";
import path from "path";

dotenvConfig({ path: ".env.local" });
dns.setDefaultResultOrder("ipv4first");

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const adminChatId = process.env.TELEGRAM_CHAT_ID || "";
const openAiApiKey = process.env.OPENAI_API_KEY || "";
const model = process.env.OPENAI_TELEGRAM_MODEL || "gpt-5.4-nano-2026-03-17";
const allowAllChats = process.env.TELEGRAM_ALLOW_ALL_CHATS === "1";
const pollTimeoutSeconds = Number(process.env.TELEGRAM_POLL_TIMEOUT_SECONDS || 10);
const pollDelayMs = 5000;
const maxPollDelayMs = 60000;
const maxTelegramMessageLength = 3800;
const offsetFile = path.join(process.cwd(), "data", "telegram-offset.json");
const binanceApiBase = process.env.BINANCE_PUBLIC_API_BASE || "https://api.binance.com";
const realtimeSymbols = [
  "ETH",
  "SOL",
  "AVAX",
  "PENGU",
  "DOGE",
  "INJ",
  "UNI",
  "TWT",
  "BNB",
  "LINK",
  "XRP",
  "NEAR",
  "BCH",
];

if (!token) {
  console.error("[telegram-poller] TELEGRAM_BOT_TOKEN is missing");
  process.exit(1);
}

const BUILTIN_TRADE_CONTEXT = `
## Current production trade context

The production strategy should be treated as the latest V7 production logic, even if some internal strategy identifiers include older or newer suffixes.

Core production behavior:
- Single-position style. The system normally holds one active trading asset or USDT.
- V7 remains the base decision engine. GPT judgement is only an assistant/gate around V7 decisions and does not place orders directly.
- Telegram chat itself must never execute a trade. It can explain the logic, risks, and likely decision path.

Current important production rules:
- PENGU and DOGE have special logic and should not be judged only by the generic score.
- PENGU has profit-protection trailing: activation around +12%, retrace around 5.5%.
- Trend positions have broader profit-protection trailing: activation around +18%, retrace around 12%.
- PENGU and DOGE can be prioritized when their momentum/score remains strong, especially to prevent weak rotations into SOL/ETH.
- PENGU big-move / strong-hold judgement is intended to avoid exiting too early during a clear breakout/momentum run.
- DOGE uses the adopted doge_eff018 style improvement.
- INJ uses big-move loose / no-HHHL baseline style exception logic for major uptrends.
- ETH weak-exit candidate selected previously was around 7% / -0.5%.
- SOL has score penalty around -8 and weak-market protection; SOL should not blindly outrank stronger PENGU/DOGE just because it is in a broad category.
- UNI and TWT are cash-only rescue candidates. They are not normal trading targets outside USDT waiting periods.
- TWT has priority only inside the cash-only rescue context.
- Weak-market block exists for ETH/INJ/SOL to reduce damage during weak phases.

Known latest full-period production backtest reference before the AI market judgement layer:
- End Equity: 3,102,997.29
- MaxDD: -36.37%
- PF: 2.927
- Trades: 116
- ETH: +350,372.65
- SOL: +53,175.25
- INJ: -4,350.89
- PENGU: +1,638,434.65
- DOGE: +468,795.58
- TWT: +319,524.38

How to answer trade questions:
- If the user asks about PENGU targets, explain that the exact target is not a fixed take-profit in the current logic. The system mainly uses trend strength, score/momentum, and profit-protection trailing. For PENGU, a strong run should generally be held until the special trailing/weakening conditions trigger, rather than switching early to weaker SOL/ETH.
- If the user asks which coin should be prioritized, compare score, momentum, current holding strength, special symbol rules, and historical production contribution. Do not say there is not enough information when the built-in context answers the question directionally.
- If real-time values are needed, say the live 12H panel/API should be checked, but still answer from the known production rules.
- Always answer in clear Japanese.
`;

const SAFE_CONTEXT_FILES = [
  {
    file: "backups/LATEST_PRODUCTION_LOGIC_20260425_V7_PENGU_SWITCH_GUARD_WEAK_EXIT.md",
    title: "最新本番ロジックのバックアップ要約",
    keywords: ["v7", "ロジック", "pengu", "doge", "inj", "sol", "eth", "uni", "twt", "バックアップ", "復元"],
    maxChars: 5000,
  },
  {
    file: "config/reclaimHybridStrategy.ts",
    title: "戦略設定",
    keywords: ["score", "スコア", "優先", "候補", "戦略", "トレード", "通貨", "ローテーション"],
    maxChars: 4200,
  },
  {
    file: "lib/server/live-hybrid-autotrade.ts",
    title: "ライブ自動売買の判定処理",
    keywords: ["手動", "判定", "発注", "注文", "api", "エラー", "自動", "ライブ", "telegram", "通知"],
    maxChars: 4200,
  },
  {
    file: "components/features/autotrade/LiveDecisionPanel.tsx",
    title: "12H判定表示パネル",
    keywords: ["表示", "画面", "hp", "ダッシュボード", "12h", "判定理由"],
    maxChars: 3200,
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

async function telegramApi(method, payload = undefined, timeoutMs = 30000) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: payload ? "POST" : "GET",
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
        signal,
      });

      const json = await response.json().catch(() => ({}));
      if (!response.ok || json.ok === false) {
        throw new Error(json.description || `telegram_${method}_failed`);
      }
      return json.result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  throw lastError;
}

function splitTelegramText(text) {
  const value = String(text || "").trim();
  if (!value) return ["確認しましたが、返信本文を生成できませんでした。"];

  const chunks = [];
  let rest = value;
  while (rest.length > maxTelegramMessageLength) {
    const slice = rest.slice(0, maxTelegramMessageLength);
    const splitAt = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf("。"), slice.lastIndexOf("、"));
    const cut = splitAt > 1200 ? splitAt + 1 : maxTelegramMessageLength;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function sendMessage(chatId, text) {
  for (const chunk of splitTelegramText(text)) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
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

function readFileSnippet(relativeFile, maxChars) {
  try {
    const absolutePath = path.join(process.cwd(), relativeFile);
    const raw = fs.readFileSync(absolutePath, "utf8");
    return raw.slice(0, maxChars);
  } catch {
    return "";
  }
}

function resolveRequestedSymbols(userText) {
  const upper = String(userText || "").toUpperCase();
  const matched = realtimeSymbols.filter((symbol) => upper.includes(symbol));
  if (matched.length > 0) return matched.slice(0, 8);
  return realtimeSymbols.slice(0, 8);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percent(value) {
  if (!Number.isFinite(value)) return "n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatNumber(value, digits = 6) {
  if (!Number.isFinite(value)) return "n/a";
  if (Math.abs(value) >= 1000) return value.toFixed(2);
  if (Math.abs(value) >= 1) return value.toFixed(4);
  return value.toFixed(digits);
}

function analyzeKlines(rawKlines) {
  const klines = Array.isArray(rawKlines)
    ? rawKlines.map((row) => ({
      openTime: toNumber(row[0]),
      open: toNumber(row[1]),
      high: toNumber(row[2]),
      low: toNumber(row[3]),
      close: toNumber(row[4]),
      volume: toNumber(row[5]),
      closeTime: toNumber(row[6]),
    })).filter((row) => row.close > 0)
    : [];

  if (klines.length < 30) return null;

  const closes = klines.map((row) => row.close);
  const highs = klines.map((row) => row.high);
  const lows = klines.map((row) => row.low);
  const volumes = klines.map((row) => row.volume);
  const last = klines[klines.length - 1];
  const previous = klines[klines.length - 2];
  const sma7 = average(closes.slice(-7));
  const sma25 = average(closes.slice(-25));
  const sma99 = klines.length >= 99 ? average(closes.slice(-99)) : average(closes);
  const mom20 = closes.length > 20 && closes[closes.length - 21] > 0
    ? ((last.close / closes[closes.length - 21]) - 1) * 100
    : 0;
  const previousHigh = Math.max(...highs.slice(-49, -1));
  const highDistance = previousHigh > 0 ? ((last.close / previousHigh) - 1) * 100 : 0;
  const volumeNow = last.volume;
  const volumeAvg20 = average(volumes.slice(-21, -1));
  const volumeRatio = volumeAvg20 > 0 ? volumeNow / volumeAvg20 : 0;
  const lowNow = Math.min(...lows.slice(-6));
  const lowPrev = Math.min(...lows.slice(-12, -6));
  const highNow = Math.max(...highs.slice(-6));
  const highPrev = Math.max(...highs.slice(-12, -6));
  const hhhl = highNow > highPrev && lowNow > lowPrev;
  const maStackUp = last.close > sma25 && sma7 > sma25 && sma25 >= sma99;
  const candleChange = previous?.close > 0 ? ((last.close / previous.close) - 1) * 100 : 0;

  return {
    lastClose: last.close,
    closeTime: last.closeTime,
    sma7,
    sma25,
    sma99,
    mom20,
    previousHigh,
    highDistance,
    volumeRatio,
    hhhl,
    maStackUp,
    candleChange,
  };
}

async function fetchJson(url, timeoutMs = 12000) {
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  const response = await fetch(url, { signal });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    const message = json?.msg || json?.message || `http_${response.status}`;
    throw new Error(message);
  }
  return json;
}

async function fetchSymbolMarketSnapshot(symbol) {
  const pair = `${symbol}USDT`;
  const [ticker, klines15m, klines1h] = await Promise.all([
    fetchJson(`${binanceApiBase}/api/v3/ticker/24hr?symbol=${pair}`),
    fetchJson(`${binanceApiBase}/api/v3/klines?symbol=${pair}&interval=15m&limit=120`),
    fetchJson(`${binanceApiBase}/api/v3/klines?symbol=${pair}&interval=1h&limit=120`),
  ]);

  return {
    symbol,
    pair,
    lastPrice: toNumber(ticker?.lastPrice),
    priceChange24h: toNumber(ticker?.priceChangePercent),
    quoteVolume24h: toNumber(ticker?.quoteVolume),
    fifteenMinutes: analyzeKlines(klines15m),
    oneHour: analyzeKlines(klines1h),
  };
}

function renderMarketSnapshot(snapshot) {
  const m15 = snapshot.fifteenMinutes;
  const h1 = snapshot.oneHour;
  const lines = [
    `### ${snapshot.pair}`,
    `price=${formatNumber(snapshot.lastPrice)} 24h=${percent(snapshot.priceChange24h)} quoteVolume24h=${formatNumber(snapshot.quoteVolume24h, 2)}`,
  ];

  if (m15) {
    lines.push(
      `15m: close=${formatNumber(m15.lastClose)} mom20=${percent(m15.mom20)} candle=${percent(m15.candleChange)} volRatio=${m15.volumeRatio.toFixed(2)} highDistance=${percent(m15.highDistance)} maStackUp=${m15.maStackUp} hhhl=${m15.hhhl}`,
    );
    lines.push(
      `15m MA: sma7=${formatNumber(m15.sma7)} sma25=${formatNumber(m15.sma25)} sma99=${formatNumber(m15.sma99)} previousHigh48=${formatNumber(m15.previousHigh)}`,
    );
  }

  if (h1) {
    lines.push(
      `1h: close=${formatNumber(h1.lastClose)} mom20=${percent(h1.mom20)} candle=${percent(h1.candleChange)} volRatio=${h1.volumeRatio.toFixed(2)} highDistance=${percent(h1.highDistance)} maStackUp=${h1.maStackUp} hhhl=${h1.hhhl}`,
    );
    lines.push(
      `1h MA: sma7=${formatNumber(h1.sma7)} sma25=${formatNumber(h1.sma25)} sma99=${formatNumber(h1.sma99)} previousHigh48=${formatNumber(h1.previousHigh)}`,
    );
  }

  return lines.join("\n");
}

async function buildRealtimeMarketContext(userText) {
  const symbols = resolveRequestedSymbols(userText);
  const results = await Promise.allSettled(symbols.map((symbol) => fetchSymbolMarketSnapshot(symbol)));
  const rendered = results.map((result, index) => {
    const symbol = symbols[index];
    if (result.status === "fulfilled") return renderMarketSnapshot(result.value);
    return `### ${symbol}USDT\nrealtime_error=${result.reason instanceof Error ? result.reason.message : String(result.reason)}`;
  });

  return [
    "## Realtime Binance market snapshot",
    "Fetched at reply time from Binance public API. Use this for current-market questions.",
    "15m is quick breakout/entry timing. 1h is trend confirmation. highDistance > 0 means price is above the previous 48-candle high.",
    ...rendered,
  ].join("\n\n");
}

function buildProjectContext(userText) {
  const normalized = normalizeText(userText);
  const selected = SAFE_CONTEXT_FILES.filter((entry) =>
    entry.keywords.some((keyword) => normalized.includes(keyword.toLowerCase())),
  );

  const contexts = (selected.length > 0 ? selected : SAFE_CONTEXT_FILES.slice(0, 2)).slice(0, 3);
  const fileContext = contexts
    .map((entry) => {
      const snippet = readFileSnippet(entry.file, entry.maxChars);
      return snippet
        ? `## ${entry.title}\nFILE: ${entry.file}\n${snippet}`
        : `## ${entry.title}\nFILE: ${entry.file}\n読み込み不可`;
    })
    .join("\n\n");

  return `${BUILTIN_TRADE_CONTEXT}\n\n${fileContext}`;
}

function buildSystemPrompt() {
  return [
    "あなたは Professional DisManager / Dis-DEX Manager のTelegram内GPTアシスタントです。",
    "必ず日本語で、短く明確に答えてください。",
    "ユーザーは本番売買ロジック、12H判定、HP表示、Telegram通知、デプロイ状況を確認します。",
    "リアルタイム相場の質問では、添付されるRealtime Binance market snapshotを最優先で使い、15分足は短期タイミング、1時間足はトレンド確認として説明してください。",
    "通貨名が質問に含まれる場合は、その通貨の最新価格、24h変化、15分mom20、1時間mom20、出来高比率、直近高値突破状況を使って判断してください。",
    "通貨名が含まれない場合は、取得済みのトレード対象通貨を比較し、今強い候補と注意点を簡潔に答えてください。",
    "事実と推測を分けてください。ローカル文脈や提示されたコードから分かることだけを断定してください。",
    "秘密情報、APIキー、パスワード、秘密鍵、トークンの中身は絶対に表示しないでください。",
    "Telegramチャットから直接売買を実行できるとは言わないでください。売買は既存の自動売買・手動判定API側の管理対象です。",
    "投資助言として断定せず、ロジック上の判断・リスク・確認点として説明してください。",
    "回答は原則2〜6文。必要な時だけ箇条書きにしてください。",
  ].join("\n");
}

async function generateAssistantReply(userText) {
  if (!openAiApiKey) {
    return "OPENAI_API_KEY が未設定のため、Telegram上のGPT返信はまだ使えません。サーバーの環境変数を設定すれば、このBotから日本語で会話できます。";
  }

  const contextText = buildProjectContext(userText);
  const realtimeContextText = await buildRealtimeMarketContext(userText).catch((error) =>
    `## Realtime Binance market snapshot\nrealtime_error=${error instanceof Error ? error.message : String(error)}`,
  );
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: 900,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        {
          role: "user",
          content: [
            "以下はDis-DEX Managerの安全な参照情報です。必要な範囲だけ使って回答してください。",
            contextText,
            "",
            realtimeContextText,
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
    : "確認しましたが、有効な返信を生成できませんでした。もう一度、質問を少し短くして送ってください。";
}

function statusText() {
  return [
    "Telegram GPTチャット状態",
    `Bot: 稼働中`,
    `GPT: ${openAiApiKey ? "利用可能" : "OPENAI_API_KEY 未設定"}`,
    `Model: ${model}`,
    `管理者チャット: ${adminChatId ? "設定済み" : "未設定"}`,
    `外部チャット返信: ${allowAllChats ? "許可" : "管理者のみ"}`,
  ].join("\n");
}

function helpText() {
  return [
    "Telegram GPTチャットの使い方",
    "/start: 開始メッセージ",
    "/help: 使い方",
    "/status: BotとGPT設定の状態確認",
    "/ping: 疎通確認",
    "",
    "通常メッセージを送ると、Dis-DEX Managerの本番ロジックや画面、通知、エラー確認について日本語で回答します。",
    "安全のため、APIキー・パスワード・秘密鍵の中身は回答しません。",
  ].join("\n");
}

async function handleCommand(chatId, text) {
  const command = text.split(/\s+/)[0].toLowerCase();
  if (command === "/start") {
    await sendMessage(chatId, [
      "Dis-DEX ManagerのTelegram GPTチャットを起動しました。",
      "このチャットに質問を送ると、現在のロジック・HP表示・通知・注文周りの確認を日本語でサポートします。",
      "使い方は /help、状態確認は /status です。",
    ].join("\n"));
    return true;
  }
  if (command === "/help") {
    await sendMessage(chatId, helpText());
    return true;
  }
  if (command === "/status") {
    await sendMessage(chatId, statusText());
    return true;
  }
  if (command === "/ping") {
    await sendMessage(chatId, "pong。Telegram Botは応答できています。");
    return true;
  }
  return false;
}

async function handleUpdate(update) {
  const message = update?.message;
  const chatId = message?.chat?.id;
  const text = String(message?.text || "").trim();
  if (!chatId || !text) return;

  const isAdminChat = !adminChatId || String(adminChatId) === String(chatId);
  if (!isAdminChat && !allowAllChats) {
    const forwardText = [
      "Telegram GPT chat request",
      `Sender: ${displayName(message)}`,
      `chat_id: ${String(chatId)}`,
      `Text: ${text}`,
    ].join("\n");

    try {
      await sendMessage(adminChatId, forwardText);
      console.log(`[telegram-poller] forwarded non-admin chat_id=${String(chatId)}`);
    } catch (error) {
      console.error("[telegram-poller] admin forward failed", error);
    }

    await sendMessage(chatId, "このBotのGPT返信は管理者チャットのみ有効です。メッセージは管理者へ転送しました。");
    return;
  }

  if (text.startsWith("/") && await handleCommand(chatId, text)) {
    console.log(`[telegram-poller] command chat_id=${String(chatId)} command=${text}`);
    return;
  }

  try {
    await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" }, 10000).catch(() => undefined);
    const reply = await generateAssistantReply(text);
    await sendMessage(chatId, reply);
    console.log(`[telegram-poller] replied chat_id=${String(chatId)} text=${text.slice(0, 120)}`);
  } catch (error) {
    console.error("[telegram-poller] reply failed", error);
    await sendMessage(chatId, "GPT返信の生成中にエラーが出ました。少し置いてからもう一度送ってください。");
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
  let consecutiveErrors = 0;
  await clearWebhook();

  while (true) {
    try {
      const updates = await telegramApi("getUpdates", {
        offset,
        timeout: pollTimeoutSeconds,
        allowed_updates: ["message"],
      }, (pollTimeoutSeconds + 20) * 1000);
      consecutiveErrors = 0;

      for (const update of updates) {
        const nextOffset = Number(update.update_id || 0) + 1;
        if (nextOffset > offset) {
          offset = nextOffset;
          writeOffset(offset);
        }
        await handleUpdate(update);
      }
    } catch (error) {
      consecutiveErrors += 1;
      const delayMs = Math.min(maxPollDelayMs, pollDelayMs * (2 ** Math.min(consecutiveErrors - 1, 4)));
      console.error("[telegram-poller] polling failed", {
        at: new Date().toISOString(),
        attempt: consecutiveErrors,
        retryInMs: delayMs,
        message: error instanceof Error ? error.message : String(error),
        code: error?.cause?.code || error?.code,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

pollLoop().catch((error) => {
  console.error("[telegram-poller] fatal", error);
  process.exit(1);
});
