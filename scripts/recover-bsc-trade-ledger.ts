import fs from "fs";
import path from "path";

type TransferDirection = "sent" | "received";

type NetTransfer = {
  direction: TransferDirection;
  amount: number;
  usdValue: number;
  tokenAddress: string;
  symbol: string;
};

type TradeEntry = {
  id: string;
  executedAt: string;
  walletId: string;
  walletAddress: string;
  chainId: number;
  txHash: string;
  provider?: string;
  action: "BUY" | "SELL";
  sourceSymbol: string;
  destSymbol: string;
  sourceAmount: number;
  destAmount: number;
  sourceUsdValue: number;
  destUsdValue: number;
  reason: string;
};

const CHAIN_ID = 56;
const DEFAULT_WALLET_ADDRESS = "0x1337e80294f808b2Fd9b71f6E43869cAdf1cf0E5";
const DEFAULT_WALLET_ID = "opw_1775367469416_g3qupvq";
const ADDRESS_ARG = process.argv[2] || DEFAULT_WALLET_ADDRESS;
const WALLET_ID_ARG = process.argv[3] || DEFAULT_WALLET_ID;
const OUTPUT_PATH = path.join(process.cwd(), "data", "trade-ledger.json");

const TOKEN_META: Record<string, { symbol: string; stable?: boolean }> = {
  "0x55d398326f99059ff775485246999027b3197955": { symbol: "USDT", stable: true },
  "0x2170ed0880ac9a755fd29b2688956bd959f933f8": { symbol: "ETH" },
  "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c": { symbol: "BNB" },
  "0x000ae314e2a2172a039b26378814c252734f556a": { symbol: "ASTER" },
};

function round6(value: number) {
  return Number(value.toFixed(6));
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeSymbol(tokenAddress: string, rawLabel: string) {
  const known = TOKEN_META[tokenAddress.toLowerCase()];
  if (known?.symbol) return known.symbol;
  const cleaned = rawLabel.replace(/\.\.\./g, "").replace(/[^A-Za-z0-9_-]/g, "").toUpperCase();
  if (cleaned) return cleaned;
  return tokenAddress.slice(0, 6).toUpperCase();
}

async function fetchHtml(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.text();
}

function extractUniqueTxHashes(html: string) {
  const matches = [...html.matchAll(/\/tx\/(0x[a-fA-F0-9]{64})/g)];
  const hashes = matches.map((match) => match[1].toLowerCase());
  return [...new Set(hashes)];
}

function extractSummaryTransfers(html: string, walletAddress: string): NetTransfer[] {
  const lowerWallet = walletAddress.toLowerCase();
  const summaryHtml = decodeHtml(html);

  const pattern = new RegExp(
    `data-highlight-target="${lowerWallet}"[\\s\\S]{0,1800}?<span class="fw-medium">\\s*(sent|received)\\s*<\\/span>\\s*([0-9.]+)[\\s\\S]{0,1400}?(?:value='[^']*\\$([0-9.,]+)'|<span class='text-muted me-1'>\\(\\$([0-9.,]+)\\)<\\/span>)[\\s\\S]{0,1200}?href='\\/token\\/(0x[a-fA-F0-9]{40})'[\\s\\S]{0,600}?<span class='text-muted'>\\s*\\((.*?)\\)<\\/span>`,
    "gi",
  );

  const transfers: NetTransfer[] = [];
  for (const match of summaryHtml.matchAll(pattern)) {
    const direction = match[1].toLowerCase() as TransferDirection;
    const amount = Number(match[2]);
    const usdValue = Number((match[3] || match[4] || "0").replace(/,/g, ""));
    const tokenAddress = match[5].toLowerCase();
    const symbol = normalizeSymbol(tokenAddress, stripHtml(match[6]));

    if (!Number.isFinite(amount) || amount <= 0) continue;

    transfers.push({
      direction,
      amount,
      usdValue: Number.isFinite(usdValue) ? usdValue : 0,
      tokenAddress,
      symbol,
    });
  }

  return transfers;
}

function buildTradeEntry(walletAddress: string, walletId: string, txHash: string, executedAt: string, transfers: NetTransfer[]): TradeEntry | null {
  const sent = transfers.find((item) => item.direction === "sent");
  const received = transfers.find((item) => item.direction === "received");
  if (!sent || !received) return null;

  const sentMeta = TOKEN_META[sent.tokenAddress];
  const receivedMeta = TOKEN_META[received.tokenAddress];
  const action: "BUY" | "SELL" = sentMeta?.stable ? "BUY" : "SELL";

  const sourceUsdValue = sent.usdValue > 0
    ? sent.usdValue
    : (sentMeta?.stable ? sent.amount : received.usdValue);
  const destUsdValue = received.usdValue > 0
    ? received.usdValue
    : (receivedMeta?.stable ? received.amount : sent.usdValue);

  return {
    id: `trd_recovered_${txHash.slice(2, 10)}`,
    executedAt,
    walletId,
    walletAddress,
    chainId: CHAIN_ID,
    txHash,
    provider: "bscscan-recovery",
    action,
    sourceSymbol: sent.symbol,
    destSymbol: received.symbol,
    sourceAmount: round6(sent.amount),
    destAmount: round6(received.amount),
    sourceUsdValue: round6(sourceUsdValue),
    destUsdValue: round6(destUsdValue),
    reason: "recovered:onchain-swap",
  };
}

async function main() {
  const walletAddress = ADDRESS_ARG;
  const walletId = WALLET_ID_ARG;
  const tokenTxHtml = await fetchHtml(`https://bscscan.com/tokentxns?a=${walletAddress}`);
  const txHashes = extractUniqueTxHashes(tokenTxHtml);

  const entries: TradeEntry[] = [];
  for (const txHash of txHashes) {
    const txHtml = await fetchHtml(`https://bscscan.com/tx/${txHash}`);
    if (!/BEP-20 Tokens Transferred/i.test(txHtml)) continue;

    const timestampMatch = txHtml.match(/id='showUtcLocalDate' data-timestamp='(\d+)'/i);
    if (!timestampMatch) continue;
    const executedAt = new Date(Number(timestampMatch[1]) * 1000).toISOString();

    const transfers = extractSummaryTransfers(txHtml, walletAddress);
    const entry = buildTradeEntry(walletAddress, walletId, txHash, executedAt, transfers);
    if (entry) entries.push(entry);
  }

  const uniqueEntries = [...new Map(entries.map((entry) => [entry.txHash, entry])).values()]
    .sort((a, b) => new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime());

  const payload = {
    entries: uniqueEntries,
    openPositions: {},
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8");

  console.log(JSON.stringify({
    ok: true,
    walletAddress,
    walletId,
    recoveredEntries: uniqueEntries.length,
    outputPath: OUTPUT_PATH,
    txHashes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
