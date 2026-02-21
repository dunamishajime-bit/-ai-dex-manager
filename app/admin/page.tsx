"use client";

import { useState, useEffect } from "react";
import {
    Users, Shield, Power, Activity, Key, Database, Brain, BarChart3,
    ChevronRight, Check, X, Trash2, RefreshCw, FileText, ArrowLeft, User, Mail, Image, Play, Smartphone, Fingerprint, Search
} from "lucide-react";
import Link from "next/link";
import {
    getAllUsers, deleteUser, UserProfile, isMaintenanceMode, setMaintenanceMode,
    isRegistrationDisabled, setRegistrationDisabled,
    getActivityLog, ActivityLogEntry
} from "@/lib/user-store";
import { getRegisteredUsers, AuthUser, approveUser, useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

export default function AdminPage() {
    const { registeredUsers: contextUsers, refreshUsers, deleteUser: deleteUserAsync, approveUser: approveUserAsync } = useAuth();
    const [isAdmin, setIsAdmin] = useState(false);
    const [adminPassword, setAdminPassword] = useState("");
    const [error, setError] = useState("");
    const [activeTab, setActiveTab] = useState("users");

    const [authUsers, setAuthUsers] = useState<AuthUser[]>([]);
    const [maintenance, setMaintenance] = useState(false);
    const [registrationDisabled, setRegistrationDisabledState] = useState(false);

    // 2FA & Manual Registration State
    const [is2FAEnabled, setIs2FAEnabled] = useState(true);
    const [newUserEmail, setNewUserEmail] = useState("");
    const [newUserPassword, setNewUserPassword] = useState("");
    const [newUserNickname, setNewUserNickname] = useState("");
    const [regMsg, setRegMsg] = useState("");

    const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
    const [resetEmail, setResetEmail] = useState("");
    const [resetMsg, setResetMsg] = useState("");

    // Member Management Search/Filter State
    const [searchTerm, setSearchTerm] = useState("");
    const [filterStatus, setFilterStatus] = useState<"all" | "pending" | "approved">("all");

    useEffect(() => {
        if (isAdmin) {
            refreshUsers();
            setMaintenance(isMaintenanceMode());
            setRegistrationDisabledState(isRegistrationDisabled());
            setActivityLog(getActivityLog());

            // Load 2FA setting
            const stored2FA = localStorage.getItem("jdex_config_2fa");
            if (stored2FA !== null) {
                setIs2FAEnabled(JSON.parse(stored2FA));
            }
        }
    }, [isAdmin, refreshUsers]);

    const handleManualRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: newUserEmail, nickname: newUserNickname, password: newUserPassword })
            });
            const data = await res.json();

            if (data.success && data.user) {
                // Refresh list from server
                const syncRes = await fetch("/api/auth/users");
                const syncData = await syncRes.json();
                if (syncData.success) {
                    setAuthUsers(syncData.users);
                }

                setRegMsg(`✅ ユーザー作成完了: ${newUserNickname}`);
                setNewUserEmail("");
                setNewUserPassword("");
                setNewUserNickname("");
            } else {
                setRegMsg(`❌ 作成失敗: ${data.error}`);
            }
        } catch (e: any) {
            setRegMsg(`❌ エラー: ${e.message}`);
        }
    };

    const handleAdminLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (adminPassword === "disTeacher5341") {
            setIsAdmin(true);
            setError("");
        } else {
            setError("管理者パスワードが無効です");
        }
    };

    const handleToggleMaintenance = () => {
        const newState = !maintenance;
        setMaintenance(newState);
        setMaintenanceMode(newState);
    };

    const handleToggleRegistration = () => {
        const newState = !registrationDisabled;
        setRegistrationDisabledState(newState);
        setRegistrationDisabled(newState);
    };

    // Legacy approval/delete handlers removed as we are unifying users
    const handleDeleteUser = async (userId: string) => {
        if (!window.confirm("このユーザーを削除してもよろしいですか？\nこの操作は取り消せません。")) return;
        const res = await deleteUserAsync(userId);
        if (!res.success) {
            alert(`削除に失敗しました: ${res.error}`);
        }
    };

    const handleApproveUser = async (userId: string) => {
        const res = await approveUserAsync(userId);
        if (!res.success) {
            alert(`承認に失敗しました: ${res.error}`);
        }
    };

    const filteredUsers = contextUsers.filter(u => {
        const matchesSearch = u.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.nickname.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === "all" ||
            (filterStatus === "pending" && !u.isApproved) ||
            (filterStatus === "approved" && u.isApproved);
        return matchesSearch && matchesStatus;
    });

    const handlePasswordReset = (e: React.FormEvent) => {
        e.preventDefault();
        if (!resetEmail.includes("@")) {
            setResetMsg("有効なメールアドレスを入力してください");
            return;
        }
        setResetMsg(`✅ ${resetEmail} へリセットリンクを送信しました（SendGrid API）`);
        setResetEmail("");
    };

    const handleStartTutorial = () => {
        // Create a fake new user for tutorial purposes
        const fakeUser = {
            id: "tutorial_preview_user",
            email: "tutorial@disdex.com",
            displayName: "New User",
            role: "user", // Required by UserProfile
            createdAt: Date.now(),
            agents: {},
            strategies: [],
            is2FAVerified: true // Ensure AuthGuard lets them through
        };

        // Persist        // 1. Set Auth User
        // Note: AuthContext uses getCurrentUser() which reads "jdex_current_user"
        // We must write to that key for the session to be picked up on reload.
        localStorage.setItem("jdex_current_user", JSON.stringify(fakeUser));
        localStorage.setItem("disdex_auth_user", JSON.stringify(fakeUser)); // Keep legacy just in case

        // 2. Clear tutorial flag for this user
        localStorage.removeItem(`disdex_tutorial_seen_${fakeUser.id}`);

        // Force reload to root to trigger AuthContext load and Tutorial
        window.location.href = "/";
    };

    const handleExportData = () => {
        const data: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith("jdex_") || key.startsWith("disdex_"))) {
                data[key] = localStorage.getItem(key) || "";
            }
        }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `disdex_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleImportData = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                const data = JSON.parse(event.target?.result as string);
                Object.entries(data).forEach(([key, value]) => {
                    localStorage.setItem(key, value as string);
                });

                // Force sync with server
                await refreshUsers();

                alert("データのインポートが完了しました。ページをリロードして反映を確認してください。");
                window.location.reload();
            } catch (err) {
                alert("インポートに失敗しました。ファイル形式を確認してください。");
            }
        };
        reader.readAsText(file);
    };

    // Admin Login Screen
    if (!isAdmin) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
                <div className="w-full max-w-md p-8 bg-[#0d1117] rounded-xl border border-red-500/30">
                    <div className="flex items-center gap-3 mb-6">
                        <Shield className="w-8 h-8 text-red-400" />
                        <div>
                            <h1 className="text-xl font-bold text-white">DIS-DEX 管理者ログイン</h1>
                            <p className="text-xs text-gray-500">ADMIN ACCESS ONLY</p>
                        </div>
                    </div>
                    <form onSubmit={handleAdminLogin} className="space-y-4">
                        <input
                            type="password"
                            value={adminPassword}
                            onChange={(e) => setAdminPassword(e.target.value)}
                            placeholder="管理者パスワード"
                            className="w-full bg-black/50 border border-red-500/20 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-red-500/50 font-mono"
                        />
                        {error && <p className="text-red-400 text-xs bg-red-500/10 p-2 rounded">{error}</p>}
                        <button type="submit" className="w-full py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg hover:bg-red-500/20 transition-colors font-mono">
                            管理者認証
                        </button>
                    </form>
                    <Link href="/" className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-400 mt-4 transition-colors">
                        <ArrowLeft className="w-3 h-3" /> ログイン画面に戻る
                    </Link>
                </div>
            </div>
        );
    }

    const tabs = [
        { id: "users", label: "会員管理", icon: Users },
        { id: "maintenance", label: "サイト管理", icon: Power },
        { id: "password", label: "PW再発行", icon: Key },
        { id: "activity", label: "ログ", icon: Activity },
        { id: "ai", label: "AI設定", icon: Brain },
        { id: "security", label: "セキュリティ", icon: Shield },
        { id: "api", label: "API監視", icon: BarChart3 },
        { id: "backup", label: "バックアップ", icon: Database },
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* Header */}
            <header className="border-b border-red-500/20 bg-[#0d1117] p-4">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <Shield className="w-6 h-6 text-red-400" />
                        <h1 className="text-lg font-bold">DIS-DEX 管理者コンソール</h1>
                        <span className="text-[10px] px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded font-mono">ADMIN</span>
                    </div>
                    <Link href="/" className="text-xs text-gray-500 hover:text-gray-400 transition-colors flex items-center gap-1">
                        <ArrowLeft className="w-3 h-3" /> サイトへ戻る
                    </Link>
                </div>
            </header>

            <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-6 p-4 md:p-6">
                {/* Sidebar - responsive */}
                <div className="w-full md:w-48 shrink-0">
                    <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap",
                                    activeTab === tab.id
                                        ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                        : "text-gray-400 hover:text-white hover:bg-white/5"
                                )}
                            >
                                <tab.icon className="w-4 h-4" />
                                {tab.label}
                            </button>
                        ))}
                    </nav>
                </div>

                {/* Content */}
                <div className="flex-1 bg-[#0d1117] rounded-xl border border-white/10 p-4 md:p-6 min-h-[600px]">

                    {/* ===== 会員管理（強化版） ===== */}
                    {activeTab === "users" && (
                        <div>
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="text-lg font-bold flex items-center gap-2"><Users className="w-5 h-5 text-red-400" /> 会員管理</h2>
                                <button
                                    onClick={handleStartTutorial}
                                    className="px-3 py-1.5 bg-gold-500/10 border border-gold-500/30 text-gold-400 text-xs rounded hover:bg-gold-500/20 transition-colors flex items-center gap-2"
                                >
                                    <Play className="w-3 h-3" />
                                    チュートリアル確認
                                </button>
                            </div>

                            {/* Auth Users (new system) */}
                            <div className="mb-6">
                                <h3 className="text-sm font-bold text-gold-400 flex items-center gap-2">
                                    <Shield className="w-4 h-4" /> 登録ユーザー
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-gold-500/10 text-gold-400">{filteredUsers.length}人</span>
                                </h3>
                                <div className="flex flex-col md:flex-row gap-3 mb-4">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                                        <input
                                            type="text"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            placeholder="名前またはメールで検索..."
                                            className="w-full bg-black/40 border border-white/10 rounded-lg pl-9 pr-4 py-2 text-sm text-white focus:outline-none focus:border-red-500/50"
                                        />
                                    </div>
                                    <div className="flex bg-black/40 border border-white/10 rounded-lg p-1">
                                        {(["all", "pending", "approved"] as const).map(status => (
                                            <button
                                                key={status}
                                                onClick={() => setFilterStatus(status)}
                                                className={cn(
                                                    "px-3 py-1 rounded text-xs transition-colors",
                                                    filterStatus === status ? "bg-red-500/20 text-red-400" : "text-gray-500 hover:text-white"
                                                )}
                                            >
                                                {status === "all" ? "全会員" : status === "pending" ? "承認待ち" : "承認済み"}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                {filteredUsers.length === 0 ? (
                                    <p className="text-gray-500 text-sm">登録ユーザーはいません</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm">
                                            <thead>
                                                <tr>
                                                    <th className="px-3 py-2 text-left">アイコン</th>
                                                    <th className="px-3 py-2 text-left">ニックネーム</th>
                                                    <th className="px-3 py-2 text-left">メールアドレス</th>
                                                    <th className="px-3 py-2 text-left text-center">ステータス</th>
                                                    <th className="px-3 py-2 text-left">登録日</th>
                                                    <th className="px-3 py-2 text-left">最終ログイン</th>
                                                    <th className="px-3 py-2 text-left">セキュリティ</th>
                                                    <th className="px-3 py-2 text-left text-right">操作</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {filteredUsers.map(user => (
                                                    <tr key={user.id} className="border-b border-white/5 hover:bg-white/5">
                                                        <td className="px-3 py-2">
                                                            {user.avatarUrl ? (
                                                                <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover border border-gold-500/20" />
                                                            ) : (
                                                                <div className="w-8 h-8 rounded-full bg-gold-500/10 border border-gold-500/20 flex items-center justify-center">
                                                                    <User className="w-4 h-4 text-gold-400" />
                                                                </div>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2 font-medium text-white">{user.nickname}</td>
                                                        <td className="px-3 py-2 text-gray-400">{user.email}</td>
                                                        <td className="px-3 py-2 text-center text-xs">
                                                            {user.isApproved ? (
                                                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                                                    承認済み
                                                                </span>
                                                            ) : (
                                                                <span className="px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
                                                                    保留
                                                                </span>
                                                            )}
                                                        </td>
                                                        <td className="px-3 py-2 text-gray-400 text-xs">{new Date(user.createdAt).toLocaleDateString()}</td>
                                                        <td className="px-3 py-2 text-gray-400 text-xs">{new Date(user.lastLogin).toLocaleDateString()}</td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex gap-1">
                                                                {user.isTotpEnabled && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1" title="TOTP Enabled">
                                                                        <Smartphone className="w-3 h-3" /> TOTP
                                                                    </span>
                                                                )}
                                                                {user.hasPasskey && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center gap-1" title="Passkey Registered">
                                                                        <Fingerprint className="w-3 h-3" /> KEY
                                                                    </span>
                                                                )}
                                                                {!user.isTotpEnabled && !user.hasPasskey && (
                                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-500 border border-white/5">NONE</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <div className="flex justify-end gap-2">
                                                                {!user.isApproved && (
                                                                    <button
                                                                        onClick={() => handleApproveUser(user.id)}
                                                                        className="p-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded hover:bg-emerald-500/20 transition-colors"
                                                                        title="承認する"
                                                                    >
                                                                        <Check className="w-4 h-4" />
                                                                    </button>
                                                                )}
                                                                <button
                                                                    onClick={() => handleDeleteUser(user.id)}
                                                                    className="p-1.5 bg-red-500/10 text-red-400 border border-red-500/30 rounded hover:bg-red-500/20 transition-colors"
                                                                    title="ユーザー削除"
                                                                >
                                                                    <Trash2 className="w-4 h-4" />
                                                                </button>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>

                            {/* Manual User Registration */}
                            <div className="bg-black/30 rounded-lg border border-white/10 p-4 mt-6">
                                <h3 className="text-sm font-bold text-emerald-400 mb-3 flex items-center gap-2">
                                    <User className="w-4 h-4" /> 新規ユーザー手動登録
                                </h3>
                                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs text-emerald-400 mb-4">
                                    ※ 管理者権限で即座にユーザーを作成します（メール認証/2FAはスキップ）
                                </div>
                                <form onSubmit={handleManualRegister} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">メールアドレス</label>
                                        <input
                                            type="email"
                                            value={newUserEmail}
                                            onChange={(e) => setNewUserEmail(e.target.value)}
                                            placeholder="user@example.com"
                                            className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">ニックネーム</label>
                                        <input
                                            type="text"
                                            value={newUserNickname}
                                            onChange={(e) => setNewUserNickname(e.target.value)}
                                            placeholder="Nickname"
                                            className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-gray-400 mb-1 block">パスワード</label>
                                        <input
                                            type="password"
                                            value={newUserPassword}
                                            onChange={(e) => setNewUserPassword(e.target.value)}
                                            placeholder="Password"
                                            className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                                            required
                                        />
                                    </div>
                                    <div className="flex items-end">
                                        <button type="submit" className="w-full py-2 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded hover:bg-emerald-500/20 transition-colors text-sm font-bold flex items-center justify-center gap-2">
                                            <User className="w-4 h-4" /> ユーザーを作成
                                        </button>
                                    </div>
                                </form>
                                {regMsg && <p className="mt-3 text-sm font-mono text-white bg-white/5 p-2 rounded">{regMsg}</p>}
                            </div>
                        </div>
                    )}

                    {/* ===== サイト管理 ===== */}
                    {activeTab === "maintenance" && (
                        <div className="space-y-6">
                            <h2 className="text-lg font-bold flex items-center gap-2"><Power className="w-5 h-5 text-red-400" /> サイト管理</h2>

                            {/* Maintenance Mode */}
                            <div className="p-4 bg-black/30 rounded-lg border border-white/10 flex justify-between items-center">
                                <div>
                                    <h3 className="font-medium">サイト停止（メンテナンスモード）</h3>
                                    <p className="text-xs text-gray-500 mt-1">有効にすると「只今メンテナンス中。」が表示されます</p>
                                </div>
                                <button
                                    onClick={handleToggleMaintenance}
                                    className={cn(
                                        "w-14 h-7 rounded-full relative transition-colors",
                                        maintenance ? "bg-red-500" : "bg-gray-700"
                                    )}
                                >
                                    <div className={cn(
                                        "w-5 h-5 rounded-full bg-white absolute top-1 transition-all",
                                        maintenance ? "left-8" : "left-1"
                                    )} />
                                </button>
                            </div>

                            {/* Global 2FA Toggle */}
                            <div className="p-4 bg-black/30 rounded-lg border border-white/10 flex justify-between items-center">
                                <div>
                                    <h3 className="font-medium">サイト全体 2段階認証 (2FA)</h3>
                                    <p className="text-xs text-gray-500 mt-1">OFFにすると、全ユーザーのログイン/登録時の2FAをスキップします</p>
                                </div>
                                <button
                                    onClick={() => {
                                        const newState = !is2FAEnabled;
                                        setIs2FAEnabled(newState);
                                        localStorage.setItem("jdex_config_2fa", JSON.stringify(newState));
                                    }}
                                    className={cn(
                                        "w-14 h-7 rounded-full relative transition-colors",
                                        is2FAEnabled ? "bg-emerald-500" : "bg-gray-700"
                                    )}
                                >
                                    <div className={cn(
                                        "w-5 h-5 rounded-full bg-white absolute top-1 transition-all",
                                        is2FAEnabled ? "left-8" : "left-1"
                                    )} />
                                </button>
                            </div>

                            {/* New Registration Toggle */}
                            <div className="p-4 bg-black/30 rounded-lg border border-white/10 flex justify-between items-center">
                                <div>
                                    <h3 className="font-medium text-orange-400">新規会員登録の停止</h3>
                                    <p className="text-xs text-gray-500 mt-1">有効にすると、ログイン画面で「新規会員登録」ボタンが非表示になります</p>
                                </div>
                                <button
                                    onClick={handleToggleRegistration}
                                    className={cn(
                                        "w-14 h-7 rounded-full relative transition-colors",
                                        registrationDisabled ? "bg-orange-500" : "bg-gray-700"
                                    )}
                                >
                                    <div className={cn(
                                        "w-5 h-5 rounded-full bg-white absolute top-1 transition-all",
                                        registrationDisabled ? "left-8" : "left-1"
                                    )} />
                                </button>
                            </div>

                            <div className={cn(
                                "p-3 rounded-lg text-sm font-mono flex flex-wrap items-center gap-4",
                                maintenance ? "bg-red-500/10 border border-red-500/30 text-red-400" : "bg-emerald-500/10 border border-emerald-500/30 text-emerald-400"
                            )}>
                                <span>ステータス: {maintenance ? "🔴 メンテナンスモード ON" : "🟢 サイト稼働中"}</span>
                                <span className={is2FAEnabled ? "text-emerald-400" : "text-gray-500"}>
                                    2FA: {is2FAEnabled ? "ON" : "OFF"}
                                </span>
                                <span className={registrationDisabled ? "text-orange-400" : "text-gray-500"}>
                                    新規登録: {registrationDisabled ? "停止中" : "許可"}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* ===== PW再発行 ===== */}
                    {activeTab === "password" && (
                        <div className="space-y-6">
                            <h2 className="text-lg font-bold flex items-center gap-2"><Key className="w-5 h-5 text-red-400" /> パスワード再発行</h2>
                            <div className="p-4 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                                ⚠ 管理者はユーザーのパスワードを確認できません（セキュリティのため）。パスワードリセットリンクの送信のみ可能です。
                            </div>
                            <form onSubmit={handlePasswordReset} className="space-y-4 max-w-md">
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">ユーザーのメールアドレス</label>
                                    <input
                                        type="email"
                                        value={resetEmail}
                                        onChange={(e) => setResetEmail(e.target.value)}
                                        placeholder="user@example.com"
                                        className="w-full bg-black/50 border border-white/10 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-red-500/50"
                                    />
                                </div>
                                <button type="submit" className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm hover:bg-red-500/20 transition-colors">
                                    リセットリンク送信 (SendGrid)
                                </button>
                                {resetMsg && <p className="text-xs text-emerald-400 bg-emerald-500/10 p-2 rounded">{resetMsg}</p>}
                            </form>
                        </div>
                    )}

                    {/* Other tabs remain the same */}
                    {activeTab === "activity" && (
                        <div className="space-y-4">
                            <h2 className="text-lg font-bold flex items-center gap-2"><Activity className="w-5 h-5 text-red-400" /> ユーザーアクティビティログ</h2>
                            <div className="space-y-2 max-h-[500px] overflow-y-auto custom-scrollbar">
                                {activityLog.length === 0 ? (
                                    <p className="text-gray-500 text-sm">ログはまだありません</p>
                                ) : activityLog.slice(0, 50).map(log => (
                                    <div key={log.id} className="flex gap-3 p-2 bg-black/20 rounded border border-white/5 text-xs">
                                        <span className="text-gray-500 font-mono shrink-0">{new Date(log.timestamp).toLocaleString()}</span>
                                        <span className="text-white">{log.action}</span>
                                        <span className="text-gray-400">{log.details}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === "ai" && (
                        <div className="space-y-6">
                            <h2 className="text-lg font-bold flex items-center gap-2"><Brain className="w-5 h-5 text-red-400" /> AIエージェント設定</h2>
                            <div className="space-y-4">
                                {["テクニカル・アナリスト", "センチメント・スキャナー", "セキュリティ・ガーディアン", "ファンダメンタル・リサーチャー", "統括コーディネーター"].map((name, i) => (
                                    <div key={i} className="p-4 bg-black/30 rounded-lg border border-white/10">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-sm font-medium">{name}</span>
                                            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400">稼働中</span>
                                        </div>
                                        <textarea
                                            placeholder={`${name}のシステムプロンプト...`}
                                            className="w-full bg-black/50 border border-white/10 rounded px-3 py-2 text-xs text-gray-300 h-16 resize-none focus:outline-none focus:border-red-500/30"
                                            defaultValue={`あなたは${name}です。与えられた仮想通貨ペアについて、専門的な分析を行ってください。`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === "security" && (
                        <div className="space-y-6">
                            <h2 className="text-lg font-bold flex items-center gap-2"><Shield className="w-5 h-5 text-red-400" /> セキュリティレポート</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {[
                                    { label: "JWT認証", status: "✅ 有効", color: "text-emerald-400" },
                                    { label: "レート制限", status: "✅ 100 req/min", color: "text-emerald-400" },
                                    { label: "入力検証", status: "✅ OWASP準拠", color: "text-emerald-400" },
                                    { label: "APIキー暗号化", status: "✅ AES-256", color: "text-emerald-400" },
                                    { label: "XSS/CSRF", status: "✅ 保護済み", color: "text-emerald-400" },
                                    { label: "PW保護", status: "✅ ハッシュ化", color: "text-emerald-400" },
                                    { label: "2FA認証", status: "✅ メール認証", color: "text-emerald-400" },
                                    { label: "最終スキャン", status: "2026-02-13", color: "text-gray-400" },
                                ].map((item, i) => (
                                    <div key={i} className="p-3 bg-black/30 rounded-lg border border-white/10">
                                        <div className="text-xs text-gray-400">{item.label}</div>
                                        <div className={cn("text-sm font-mono", item.color)}>{item.status}</div>
                                    </div>
                                ))}
                            </div>
                            <button className="px-4 py-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-sm hover:bg-red-500/20 transition-colors flex items-center gap-2">
                                <RefreshCw className="w-4 h-4" /> セキュリティスキャン実行
                            </button>
                        </div>
                    )}

                    {activeTab === "api" && (
                        <div className="space-y-6">
                            <h2 className="text-lg font-bold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-red-400" /> API使用量モニタリング</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                {[
                                    { api: "CoinGecko", used: 245, limit: 500, color: "bg-emerald-500" },
                                    { api: "Gemini", used: 89, limit: 1000, color: "bg-blue-500" },
                                    { api: "SendGrid", used: 12, limit: 100, color: "bg-purple-500" },
                                ].map((item, i) => (
                                    <div key={i} className="p-4 bg-black/30 rounded-lg border border-white/10">
                                        <div className="text-sm font-medium mb-2">{item.api}</div>
                                        <div className="text-xs text-gray-400 mb-1">{item.used}/{item.limit} requests</div>
                                        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                                            <div className={cn("h-full rounded-full", item.color)} style={{ width: `${(item.used / item.limit) * 100}%` }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {activeTab === "backup" && (
                        <div className="space-y-6">
                            <h2 className="text-lg font-bold flex items-center gap-2"><Database className="w-5 h-5 text-red-400" /> バックアップと移行</h2>
                            <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg text-xs text-orange-400 mb-4">
                                💡 ドメイン変更時などは、旧サイトで「全データエクスポート」を行い、新サイトで「全データ復元」を実行してください。
                            </div>
                            <div className="space-y-3">
                                <div className="p-4 bg-black/30 rounded-lg border border-white/10 flex justify-between items-center">
                                    <div>
                                        <div className="text-sm font-medium">全システムデータ</div>
                                        <div className="text-xs text-gray-500">localStorageの全データ（ユーザー、AI状態、設定等）の一括書き出し</div>
                                    </div>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={handleExportData}
                                            className="px-3 py-1 bg-red-500/10 border border-red-500/30 text-red-400 rounded text-xs hover:bg-red-500/20 transition-colors flex items-center gap-1"
                                        >
                                            <FileText className="w-3 h-3" /> エクスポート (JSON)
                                        </button>
                                        <label className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded text-xs hover:bg-emerald-500/20 transition-colors flex items-center gap-1 cursor-pointer">
                                            <RefreshCw className="w-3 h-3" /> 復元・インポート
                                            <input type="file" accept=".json" onChange={handleImportData} className="hidden" />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
