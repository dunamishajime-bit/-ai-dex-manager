import assert from "node:assert/strict";
import test from "node:test";
import {
  redisApprovalCompareAndSwap,
  type RedisApprovalCasClient,
} from "../lib/server/deploy-approval-redis-cas";

type Row = { id: string; storeRevision?: string; status: string };

class FakeRedis implements RedisApprovalCasClient {
  values = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.values.get(key);
    return raw == null ? null : JSON.parse(raw) as T;
  }

  async eval<T>(_script: string, keys: string[], args: unknown[]): Promise<T> {
    const [recordKey, latestKey] = keys;
    const [expectedExists, expectedRevision, nextJson, ttlSeconds, touchLatest, latestId] =
      args.map(String);
    assert.ok(Number(ttlSeconds) > 0);
    const raw = this.values.get(recordKey);
    if (expectedExists === "0") {
      if (raw != null) return 0 as T;
    } else {
      if (raw == null) return 0 as T;
      let current: Row;
      try { current = JSON.parse(raw) as Row; } catch { return -2 as T; }
      if ((current.storeRevision || "") !== expectedRevision) return 0 as T;
    }
    this.values.set(recordKey, nextJson);
    if (touchLatest === "1") this.values.set(latestKey, JSON.stringify(latestId));
    return 1 as T;
  }
}

test("redis approval CAS permits exactly one claimant for one revision", async () => {
  const redis = new FakeRedis();
  const key = "approval:one";
  const latest = "approval:latest";
  const current: Row = { id: "one", status: "APPROVED", storeRevision: "r1" };
  redis.values.set(key, JSON.stringify(current));

  const results = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      redisApprovalCompareAndSwap(redis, {
        recordKey: key,
        latestKey: latest,
        current,
        next: {
          ...current,
          status: "REDEEMED",
          storeRevision: "next-" + index,
        },
        touchLatest: false,
      }),
    ),
  );

  assert.equal(results.filter((result) => result === "SWAPPED").length, 1);
  assert.equal(results.filter((result) => result === "CONFLICT").length, 19);
  const saved = await redis.get<Row>(key);
  assert.equal(saved?.status, "REDEEMED");
});

test("redis approval CAS creates only when key is absent and can update latest atomically", async () => {
  const redis = new FakeRedis();
  const key = "approval:new";
  const latest = "approval:latest";
  const next: Row = { id: "new", status: "PENDING", storeRevision: "r1" };
  assert.equal(await redisApprovalCompareAndSwap(redis, {
    recordKey: key,
    latestKey: latest,
    current: null,
    next,
    touchLatest: true,
  }), "SWAPPED");
  assert.equal(await redisApprovalCompareAndSwap(redis, {
    recordKey: key,
    latestKey: latest,
    current: null,
    next: { ...next, storeRevision: "r2" },
    touchLatest: true,
  }), "CONFLICT");
  assert.equal(await redis.get<string>(latest), "new");
});

test("redis approval CAS fails closed on corrupt stored JSON", async () => {
  const redis = new FakeRedis();
  redis.values.set("approval:bad", "{bad");
  const result = await redisApprovalCompareAndSwap(redis, {
    recordKey: "approval:bad",
    latestKey: "approval:latest",
    current: { id: "bad", status: "APPROVED", storeRevision: "r1" },
    next: { id: "bad", status: "REDEEMED", storeRevision: "r2" },
    touchLatest: false,
  });
  assert.equal(result, "INVALID_STORED_VALUE");
});
