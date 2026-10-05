"use client";

export interface StrategyCandleSample {
    symbol: string;
    ts: number;
    price: number;
}

const DB_NAME = "jdex-strategy-candles";
const DB_VERSION = 1;
const STORE_NAME = "candles";

type CandleRecord = StrategyCandleSample & {
    id: string;
};

function hasIndexedDb() {
    return typeof indexedDB !== "undefined";
}

function toRecord(sample: StrategyCandleSample): CandleRecord {
    return {
        ...sample,
        id: `${sample.symbol}:${sample.ts}`,
    };
}

function openDatabase(): Promise<IDBDatabase | null> {
    if (!hasIndexedDb()) return Promise.resolve(null);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            const store = db.objectStoreNames.contains(STORE_NAME)
                ? request.transaction?.objectStore(STORE_NAME)
                : db.createObjectStore(STORE_NAME, { keyPath: "id" });

            if (!store) return;
            if (!store.indexNames.contains("symbol")) {
                store.createIndex("symbol", "symbol", { unique: false });
            }
            if (!store.indexNames.contains("ts")) {
                store.createIndex("ts", "ts", { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function loadStrategyCandleSamples(symbols: string[], sinceTs: number): Promise<Record<string, StrategyCandleSample[]>> {
    const db = await openDatabase();
    const out: Record<string, StrategyCandleSample[]> = {};
    symbols.forEach((symbol) => {
        out[symbol] = [];
    });

    if (!db || symbols.length === 0) {
        return out;
    }

    await Promise.all(symbols.map((symbol) => new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("symbol");
        const request = index.openCursor(IDBKeyRange.only(symbol));

        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }

            const value = cursor.value as CandleRecord;
            if (value.ts >= sinceTs && Number.isFinite(value.price) && value.price > 0) {
                out[symbol].push({
                    symbol: value.symbol,
                    ts: value.ts,
                    price: value.price,
                });
            }
            cursor.continue();
        };

        request.onerror = () => reject(request.error);
    })));

    Object.keys(out).forEach((symbol) => {
        out[symbol] = out[symbol]
            .sort((left, right) => left.ts - right.ts)
            .filter((sample, index, arr) => index === 0 || arr[index - 1].ts !== sample.ts);
    });

    db.close();
    return out;
}

export async function persistStrategyCandleSamples(samples: StrategyCandleSample[]): Promise<void> {
    if (!samples.length) return;
    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        samples.forEach((sample) => {
            if (!Number.isFinite(sample.ts) || !Number.isFinite(sample.price) || sample.price <= 0) return;
            store.put(toRecord(sample));
        });

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
    });

    db.close();
}

export async function pruneStrategyCandleSamples(beforeTs: number): Promise<void> {
    const db = await openDatabase();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const index = store.index("ts");
        const request = index.openCursor(IDBKeyRange.upperBound(beforeTs - 1));

        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            cursor.delete();
            cursor.continue();
        };

        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
    });

    db.close();
}
