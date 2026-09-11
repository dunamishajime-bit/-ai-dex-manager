import fs from "fs/promises";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "portfolio-snapshots.json");

export type PortfolioSnapshot = {
  walletId: string;
  capturedAt: string;
  portfolioUsd: number;
};

type PortfolioSnapshotDb = {
  snapshots: PortfolioSnapshot[];
};

function emptyDb(): PortfolioSnapshotDb {
  return { snapshots: [] };
}

async function loadDb(): Promise<PortfolioSnapshotDb> {
  try {
    const raw = await fs.readFile(DB_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<PortfolioSnapshotDb>;
    return {
      snapshots: Array.isArray(parsed.snapshots) ? parsed.snapshots : [],
    };
  } catch {
    return emptyDb();
  }
}

async function saveDb(db: PortfolioSnapshotDb) {
  await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function minuteKey(iso: string) {
  return iso.slice(0, 16);
}

export async function appendPortfolioSnapshot(snapshot: PortfolioSnapshot) {
  const db = await loadDb();
  const nextSnapshots = db.snapshots.filter((item) => {
    return !(item.walletId === snapshot.walletId && minuteKey(item.capturedAt) === minuteKey(snapshot.capturedAt));
  });
  nextSnapshots.push(snapshot);
  nextSnapshots.sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));

  const trimmed = nextSnapshots.slice(-5000);
  await saveDb({ snapshots: trimmed });
}

export async function loadPortfolioSnapshots(walletId: string) {
  const db = await loadDb();
  return db.snapshots
    .filter((snapshot) => snapshot.walletId === walletId)
    .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));
}
