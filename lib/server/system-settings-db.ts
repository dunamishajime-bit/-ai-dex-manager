import fs from "fs";
import path from "path";

export type SystemSettings = {
  registrationEnabled: boolean;
  adminTwoFactorEnabled: boolean;
  updatedAt: number;
};

const SETTINGS_PATH = path.join(process.cwd(), "data", "system-settings.json");

const DEFAULT_SETTINGS: SystemSettings = {
  registrationEnabled: true,
  adminTwoFactorEnabled: false,
  updatedAt: Date.now(),
};

function ensureFile() {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(SETTINGS_PATH)) {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
  }
}

export async function loadSystemSettings(): Promise<SystemSettings> {
  try {
    ensureFile();
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<SystemSettings>;
    return {
      registrationEnabled: parsed.registrationEnabled ?? true,
      adminTwoFactorEnabled: parsed.adminTwoFactorEnabled ?? false,
      updatedAt: parsed.updatedAt ?? Date.now(),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSystemSettings(next: Partial<SystemSettings>): Promise<SystemSettings> {
  const current = await loadSystemSettings();
  const merged: SystemSettings = {
    ...current,
    ...next,
    updatedAt: Date.now(),
  };
  ensureFile();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(merged, null, 2), "utf8");
  return merged;
}
