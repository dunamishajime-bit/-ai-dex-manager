import assert from "node:assert/strict";
import test from "node:test";
import { kvGet, kvSet } from "../lib/kv";
import type { Universe } from "../lib/types/market";

test("dashboard seeds an empty universe without POSTing back to its public origin", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: URL; method: string }> = [];

  try {
    await kvSet("prices:v1", {
      "BTC@MAJOR": { usd: 100_000, jpy: 15_000_000, change24hPct: 1, updatedAt: 1_800_000_000_000, source: "test" },
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      requests.push({ url, method });

      if (url.hostname === "api.frankfurter.app") {
        return Response.json({ rates: { JPY: 150 } });
      }

      if (url.hostname === "api.coingecko.com") {
        const ids = url.searchParams.get("ids")?.split(",") ?? [];
        return Response.json(Object.fromEntries(ids.map((id) => [id, { usd: 100, usd_24h_change: 1 }])));
      }

      return Response.json({ data: [] });
    };

    const { GET } = await import("../app/api/market/dashboard/route");
    const response = await GET(new Request("https://manager.test/api/market/dashboard"));
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.dexTradableMajorsTop10.length, 12);
    const seeded = await kvGet<Universe>("universe:v1");
    assert.equal(seeded?.majorsTop10.length, 12, "the fallback universe must be written to the shared KV store");
    assert.equal(
      requests.some(({ url, method }) => method === "POST" && url.origin === "https://manager.test"),
      false,
      "a dashboard request must not call back through its public HTTPS origin to seed KV",
    );

    await kvSet("universe:v1", {
      majorsTop10: [],
      bnbTop15: [],
      polygonTop15: [],
      favoritesByUser: {
        alice: [{ symbol: "PENGU", name: "Pudgy Penguins", chain: "MAJOR", provider: "coincap", providerId: "pudgy-penguins" }],
      },
      updatedAt: 1_800_000_000_000,
    });
    const repairedResponse = await GET(new Request("https://manager.test/api/market/dashboard"));
    const repairedPayload = await repairedResponse.json();
    const afterRefresh = await kvGet<Universe>("universe:v1");
    assert.equal(repairedPayload.dexTradableMajorsTop10.length, 12, "an empty cached universe must be repaired from the local fallback");
    assert.equal(afterRefresh?.majorsTop10.length, 12);
    assert.equal(afterRefresh?.favoritesByUser.alice[0]?.symbol, "PENGU", "initializing the dashboard must preserve saved favorites");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
