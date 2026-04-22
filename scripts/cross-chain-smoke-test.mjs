const BASE_URL = process.env.CROSS_CHAIN_TEST_BASE_URL || "http://127.0.0.1:3000";

const TESTS = [
  {
    symbol: "RENDER.SOL",
    action: "BUY",
    amount: 0.12,
    price: 4.85,
    sourceToken: "BNB",
    destinationToken: "RENDER.SOL",
    testOutcome: "success",
    selectedReason: "Smoke test: selected cross-chain BUY",
    positionSize: "0.5x",
    tradeDecision: "Half-size Eligible",
    executionTarget: "render-cross-chain-target",
  },
  {
    symbol: "JTO.SOL",
    action: "BUY",
    amount: 0.9,
    price: 2.61,
    sourceToken: "ASTER",
    destinationToken: "JTO.SOL",
    testOutcome: "failed",
    selectedReason: "Smoke test: failed cross-chain BUY",
    positionSize: "0.5x",
    tradeDecision: "Half-size Eligible",
    executionTarget: "jto-cross-chain-target",
  },
  {
    symbol: "RENDER.SOL",
    action: "SELL",
    amount: 0.12,
    price: 5.01,
    sourceToken: "RENDER.SOL",
    destinationToken: "BNB",
    testOutcome: "success",
    selectedReason: "Smoke test: timed exit SELL",
    positionSize: "0.5x",
    tradeDecision: "Half-size Eligible",
    executionTarget: "render-cross-chain-target",
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

async function createOrder(test) {
  const payload = {
    idempotencyKey: makeId("smoke"),
    pair: `${test.sourceToken}/${test.destinationToken}`,
    action: test.action,
    amount: test.amount,
    price: test.price,
    routeType: "cross-chain",
    routeSource: "smoke-test",
    sourceToken: test.sourceToken,
    destinationToken: test.destinationToken,
    sourceChain: test.action === "BUY" ? "BNB" : "SOLANA",
    destinationChain: test.action === "BUY" ? "SOLANA" : "BNB",
    executionTarget: test.executionTarget,
    aggregatorTarget: test.executionTarget,
    positionSize: test.positionSize,
    tradeDecision: test.tradeDecision,
    selectedReason: test.selectedReason,
    symbol: test.symbol,
    autoTradeTarget: true,
    testMode: true,
    testOutcome: test.testOutcome,
  };

  const res = await fetch(`${BASE_URL}/api/trade/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `POST failed (${res.status})`);
  }
  return data;
}

async function waitForTerminal(executionId) {
  let latest = null;
  for (let i = 0; i < 16; i += 1) {
    await sleep(1250);
    const res = await fetch(`${BASE_URL}/api/trade/execute?executionId=${encodeURIComponent(executionId)}`);
    const data = await res.json();
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `GET failed (${res.status})`);
    }
    latest = data;
    if (["success", "failed", "cancelled"].includes(data.status)) {
      return latest;
    }
  }
  return latest;
}

async function main() {
  const positions = new Map();
  const results = [];

  for (const test of TESTS) {
    const created = await createOrder(test);
    const final = await waitForTerminal(created.executionId);
    const status = final?.status || created.status;
    const txHash = final?.txHash || null;
    const failureReason = final?.failureReason || null;
    let positionApplied = false;
    let exitManaged = false;

    if (status === "success") {
      if (test.action === "BUY") {
        const prev = positions.get(test.symbol) || { amount: 0, entryPrice: 0 };
        const nextAmount = prev.amount + test.amount;
        const nextEntryPrice = prev.amount > 0
          ? ((prev.entryPrice * prev.amount) + (test.price * test.amount)) / nextAmount
          : test.price;
        positions.set(test.symbol, { amount: nextAmount, entryPrice: nextEntryPrice });
        positionApplied = true;
        exitManaged = true;
      } else {
        const prev = positions.get(test.symbol);
        if (prev) {
          const remaining = Math.max(0, prev.amount - test.amount);
          if (remaining > 0) positions.set(test.symbol, { ...prev, amount: remaining });
          else positions.delete(test.symbol);
        }
        positionApplied = false;
        exitManaged = false;
      }
    }

    results.push({
      symbol: test.symbol,
      action: test.action,
      executionId: created.executionId,
      orderId: created.orderId,
      status,
      txHash,
      failureReason,
      positionApplied,
      exitManaged,
      positionSnapshot: positions.get(test.symbol) || null,
    });
  }

  const successCount = results.filter((item) => item.status === "success").length;
  const failedCount = results.filter((item) => item.status === "failed").length;
  const cancelledCount = results.filter((item) => item.status === "cancelled").length;

  console.log(JSON.stringify({
    baseUrl: BASE_URL,
    successCount,
    failedCount,
    cancelledCount,
    results,
    finalPositions: Object.fromEntries(positions.entries()),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
