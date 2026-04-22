"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SECURITY_SETTINGS, normalizeSecuritySettings, type SecurityMethod, type SecuritySettings } from "@/lib/security-utils";
import {
  deleteUser as deleteUserFromStore,
  getAllUsers,
  getCurrentUser,
  saveUser,
  setCurrentUser,
  verifyUserCredential,
  type UserProfile,
} from "@/lib/user-store";

export interface AuthUser {
  id: string;
  email: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: number;
  lastLogin: number;
  isTotpEnabled?: boolean;
  hasPasskey?: boolean;
  isApproved: boolean;
  totpSecret?: string;
  securitySettings?: SecuritySettings;
  webAuthnCredentials?: any[];
  ownerWalletAddress?: string;
  ownerWalletConnectedAt?: number;
  vaultAccountId?: string;
  vaultStatus?: "draft" | "pending_deployment" | "active" | "paused" | "migration_ready";
}

type LoginResult = {
  success: boolean;
  error?: string;
  requiresSecondFactor?: boolean;
};

type VerifyResult = {
  success: boolean;
  error?: string;
  remainingFactors?: SecurityMethod[];
};

interface AuthContextType {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  loginWithPasskey: (email: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, nickname: string) => Promise<{ success: boolean; error?: string; code?: string }>;
  verify2FA: (code: string) => Promise<VerifyResult>;
  verifyTOTP: (token: string) => Promise<VerifyResult>;
  verifyPasskeySecondFactor: () => Promise<VerifyResult>;
  resendEmailCode: () => Promise<{ success: boolean; error?: string }>;
  resetSecondFactorFlow: () => void;
  logout: () => void;
  updateAvatar: (avatarUrl: string) => void;
  updateNickname: (nickname: string) => void;
  pending2FAEmail: string | null;
  pending2FACode: string | null;
  pendingSecondFactors: SecurityMethod[];
  completedSecondFactors: SecurityMethod[];
  registeredUsers: AuthUser[];
  refreshUsers: () => Promise<void>;
  deleteUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
  approveUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_KEY = "disdex_auth_user";
const AUTH_COOKIE = "disdex_auth";
const ACTIVITY_KEY = "jdex_last_activity";
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;

function setAuthCookie() {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_COOKIE}=1; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
}

function clearAuthCookie() {
  if (typeof document === "undefined") return;
  const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${AUTH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function toAuthUser(user: any): AuthUser {
  return {
    id: user.id,
    email: user.email,
    nickname: user.displayName || user.nickname || "",
    avatarUrl: null,
    createdAt: Number(user.createdAt || Date.now()),
    lastLogin: Number(user.lastLogin || Date.now()),
    isTotpEnabled: Boolean(user.isTotpEnabled),
    hasPasskey: Array.isArray(user.webAuthnCredentials) && user.webAuthnCredentials.length > 0,
    isApproved: Boolean(user.isApproved),
    totpSecret: user.totpSecret,
    securitySettings: normalizeSecuritySettings(user.securitySettings),
    webAuthnCredentials: user.webAuthnCredentials || [],
    ownerWalletAddress: user.ownerWalletAddress,
    ownerWalletConnectedAt: user.ownerWalletConnectedAt ? Number(user.ownerWalletConnectedAt) : undefined,
    vaultAccountId: user.vaultAccountId,
    vaultStatus: user.vaultStatus,
  };
}

function getSecurityUpdatedAt(user: any) {
  return Number(user?.securitySettings?.updatedAt || 0);
}

function hasProvisionedPasskey(user: any) {
  return Array.isArray(user?.webAuthnCredentials) && user.webAuthnCredentials.length > 0;
}

function mergeUserByRecency(serverUser: any, localUser?: any) {
  if (!localUser) return serverUser;
  const serverLogin = Number(serverUser?.lastLogin || 0);
  const localLogin = Number(localUser?.lastLogin || 0);
  const serverSecurityUpdatedAt = getSecurityUpdatedAt(serverUser);
  const localSecurityUpdatedAt = getSecurityUpdatedAt(localUser);
  const preferLocalSecurity = localSecurityUpdatedAt > serverSecurityUpdatedAt;

  const merged = localLogin > serverLogin
    ? {
        ...serverUser,
        displayName: localUser.displayName || serverUser.displayName,
        lastLogin: localUser.lastLogin,
      }
    : {
        ...serverUser,
      };

  const mergedSecuritySettings = preferLocalSecurity
    ? normalizeSecuritySettings(localUser.securitySettings || serverUser.securitySettings)
    : normalizeSecuritySettings(serverUser.securitySettings || localUser.securitySettings);

  return {
    ...merged,
    securitySettings: mergedSecuritySettings,
    isTotpEnabled: preferLocalSecurity
      ? Boolean(localUser.isTotpEnabled)
      : Boolean(serverUser.isTotpEnabled),
    totpSecret: preferLocalSecurity
      ? localUser.totpSecret || serverUser.totpSecret
      : serverUser.totpSecret || localUser.totpSecret,
    webAuthnCredentials: preferLocalSecurity
      ? localUser.webAuthnCredentials || serverUser.webAuthnCredentials
      : serverUser.webAuthnCredentials || localUser.webAuthnCredentials,
    hasPasskey: preferLocalSecurity
      ? hasProvisionedPasskey(localUser) || hasProvisionedPasskey(serverUser)
      : hasProvisionedPasskey(serverUser) || hasProvisionedPasskey(localUser),
    ownerWalletAddress: serverUser.ownerWalletAddress || localUser.ownerWalletAddress,
    ownerWalletConnectedAt: Number(serverUser.ownerWalletConnectedAt || localUser.ownerWalletConnectedAt || 0) || undefined,
    vaultAccountId: serverUser.vaultAccountId || localUser.vaultAccountId,
    vaultStatus: serverUser.vaultStatus || localUser.vaultStatus,
  };
}

function uniqueMethods(methods: SecurityMethod[]) {
  return Array.from(new Set(methods));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pending2FAEmail, setPending2FAEmail] = useState<string | null>(null);
  const [pending2FACode, setPending2FACode] = useState<string | null>(null);
  const [pending2FAUser, setPending2FAUser] = useState<UserProfile | null>(null);
  const [pendingSecondFactors, setPendingSecondFactors] = useState<SecurityMethod[]>([]);
  const [completedSecondFactors, setCompletedSecondFactors] = useState<SecurityMethod[]>([]);
  const [registeredUsers, setRegisteredUsers] = useState<AuthUser[]>([]);
  const router = useRouter();

  const resetSecondFactorFlow = useCallback(() => {
    setPending2FAEmail(null);
    setPending2FACode(null);
    setPending2FAUser(null);
    setPendingSecondFactors([]);
    setCompletedSecondFactors([]);
  }, []);

  const finalizeLogin = useCallback((rawUser: UserProfile | any) => {
    const normalized = {
      ...rawUser,
      securitySettings: normalizeSecuritySettings(rawUser.securitySettings),
      lastLogin: Date.now(),
    };
    saveUser(normalized);
    setCurrentUser(normalized);
    localStorage.setItem(AUTH_KEY, normalized.id);
    setAuthCookie();
    setUser(toAuthUser(normalized));
  }, []);

  const pushProfileToServer = useCallback(async (rawUser: any) => {
    try {
      await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: rawUser.id,
          email: rawUser.email,
          displayName: rawUser.displayName,
          isTotpEnabled: rawUser.isTotpEnabled,
          totpSecret: rawUser.totpSecret,
          webAuthnCredentials: rawUser.webAuthnCredentials || [],
          securitySettings: normalizeSecuritySettings(rawUser.securitySettings),
          lastLogin: rawUser.lastLogin,
          ownerWalletAddress: rawUser.ownerWalletAddress,
          ownerWalletConnectedAt: rawUser.ownerWalletConnectedAt,
          vaultAccountId: rawUser.vaultAccountId,
          vaultStatus: rawUser.vaultStatus,
        }),
      });
    } catch {
      // ignore sync errors
    }
  }, []);

  const syncUsers = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/users", { cache: "no-store" });
      const json = await response.json();
      const serverUsers = json.success && Array.isArray(json.users) ? json.users : [];
      const localUsers = getAllUsers();
      const localById = new Map(localUsers.map((entry) => [entry.id, entry]));
      const merged = serverUsers.map((serverUser: any) => mergeUserByRecency(serverUser, localById.get(serverUser.id)));

      localStorage.setItem("jdex_users", JSON.stringify(merged));
      setRegisteredUsers(merged.map(toAuthUser));

      const current = getCurrentUser();
      if (current) {
        const synced = merged.find((entry: any) => entry.id === current.id) ?? null;
        if (synced) {
          setCurrentUser(synced);
          setUser(toAuthUser(synced));
        }
      }

      for (const serverUser of merged) {
        const local = localById.get(serverUser.id);
        const localSecurityUpdatedAt = getSecurityUpdatedAt(local);
        const serverSecurityUpdatedAt = getSecurityUpdatedAt(serverUser);
        if (
          local &&
          Number(local.lastLogin || 0) > Number(serverUser.lastLogin || 0) &&
          localSecurityUpdatedAt <= serverSecurityUpdatedAt
        ) {
          await pushProfileToServer(local);
        }
      }
    } catch (error) {
      console.error("Failed to sync users:", error);
    }
  }, [pushProfileToServer]);

  const refreshUsers = useCallback(async () => {
    await syncUsers();
  }, [syncUsers]);

  const triggerLogout = useCallback(() => {
    setUser(null);
    resetSecondFactorFlow();
    setCurrentUser(null);
    localStorage.removeItem(AUTH_KEY);
    clearAuthCookie();
    router.replace("/login");
    window.setTimeout(() => {
      if (typeof window !== "undefined") {
        window.location.replace("/login");
      }
    }, 0);
  }, [resetSecondFactorFlow, router]);

  useEffect(() => {
    let alive = true;
    const currentUser = getCurrentUser();
    if (currentUser) {
      setAuthCookie();
      setUser(toAuthUser(currentUser));
    }
    if (alive) setIsLoading(false);

    void (async () => {
      try {
        await syncUsers();
        if (!alive) return;

        if (typeof window !== "undefined" && window.location.hostname === "localhost") {
          const latestCurrent = getCurrentUser();
          if (!latestCurrent) {
            const all = getAllUsers();
            const dev = all.find((entry) => entry.isApproved) || all[0];
            if (dev) {
              finalizeLogin(dev);
              return;
            }
          }
        }

        const syncedCurrentUser = getCurrentUser();
        if (syncedCurrentUser) {
          setUser(toAuthUser(syncedCurrentUser));
        }
      } catch (error) {
        console.error("Auth bootstrap sync failed:", error);
      }
    })();

    return () => {
      alive = false;
    };
  }, [finalizeLogin, syncUsers]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncCurrentUser = () => {
      const current = getCurrentUser();
      setUser(current ? toAuthUser(current) : null);
    };

    window.addEventListener("jdex-auth-changed", syncCurrentUser);
    window.addEventListener("storage", syncCurrentUser);

    return () => {
      window.removeEventListener("jdex-auth-changed", syncCurrentUser);
      window.removeEventListener("storage", syncCurrentUser);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !user) return;

    let timeoutId: number | null = null;

    const scheduleLogout = () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(() => {
        triggerLogout();
      }, INACTIVITY_LIMIT_MS);
    };

    const markActivity = () => {
      localStorage.setItem(ACTIVITY_KEY, String(Date.now()));
      scheduleLogout();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === ACTIVITY_KEY) {
        scheduleLogout();
      }
    };

    const events: Array<keyof WindowEventMap> = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];

    events.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener("storage", handleStorage);

    markActivity();

    return () => {
      events.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener("storage", handleStorage);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [triggerLogout, user]);

  const send2FACode = useCallback(async (email: string, code: string, type: "login" | "register") => {
    const response = await fetch("/api/auth/2fa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code, type }),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.success) {
      throw new Error(json?.error || "認証メールの送信に失敗しました。");
    }
  }, []);

  const issueEmailCodeForPendingUser = useCallback(async (targetUser: UserProfile, type: "login" | "register" = "login") => {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await send2FACode(targetUser.email, code, type);
    setPending2FACode(code);
    setPending2FAEmail(targetUser.email);
  }, [send2FACode]);

  const completeSecondFactor = useCallback(async (method: SecurityMethod): Promise<VerifyResult> => {
    if (!pending2FAUser) {
      return { success: false, error: "認証セッションが見つかりません。" };
    }

    const nextCompleted = uniqueMethods([...completedSecondFactors, method]);
    const remainingFactors = pendingSecondFactors.filter((entry) => !nextCompleted.includes(entry));

    setCompletedSecondFactors(nextCompleted);

    if (remainingFactors.length === 0) {
      finalizeLogin(pending2FAUser);
      await pushProfileToServer({ ...pending2FAUser, lastLogin: Date.now() });
      resetSecondFactorFlow();
      return { success: true, remainingFactors: [] };
    }

    return { success: true, remainingFactors };
  }, [completedSecondFactors, finalizeLogin, pending2FAUser, pendingSecondFactors, pushProfileToServer, resetSecondFactorFlow]);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    let matched: any = null;

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await response.json();
      if (json.success && json.user) {
        matched = { ...json.user, passwordHash: btoa(password) };
        saveUser(matched);
        localStorage.setItem(`jdex_pw_${matched.id}`, btoa(password));
      }
    } catch {
      // fallback below
    }

    if (!matched) {
      matched = verifyUserCredential(email, password);
    }

    if (!matched) {
      return { success: false, error: "メールアドレスまたはパスワードが正しくありません。" };
    }

    if (!matched.isApproved) {
      return { success: false, error: "承認待ちのアカウントです。管理者承認後にログインしてください。" };
    }

    const security = normalizeSecuritySettings(matched.securitySettings || DEFAULT_SECURITY_SETTINGS);
    if (!security.enabled) {
      finalizeLogin(matched);
      await pushProfileToServer({ ...matched, lastLogin: Date.now() });
      return { success: true };
    }

    const factors: SecurityMethod[] = [];
    if (security.methods.email && matched.email) {
      factors.push("email");
    }
    if (security.methods.totp && matched.isTotpEnabled && matched.totpSecret) {
      factors.push("totp");
    }
    if (security.methods.passkey && Array.isArray(matched.webAuthnCredentials) && matched.webAuthnCredentials.length > 0) {
      factors.push("passkey");
    }

    const requiredFactors = uniqueMethods(factors);
    if (requiredFactors.length === 0) {
      finalizeLogin(matched);
      await pushProfileToServer({ ...matched, lastLogin: Date.now() });
      return { success: true };
    }

    setPending2FAUser(matched);
    setPendingSecondFactors(requiredFactors);
    setCompletedSecondFactors([]);

    if (requiredFactors.includes("email")) {
      await issueEmailCodeForPendingUser(matched, "login");
    } else {
      setPending2FAEmail(null);
      setPending2FACode(null);
    }

    return { success: true, requiresSecondFactor: true };
  }, [finalizeLogin, issueEmailCodeForPendingUser, pushProfileToServer]);

  const verify2FA = useCallback(async (code: string): Promise<VerifyResult> => {
    if (!pending2FAUser || !pendingSecondFactors.includes("email")) {
      return { success: false, error: "メール認証セッションが見つかりません。" };
    }
    if (!pending2FACode) {
      return { success: false, error: "メール認証コードを再送してください。" };
    }
    if (code.trim() !== pending2FACode) {
      return { success: false, error: "メール認証コードが正しくありません。" };
    }

    setPending2FACode(null);
    return completeSecondFactor("email");
  }, [completeSecondFactor, pending2FACode, pending2FAUser, pendingSecondFactors]);

  const verifyTOTP = useCallback(async (token: string): Promise<VerifyResult> => {
    if (!pending2FAUser?.totpSecret || !pendingSecondFactors.includes("totp")) {
      return { success: false, error: "Google Authenticator の認証設定が見つかりません。" };
    }

    const response = await fetch("/api/settings/totp/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token.trim(), secret: pending2FAUser.totpSecret }),
    });
    const json = await response.json();
    if (!json.success || !json.isValid) {
      return { success: false, error: "Google Authenticator のコードが正しくありません。" };
    }

    return completeSecondFactor("totp");
  }, [completeSecondFactor, pending2FAUser, pendingSecondFactors]);

  const verifyPasskeySecondFactor = useCallback(async (): Promise<VerifyResult> => {
    if (!pending2FAUser || !pendingSecondFactors.includes("passkey")) {
      return { success: false, error: "端末認証セッションが見つかりません。" };
    }

    const credentials = pending2FAUser.webAuthnCredentials || [];
    if (!credentials.length) {
      return { success: false, error: "このアカウントでは端末認証が未登録です。" };
    }

    try {
      const optionsRes = await fetch("/api/auth/webauthn/generate-authentication-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials }),
      });
      const options = await optionsRes.json();
      if (options.error) {
        return { success: false, error: options.error };
      }

      const { startAuthentication } = await import("@simplewebauthn/browser");
      const authResp = await startAuthentication(options);
      const credential = credentials.find((entry: any) => entry.id === authResp.id);

      const verifyRes = await fetch("/api/auth/webauthn/verify-authentication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authenticationResponse: authResp,
          credential,
          userId: pending2FAUser.id,
          purpose: "login-2fa",
        }),
      });
      const result = await verifyRes.json();
      if (!result.verified) {
        return { success: false, error: result.error || "端末認証に失敗しました。" };
      }

      if (credential && result.newCounter !== undefined) {
        credential.counter = result.newCounter;
      }

      return completeSecondFactor("passkey");
    } catch (error: any) {
      return { success: false, error: error?.message || "端末認証に失敗しました。" };
    }
  }, [completeSecondFactor, pending2FAUser, pendingSecondFactors]);

  const resendEmailCode = useCallback(async () => {
    if (!pending2FAUser || !pendingSecondFactors.includes("email")) {
      return { success: false, error: "メール認証の再送対象が見つかりません。" };
    }

    try {
      await issueEmailCodeForPendingUser(pending2FAUser, "login");
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || "メール認証コードの再送に失敗しました。" };
    }
  }, [issueEmailCodeForPendingUser, pending2FAUser, pendingSecondFactors]);

  const loginWithPasskey = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const users = getAllUsers();
      const foundUser = users.find((entry) => entry.email.toLowerCase() === email.trim().toLowerCase());
      if (!foundUser || !foundUser.webAuthnCredentials?.length) {
        return { success: false, error: "このメールにはパスキーが登録されていません。" };
      }

      const optionsRes = await fetch("/api/auth/webauthn/generate-authentication-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: foundUser.webAuthnCredentials }),
      });
      const options = await optionsRes.json();
      if (options.error) {
        return { success: false, error: options.error };
      }

      const { startAuthentication } = await import("@simplewebauthn/browser");
      const authResp = await startAuthentication(options);
      const credential = foundUser.webAuthnCredentials.find((entry: any) => entry.id === authResp.id);

      const verifyRes = await fetch("/api/auth/webauthn/verify-authentication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authenticationResponse: authResp, credential, userId: foundUser.id }),
      });
      const result = await verifyRes.json();
      if (!result.verified) {
        return { success: false, error: "パスキー認証に失敗しました。" };
      }

      if (credential && result.newCounter !== undefined) {
        credential.counter = result.newCounter;
      }

      finalizeLogin(foundUser);
      await pushProfileToServer({ ...foundUser, lastLogin: Date.now() });
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error?.message || "パスキー認証に失敗しました。" };
    }
  }, [finalizeLogin, pushProfileToServer]);

  const register = useCallback(async (email: string, password: string, nickname: string) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, nickname, password }),
    });
    const json = await response.json();
    if (!json.success || !json.user) {
      return { success: false, error: json.error || "登録に失敗しました。" };
    }

    const userForLocal = {
      ...json.user,
      passwordHash: btoa(password),
      securitySettings: normalizeSecuritySettings(json.user.securitySettings),
    };
    saveUser(userForLocal);
    localStorage.setItem(`jdex_pw_${userForLocal.id}`, btoa(password));

    const security = normalizeSecuritySettings(userForLocal.securitySettings);
    if (!security.enabled) {
      finalizeLogin(userForLocal);
      await pushProfileToServer({ ...userForLocal, lastLogin: Date.now() });
      return { success: true };
    }

    const factors: SecurityMethod[] = [];
    if (security.methods.email) factors.push("email");
    if (security.methods.totp && userForLocal.isTotpEnabled && userForLocal.totpSecret) factors.push("totp");
    if (security.methods.passkey && userForLocal.webAuthnCredentials?.length) factors.push("passkey");

    setPending2FAUser(userForLocal);
    setPendingSecondFactors(uniqueMethods(factors));
    setCompletedSecondFactors([]);
    await issueEmailCodeForPendingUser(userForLocal, "register");
    return { success: true, code: "sent" };
  }, [finalizeLogin, issueEmailCodeForPendingUser, pushProfileToServer]);

  const logout = useCallback(() => {
    triggerLogout();
  }, [triggerLogout]);

  const updateAvatar = useCallback((avatarUrl: string) => {
    if (!user) return;
    setUser((prev) => (prev ? { ...prev, avatarUrl } : null));
  }, [user]);

  const updateNickname = useCallback((nickname: string) => {
    if (!user) return;
    const current = getCurrentUser();
    if (!current) return;
    const next = { ...current, displayName: nickname };
    saveUser(next);
    setCurrentUser(next);
    setUser((prev) => (prev ? { ...prev, nickname } : null));
    void pushProfileToServer(next);
  }, [pushProfileToServer, user]);

  const deleteUserAsync = useCallback(async (userId: string) => {
    try {
      deleteUserFromStore(userId);
      setRegisteredUsers((prev) => prev.filter((entry) => entry.id !== userId));
      await fetch("/api/auth/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await syncUsers();
      return { success: true };
    } catch {
      return { success: false, error: "アカウント削除に失敗しました。" };
    }
  }, [syncUsers]);

  const approveUserAsync = useCallback(async (userId: string) => {
    try {
      await fetch("/api/auth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      await syncUsers();
      return { success: true };
    } catch {
      return { success: false, error: "アカウント承認に失敗しました。" };
    }
  }, [syncUsers]);

  const value = useMemo<AuthContextType>(() => ({
    user,
    isAuthenticated: Boolean(user),
    isLoading,
    login,
    loginWithPasskey,
    register,
    verify2FA,
    verifyTOTP,
    verifyPasskeySecondFactor,
    resendEmailCode,
    resetSecondFactorFlow,
    logout,
    updateAvatar,
    updateNickname,
    pending2FAEmail,
    pending2FACode,
    pendingSecondFactors,
    completedSecondFactors,
    registeredUsers,
    refreshUsers,
    deleteUser: deleteUserAsync,
    approveUser: approveUserAsync,
  }), [
    approveUserAsync,
    completedSecondFactors,
    deleteUserAsync,
    isLoading,
    login,
    loginWithPasskey,
    logout,
    pending2FACode,
    pending2FAEmail,
    pendingSecondFactors,
    refreshUsers,
    register,
    registeredUsers,
    resendEmailCode,
    resetSecondFactorFlow,
    updateAvatar,
    updateNickname,
    user,
    verify2FA,
    verifyPasskeySecondFactor,
    verifyTOTP,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
