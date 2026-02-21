"use client";

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
    getAllUsers,
    saveUser,
    verifyUserCredential,
    registerUser,
    getCurrentUser,
    setCurrentUser,
    deleteUser as deleteUserFromStore,
    UserProfile
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
}

interface AuthContextType {
    user: AuthUser | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<{ success: boolean; error?: string; requires2FA?: boolean; requiresTOTP?: boolean; code?: string }>;
    loginWithPasskey: (email: string) => Promise<{ success: boolean; error?: string }>;
    register: (email: string, password: string, nickname: string) => Promise<{ success: boolean; error?: string; code?: string }>;
    verify2FA: (code: string) => Promise<{ success: boolean; error?: string }>;
    verifyTOTP: (token: string) => Promise<{ success: boolean; error?: string }>;
    logout: () => void;
    updateAvatar: (avatarUrl: string) => void;
    updateNickname: (nickname: string) => void;
    pending2FAEmail: string | null;
    pending2FACode: string | null;
    requiresTOTP: boolean;
    registeredUsers: AuthUser[];
    refreshUsers: () => Promise<void>;
    deleteUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
    approveUser: (userId: string) => Promise<{ success: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AUTH_KEY = "disdex_auth_user";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<AuthUser | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [pending2FAEmail, setPending2FAEmail] = useState<string | null>(null);
    const [pending2FACode, setPending2FACode] = useState<string | null>(null);
    const [pending2FAUserId, setPending2FAUserId] = useState<string | null>(null);
    const [pendingUser, setPendingUser] = useState<any | null>(null);
    const [requiresTOTP, setRequiresTOTP] = useState(false);
    const [pendingTotpUser, setPendingTotpUser] = useState<any | null>(null);
    const [registeredUsers, setRegisteredUsers] = useState<AuthUser[]>([]);

    // Unified sync logic
    const syncUsers = useCallback(async () => {
        try {
            // 1. Get current server users
            const res = await fetch("/api/auth/users");
            const serverData = await res.json();

            // 2. Load local users
            const localData = localStorage.getItem("jdex_users");
            const localUsers = localData ? JSON.parse(localData) : [];
            const merged = serverData.success && serverData.users ? [...serverData.users] : [];

            // 3. Identify local-only users to push to server
            const localOnly = localUsers.filter((lu: any) => !merged.find(su => su.id === lu.id));

            if (localOnly.length > 0) {
                console.log(`Syncing ${localOnly.length} local-only users to server...`);
                await fetch("/api/auth/users", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ users: localOnly })
                });
            }

            // 4. Update local storage with full merged set
            // Merge servers users with local storage to preserve fields not sent by server (like passwordHash)
            const mergedServerUsers = serverData.success && serverData.users ? [...serverData.users] : [];
            const finalMerged = mergedServerUsers.map((su: any) => {
                const lu = localUsers.find((x: any) => x.id === su.id);
                return lu ? { ...lu, ...su } : su;
            });

            localUsers.forEach((lu: any) => {
                if (!finalMerged.find((su: any) => su.id === lu.id)) {
                    finalMerged.push(lu);
                }
            });

            localStorage.setItem("jdex_users", JSON.stringify(finalMerged));

            // Update state for reactive UI - use finalMerged
            setRegisteredUsers(finalMerged.map(u => ({
                id: u.id,
                email: u.email,
                nickname: u.displayName,
                avatarUrl: null,
                createdAt: u.createdAt,
                lastLogin: u.lastLogin,
                isTotpEnabled: u.isTotpEnabled,
                hasPasskey: u.webAuthnCredentials && u.webAuthnCredentials.length > 0,
                isApproved: u.isApproved
            })));
        } catch (e) {
            console.error("Failed to sync users with server:", e);
        }
    }, []);

    const refreshUsers = useCallback(async () => {
        await syncUsers();
    }, [syncUsers]);

    // Restore session from localStorage (cookie-like persistence)
    useEffect(() => {
        syncUsers();

        // Phase 11: Testing Efficiency - Localhost Auto-login
        if (typeof window !== "undefined" && window.location.hostname === "localhost") {
            const current = getCurrentUser();
            if (!current) {
                const all = getAllUsers();
                const devUser = all.find(u => u.isApproved) || all[0];
                if (devUser) {
                    setCurrentUser(devUser);
                    setUser({
                        id: devUser.id,
                        email: devUser.email,
                        nickname: devUser.displayName || (devUser as any).nickname,
                        avatarUrl: null,
                        createdAt: devUser.createdAt,
                        lastLogin: devUser.lastLogin,
                        isApproved: devUser.isApproved
                    });
                }
            }
        }

        const currentUser = getCurrentUser();
        if (currentUser) {
            setUser({
                id: currentUser.id,
                email: currentUser.email,
                nickname: currentUser.displayName,
                avatarUrl: null,
                createdAt: currentUser.createdAt,
                lastLogin: currentUser.lastLogin,
                isApproved: currentUser.isApproved
            });
        }
        setIsLoading(false);
    }, [syncUsers]);

    const send2FACode = async (email: string, code: string, type: "login" | "register") => {
        try {
            const res = await fetch("/api/auth/2fa", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, code, type })
            });
            const data = await res.json();

            if (!data.success) {
                console.error("Server reported email error:", data.error);
                alert(`メール送信エラー: ${data.error}`);
                return;
            }

            if (data.simulated) {
                // If API key is missing/simulated, show alert as fallback
                alert(`【メール送信シミュレーション】\nTo: ${email}\nCode: ${code}`);
            }
        } catch (e) {
            console.error("Email send failed:", e);
            alert("メール送信に失敗しました。コンソールを確認してください。");
        }
    };

    const login = useCallback(async (email: string, password: string): Promise<{ success: boolean; error?: string; requires2FA?: boolean; requiresTOTP?: boolean; code?: string }> => {
        let user: any = null;

        // 1. Try Server-Side Authentication first (works across all browsers)
        try {
            const res = await fetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.success && data.user) {
                const serverUser = data.user;
                user = {
                    ...serverUser,
                    passwordHash: btoa(password)
                };
                // Cache locally for offline use
                saveUser(user);
                localStorage.setItem(`jdex_pw_${user.id}`, btoa(password));
            }
        } catch (e) {
            console.warn("Server-side login failed, trying local fallback:", e);
        }

        // 2. Local fallback (offline mode)
        if (!user) {
            user = verifyUserCredential(email, password);
        }

        if (user) {
            if (!user.isApproved) {
                return { success: false, error: "管理者による承認待ちです。承認されるまでログインできません。" };
            }

            const global2FA = localStorage.getItem("jdex_config_2fa");
            const is2FAEnabled = global2FA === null ? false : JSON.parse(global2FA);

            if (!is2FAEnabled) {
                user.lastLogin = Date.now();
                saveUser(user);
                setCurrentUser(user);
                setUser({
                    id: user.id,
                    email: user.email,
                    nickname: user.displayName || (user as any).nickname,
                    avatarUrl: null,
                    createdAt: user.createdAt,
                    lastLogin: user.lastLogin,
                    isApproved: user.isApproved
                });
                return { success: true, requires2FA: false };
            }
            const code = String(Math.floor(1000 + Math.random() * 9000));
            send2FACode(user.email, code, "login");

            setPending2FAEmail(user.email);
            setPending2FACode(code);
            setPending2FAUserId(user.id);
            return { success: true, requires2FA: true, code };
        }

        return { success: false, error: "メールアドレスまたはパスワードが正しくありません" };
    }, []);

    const verifyTOTP = useCallback(async (token: string): Promise<{ success: boolean; error?: string }> => {
        if (!pendingTotpUser) return { success: false, error: "No pending TOTP session" };
        try {
            const res = await fetch("/api/settings/totp/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, secret: pendingTotpUser.totpSecret })
            });
            const data = await res.json();
            if (data.isValid) {
                const found = pendingTotpUser;
                found.lastLogin = Date.now();
                saveUser(found);
                setCurrentUser(found);
                setUser({
                    id: found.id,
                    email: found.email,
                    nickname: found.displayName,
                    avatarUrl: null,
                    createdAt: found.createdAt,
                    lastLogin: found.lastLogin,
                    isApproved: found.isApproved
                });
                setRequiresTOTP(false);
                setPendingTotpUser(null);
                return { success: true };
            } else {
                return { success: false, error: "認証コードが正しくありません" };
            }
        } catch (e) {
            return { success: false, error: "検証に失敗しました" };
        }
    }, [pendingTotpUser]);

    const verify2FA = useCallback(async (code: string): Promise<{ success: boolean; error?: string }> => {
        if (code !== pending2FACode) {
            return { success: false, error: "認証コードが正しくありません" };
        }

        const users = getAllUsers();
        // user-store returns UserProfile[], find by id
        let found = users.find(u => u.id === pending2FAUserId);

        if (!found) {
            // Fallback to the user object we just got from API (important for new browser sessions)
            if (pendingUser && pendingUser.id === pending2FAUserId) {
                found = pendingUser;
            }
        }

        if (!found) {
            return { success: false, error: "ユーザーが見つかりません" };
        }

        if (!found.isApproved) {
            return { success: false, error: "管理者による承認待ちです。承認されるまでログインできません。" };
        }

        found.lastLogin = Date.now();
        saveUser(found); // Update lastLogin in store
        setCurrentUser(found); // Set as current user

        setUser({
            id: found.id,
            email: found.email,
            nickname: found.displayName,
            avatarUrl: null,
            createdAt: found.createdAt,
            lastLogin: found.lastLogin,
            isApproved: found.isApproved
        });

        setPending2FAEmail(null);
        setPending2FACode(null);
        setPending2FAUserId(null);
        setPendingUser(null);

        return { success: true };
    }, [pending2FACode, pending2FAUserId, pendingUser]);

    const loginWithPasskey = useCallback(async (email: string): Promise<{ success: boolean; error?: string }> => {
        try {
            // 1. Find the user locally
            const users = getAllUsers();
            const foundUser = users.find(u => u.email === email);

            if (!foundUser || !foundUser.webAuthnCredentials || foundUser.webAuthnCredentials.length === 0) {
                return { success: false, error: "No passkeys registered for this email" };
            }

            // 2. Generate Options (stateless)
            const optionsRes = await fetch("/api/auth/webauthn/generate-authentication-options", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ credentials: foundUser.webAuthnCredentials }),
            });
            const options = await optionsRes.json();
            if (options.error) throw new Error(options.error);

            // 3. Browser Authentication
            const { startAuthentication } = await import("@simplewebauthn/browser");
            const authResp = await startAuthentication(options);

            // 4. Verify (stateless)
            // Find the matching credential to send its public key/counter for verification
            const credential = foundUser.webAuthnCredentials.find(c => c.id === authResp.id);
            const verifyRes = await fetch("/api/auth/webauthn/verify-authentication", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ authenticationResponse: authResp, credential }),
            });
            const result = await verifyRes.json();

            if (result.verified) {
                // Update counter if provided
                if (result.newCounter !== undefined && credential) {
                    credential.counter = result.newCounter;
                    saveUser(foundUser);
                }

                // Success! Log the user in
                foundUser.lastLogin = Date.now();
                saveUser(foundUser);
                setCurrentUser(foundUser);
                setUser({
                    id: foundUser.id,
                    email: foundUser.email,
                    nickname: foundUser.displayName,
                    avatarUrl: null,
                    createdAt: foundUser.createdAt,
                    lastLogin: foundUser.lastLogin,
                    isApproved: foundUser.isApproved
                });
                return { success: true };
            } else {
                return { success: false, error: "Passkey verification failed" };
            }
        } catch (error: any) {
            console.error("Passkey login error:", error);
            return { success: false, error: error.message || "Passkey login failed" };
        }
    }, []);

    const register = useCallback(async (email: string, password: string, nickname: string): Promise<{ success: boolean; error?: string; code?: string }> => {
        // Server is Source of Truth for registration (prevents duplicate accounts across browsers)
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, nickname, password })
            });
            const data = await res.json();

            if (!data.success || !data.user) {
                return { success: false, error: data.error || "登録に失敗しました" };
            }

            const resultUser = {
                ...data.user,
                displayName: nickname,
                passwordHash: btoa(password),
                isTotpEnabled: false,
                securitySettings: { requireAllMethods: false }
            };

            // Cache locally
            saveUser(resultUser);
            localStorage.setItem(`jdex_pw_${resultUser.id}`, btoa(password));

            // Check Global 2FA Setting
            const global2FA = localStorage.getItem("jdex_config_2fa");
            const is2FAEnabled = global2FA === null ? false : JSON.parse(global2FA);

            if (!is2FAEnabled) {
                // Skip 2FA and auto-login
                setCurrentUser(resultUser);
                setUser({
                    id: resultUser.id,
                    email: resultUser.email,
                    nickname: resultUser.displayName,
                    avatarUrl: null,
                    createdAt: resultUser.createdAt,
                    lastLogin: resultUser.lastLogin,
                    isApproved: resultUser.isApproved
                });
                return { success: true };
            }

            // Generate 4-digit 2FA code
            const code = String(Math.floor(1000 + Math.random() * 9000));
            setPending2FAEmail(email);
            setPending2FACode(code);
            setPending2FAUserId(resultUser.id);
            setPendingUser(resultUser);

            // Send Email (Best effort)
            send2FACode(email, code, "register");

            return { success: true, code };
        } catch (e) {
            console.error("Registration failed:", e);
            return { success: false, error: "予期せぬエラーが発生しました" };
        }
    }, []);

    const router = useRouter();

    const logout = useCallback(() => {
        setUser(null);
        setCurrentUser(null); // Clear from user-store
        localStorage.removeItem(AUTH_KEY); // Clear legacy key just in case
        router.push('/login');
    }, [router]);

    const updateAvatar = useCallback((avatarUrl: string) => {
        if (!user) return;
        setUser(prev => prev ? { ...prev, avatarUrl } : null);
    }, [user]);

    const deleteUserAsync = useCallback(async (userId: string): Promise<{ success: boolean; error?: string }> => {
        try {
            // 1. Remove from localStorage FIRST (before syncUsers reads it)
            deleteUserFromStore(userId);

            // 2. Immediately update UI state so the user disappears instantly
            setRegisteredUsers(prev => prev.filter(u => u.id !== userId));

            // 3. Delete from server
            const res = await fetch("/api/auth/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId })
            });
            const data = await res.json();

            // 4. Refresh from server (server is Source of Truth after deletion)
            //    Use a lightweight refresh that does NOT re-push local users
            try {
                const refreshRes = await fetch("/api/auth/users");
                const refreshData = await refreshRes.json();
                if (refreshData.success && refreshData.users) {
                    setRegisteredUsers(refreshData.users.map((u: any) => ({
                        id: u.id,
                        email: u.email,
                        nickname: u.displayName,
                        avatarUrl: null,
                        createdAt: u.createdAt,
                        lastLogin: u.lastLogin,
                        isTotpEnabled: u.isTotpEnabled,
                        hasPasskey: u.webAuthnCredentials && u.webAuthnCredentials.length > 0,
                        isApproved: u.isApproved
                    })));
                }
            } catch (refreshErr) {
                console.warn("Failed to refresh users after delete:", refreshErr);
            }

            if (!data.success) {
                // Server delete failed (e.g. user was local-only), but we already removed locally
                // This is acceptable behavior - treat as success if local removal worked
                console.warn("Server delete returned:", data.error);
            }
            return { success: true };
        } catch (e) {
            console.error("Delete user failed:", e);
            return { success: false, error: "通信エラーが発生しました" };
        }
    }, []);

    const approveUserAsync = useCallback(async (userId: string): Promise<{ success: boolean; error?: string }> => {
        // 1. Update locally first (Source of Truth for MVP)
        const users = getAllUsers();
        const u = users.find(x => x.id === userId);
        if (u) {
            u.isApproved = true;
            saveUser(u);
        }

        try {
            // 2. Sync with server (Best effort)
            const res = await fetch("/api/auth/approve", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId })
            });
            const data = await res.json();

            // Trigger refresh to sync state across tabs/components
            await syncUsers();

            if (data.success) {
                return { success: true };
            }
            // Even if server fails (e.g. 404), we return success if we updated locally
            return { success: true, error: data.error ? `Server sync failed: ${data.error}` : undefined };
        } catch (e) {
            console.warn("Approve user server sync failed:", e);
            await syncUsers();
            return { success: true }; // Still return true because local state is updated
        }
    }, [syncUsers]);

    const updateNickname = useCallback((nickname: string) => {
        if (!user) return;
        const currentUser = getCurrentUser();
        if (currentUser) {
            currentUser.displayName = nickname;
            saveUser(currentUser);
            setCurrentUser(currentUser);
            setUser(prev => prev ? { ...prev, nickname } : null);
        }
    }, [user]);

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            isLoading,
            login,
            loginWithPasskey,
            register,
            verify2FA,
            verifyTOTP,
            logout,
            updateAvatar,
            updateNickname,
            pending2FAEmail,
            pending2FACode,
            requiresTOTP,
            registeredUsers,
            refreshUsers,
            deleteUser: deleteUserAsync,
            approveUser: approveUserAsync,
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}

// Utility to get all users for admin
export function getRegisteredUsers(): AuthUser[] {
    return getAllUsers().map(u => ({
        id: u.id,
        email: u.email,
        nickname: u.displayName,
        avatarUrl: null,
        createdAt: u.createdAt,
        lastLogin: u.lastLogin,
        isTotpEnabled: u.isTotpEnabled,
        hasPasskey: u.webAuthnCredentials && u.webAuthnCredentials.length > 0,
        isApproved: u.isApproved
    }));
}

export function approveUser(userId: string): boolean {
    const users = getAllUsers();
    const user = users.find(u => u.id === userId);
    if (user) {
        user.isApproved = true;
        saveUser(user);

        // Sync with server (fire and forget for this UI helper, or ideally await in component)
        fetch("/api/auth/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId })
        }).catch(e => console.error("Server approval sync failed:", e));

        return true;
    }
    return false;
}
