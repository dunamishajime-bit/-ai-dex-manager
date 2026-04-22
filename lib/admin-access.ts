const ADMIN_UNLOCK_KEY = "jdex_admin_unlocked";
const ADMIN_UNLOCK_AT_KEY = "jdex_admin_unlocked_at";

export function isAdminUnlocked() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(ADMIN_UNLOCK_KEY) === "true";
  } catch {
    return false;
  }
}

export function unlockAdminAccess() {
  if (typeof window === "undefined") return;
  localStorage.setItem(ADMIN_UNLOCK_KEY, "true");
  localStorage.setItem(ADMIN_UNLOCK_AT_KEY, String(Date.now()));
}

export function lockAdminAccess() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(ADMIN_UNLOCK_KEY);
  localStorage.removeItem(ADMIN_UNLOCK_AT_KEY);
}

export function getAdminUnlockTimestamp() {
  if (typeof window === "undefined") return 0;
  try {
    return Number(localStorage.getItem(ADMIN_UNLOCK_AT_KEY) || 0);
  } catch {
    return 0;
  }
}
