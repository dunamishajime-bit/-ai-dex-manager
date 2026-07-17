import fs from "fs";
import path from "path";

import { AsterDexClient, loadAsterDexClientConfig } from "@/lib/server/asterdex/client";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function main() {
  loadEnvFile();
  const config = loadAsterDexClientConfig();
  if (!config) {
    throw new Error("ASTER config is incomplete.");
  }

  const client = new AsterDexClient(config);
  const [serverTime, price, balance] = await Promise.all([
    client.getServerTime(),
    client.getPrice(process.env.ASTER_MARKET_SYMBOL_PENGU || "PENGUUSDT"),
    client.getBalance(),
  ]);

  const usdt = Array.isArray(balance)
    ? balance.find((item: any) => String(item?.asset || "").toUpperCase() === "USDT") || null
    : null;

  console.log(JSON.stringify({
    ok: true,
    serverTime,
    price,
    usdt,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
  }, null, 2));
  process.exit(1);
});
