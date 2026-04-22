import { config as dotenvConfig } from "dotenv";

dotenvConfig({ path: ".env.local" });

const token = process.env.TELEGRAM_BOT_TOKEN || "";
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || "";

if (!token) {
  console.error("TELEGRAM_BOT_TOKEN is missing in .env.local");
  process.exit(1);
}

if (!appUrl) {
  console.error("NEXT_PUBLIC_APP_URL is missing in .env.local");
  process.exit(1);
}

const webhookUrl = `${appUrl}/api/telegram/webhook`;
const payload = {
  url: webhookUrl,
  ...(secret ? { secret_token: secret } : {}),
};

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify(payload),
});

const result = await response.json().catch(() => ({}));

console.log(JSON.stringify(result, null, 2));

if (!response.ok || result.ok === false) {
  process.exit(1);
}
