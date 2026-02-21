"use client";

import { useState, useEffect } from "react";
import { AIAgent } from "@/lib/ai-agents";
import { getCurrentUser, saveUser, UserProfile } from "@/lib/user-store";
import { Settings, Shield, Cpu, Database, Users, Save, Undo, Upload, Smartphone, Key, AlertTriangle, CheckCircle, XCircle, Edit3, Info, Globe, Activity, Target } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useAgents } from "@/context/AgentContext";
import { useSimulation } from "@/context/SimulationContext";
import { startRegistration } from "@simplewebauthn/browser";
import { SecurityScanner } from "@/components/features/SecurityScanner";
import { GoalBasedPortfolio } from "@/components/features/GoalBasedPortfolio";

function AgentEditor({ agent }: { agent: AIAgent }) {
    const { updateAgent } = useAgents();
    const [formData, setFormData] = useState(agent);
    const [isDirty, setIsDirty] = useState(false);

    const handleChange = (field: keyof AIAgent, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        setIsDirty(true);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                setFormData(prev => ({ ...prev, avatar: result }));
                setIsDirty(true);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSave = () => {
        updateAgent(agent.id, formData);
        setIsDirty(false);
    };

    const handleReset = () => {
        setFormData(agent);
        setIsDirty(false);
    };

    return (
        <div className="p-4 bg-white/5 rounded-lg border border-white/10 space-y-4">
            <div className="flex items-start gap-4">
                <div className="shrink-0 relative group">
                    <img
                        src={formData.avatar}
                        alt={formData.name}
                        className={`w-16 h-16 rounded-full border-2 ${formData.borderColor} object-cover`}
                    />
                    <label className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 cursor-pointer transition-opacity">
                        <Upload className="w-6 h-6 text-white" />
                        <input
                            type="file"
                            accept="image/*"
                            onChange={handleImageUpload}
                            className="hidden"
                        />
                    </label>
                </div>
                <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Name</label>
                            <input
                                type="text"
                                value={formData.name}
                                onChange={e => handleChange("name", e.target.value)}
                                className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-white focus:border-gold-500/50 outline-none"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-500 mb-1 block">Short Name</label>
                            <input
                                type="text"
                                value={formData.shortName}
                                onChange={e => handleChange("shortName", e.target.value)}
                                className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-sm text-white focus:border-gold-500/50 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Avatar URL / Upload</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={formData.avatar}
                                onChange={e => handleChange("avatar", e.target.value)}
                                className="flex-1 bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 focus:border-gold-500/50 outline-none font-mono truncate"
                                placeholder="https://..."
                            />
                            <label className="flex items-center gap-1 px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded cursor-pointer transition-colors text-xs text-gray-400 hover:text-white">
                                <Upload className="w-3 h-3" />
                                <input
                                    type="file"
                                    accept="image/*"
                                    onChange={handleImageUpload}
                                    className="hidden"
                                />
                            </label>
                        </div>
                    </div>
                    <div>
                        <label className="text-xs text-gray-500 mb-1 block">Personality / Role Prompt</label>
                        <textarea
                            value={formData.personality}
                            onChange={e => handleChange("personality", e.target.value)}
                            className="w-full bg-black/30 border border-white/10 rounded px-2 py-1 text-xs text-gray-300 focus:border-gold-500/50 outline-none h-20"
                        />
                    </div>

                    {isDirty && (
                        <div className="flex justify-end gap-2 mt-2">
                            <button
                                onClick={handleReset}
                                className="flex items-center gap-1 px-3 py-1 bg-white/10 hover:bg-white/20 rounded text-xs transition-colors"
                            >
                                <Undo className="w-3 h-3" /> Reset
                            </button>
                            <button
                                onClick={handleSave}
                                className="flex items-center gap-1 px-3 py-1 bg-gold-500/20 text-gold-400 border border-gold-500/50 hover:bg-gold-500/30 rounded text-xs transition-colors"
                            >
                                <Save className="w-3 h-3" /> Save Changes
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function SettingsPage() {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [isTotpModalOpen, setIsTotpModalOpen] = useState(false);
    const [totpSetupData, setTotpSetupData] = useState<{ secret: string; qrCodeUrl: string } | null>(null);
    const [totpToken, setTotpToken] = useState("");
    const [totpError, setTotpError] = useState("");
    const [totpSuccess, setTotpSuccess] = useState(false);
    const [isPasskeyEnabling, setIsPasskeyEnabling] = useState(false);
    const { agents } = useAgents();

    useEffect(() => {
        setUser(getCurrentUser());
    }, []);

    const handleStartTotpSetup = async () => {
        if (!user) return;
        try {
            const res = await fetch("/api/settings/totp/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: user.email })
            });
            const data = await res.json();
            if (data.success) {
                setTotpSetupData({ secret: data.secret, qrCodeUrl: data.qrCodeUrl });
                setIsTotpModalOpen(true);
                setTotpError("");
                setTotpSuccess(false);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleVerifyTotp = async () => {
        if (!totpSetupData || !totpToken || !user) return;
        try {
            const res = await fetch("/api/settings/totp/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: totpToken, secret: totpSetupData.secret })
            });
            const data = await res.json();
            if (data.isValid) {
                const updatedUser: UserProfile = {
                    ...user,
                    totpSecret: totpSetupData.secret,
                    isTotpEnabled: true
                };
                saveUser(updatedUser);
                setUser(updatedUser);
                setTotpSuccess(true);
                setTimeout(() => setIsTotpModalOpen(false), 2000);
            } else {
                setTotpError("Invalid token. Please try again.");
            }
        } catch (err) {
            setTotpError("Verification failed.");
        }
    };

    const handleDisableTotp = () => {
        if (!user || !window.confirm("Are you sure you want to disable 2FA? This will make your account less secure.")) return;
        const updatedUser: UserProfile = {
            ...user,
            totpSecret: undefined,
            isTotpEnabled: false
        };
        saveUser(updatedUser);
        setUser(updatedUser);
    };

    const handleRegisterPasskey = async () => {
        if (!user) return;
        setIsPasskeyEnabling(true);
        try {
            const resp = await fetch("/api/auth/webauthn/generate-registration-options", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userId: user.id, userName: user.email })
            });
            const options = await resp.json();
            if (options.error) throw new Error(options.error);

            const attResp = await startRegistration(options);
            const verificationResp = await fetch("/api/auth/webauthn/verify-registration", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ registrationResponse: attResp }),
            });
            const verificationJSON = await verificationResp.json();

            if (verificationJSON && verificationJSON.verified) {
                alert("Passkey registered successfully!");
                const updatedUser: UserProfile = {
                    ...user,
                    hasPasskey: true,
                    webAuthnCredentials: [
                        ...(user.webAuthnCredentials || []),
                        verificationJSON.credential
                    ]
                };
                saveUser(updatedUser);
                setUser(updatedUser);
            } else {
                alert("Passkey registration failed: " + verificationJSON?.error);
            }
        } catch (error: any) {
            console.error("Passkey registration error:", error);
            alert("Passkey registration failed: " + error.message);
        } finally {
            setIsPasskeyEnabling(false);
        }
    };

    const handleToggleStrictMode = () => {
        if (!user) return;
        const updatedUser: UserProfile = {
            ...user,
            securitySettings: {
                ...user.securitySettings,
                requireAllMethods: !user.securitySettings?.requireAllMethods,
            },
        };
        saveUser(updatedUser);
        setUser(updatedUser);
    };

    return (
        <div className="p-6 max-w-6xl mx-auto w-full space-y-8 animate-in fade-in duration-500">
            <div>
                <h1 className="text-3xl font-black tracking-tight text-white flex items-center gap-3">
                    <div className="p-2 bg-gold-500/10 rounded-xl border border-gold-500/30">
                        <Settings className="w-8 h-8 text-gold-500" />
                    </div>
                    <span className="bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
                        システム構成
                    </span>
                </h1>
                <p className="text-gray-500 text-xs font-mono mt-2 tracking-widest uppercase">System Configuration & User Authority</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Profile & Security */}
                <div className="space-y-8">
                    {/* User Profile Card */}
                    <Card title="ユーザープロフィール" glow="primary">
                        <div className="p-6 bg-white/5 rounded-2xl border border-white/10 space-y-6">
                            <div className="flex flex-col items-center gap-6">
                                <div className="relative group/avatar">
                                    <div className="w-28 h-28 rounded-3xl overflow-hidden border-2 border-gold-500/30 shadow-2xl relative">
                                        {(user as any)?.avatarUrl ? (
                                            <img src={(user as any).avatarUrl} className="w-full h-full object-cover" alt="Profile" />
                                        ) : (
                                            <div className="w-full h-full bg-gold-500/5 flex items-center justify-center">
                                                <Users className="w-12 h-12 text-gold-500/20" />
                                            </div>
                                        )}
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/avatar:opacity-100 transition-opacity flex items-center justify-center">
                                            <Upload className="w-8 h-8 text-white" />
                                        </div>
                                    </div>
                                    <label className="absolute -bottom-2 -right-2 p-2.5 bg-gold-500 text-black rounded-xl cursor-pointer hover:bg-gold-400 transition-all shadow-xl hover:scale-110 active:scale-95">
                                        <Smartphone className="w-4 h-4" />
                                        <input
                                            type="file"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = (ev) => {
                                                        if (ev.target?.result) {
                                                            const updatedUser = { ...user!, avatarUrl: ev.target.result as string } as any;
                                                            saveUser(updatedUser);
                                                            setUser(updatedUser);
                                                        }
                                                    };
                                                    reader.readAsDataURL(file);
                                                }
                                            }}
                                        />
                                    </label>
                                </div>

                                <div className="w-full space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] text-gray-500 uppercase font-black tracking-widest pl-1">表示名</label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={user?.displayName || ""}
                                                onChange={(e) => user && setUser({ ...user, displayName: e.target.value })}
                                                className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:border-gold-500/50 outline-none transition-all"
                                                placeholder="名前を入力..."
                                            />
                                            <button
                                                onClick={() => {
                                                    if (user) {
                                                        saveUser(user);
                                                        alert("プロファイルを更新しました");
                                                    }
                                                }}
                                                className="px-6 py-3 bg-gold-500 text-black font-black rounded-xl text-sm hover:bg-gold-400 transition-all active:scale-95"
                                            >
                                                保存
                                            </button>
                                        </div>
                                    </div>
                                    <div className="p-4 bg-black/40 rounded-xl border border-white/5 space-y-1">
                                        <div className="text-[10px] text-gray-500 uppercase font-black tracking-widest">ログイン識別子</div>
                                        <div className="text-sm text-gold-500/80 font-mono truncate">{user?.email}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>

                    {/* Security Card */}
                    <Card title="セキュリティ" glow="danger">
                        <div className="space-y-3">
                            {/* TOTP */}
                            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10 hover:border-gold-500/20 transition-colors group">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${user?.isTotpEnabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-gray-500/10 text-gray-500'}`}>
                                        <Smartphone className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white">2段階認証 (TOTP)</h3>
                                        <p className="text-[10px] text-gray-500">認証アプリによるセキュリティ強化</p>
                                    </div>
                                </div>
                                <button
                                    onClick={user?.isTotpEnabled ? handleDisableTotp : handleStartTotpSetup}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${user?.isTotpEnabled ? 'bg-red-500/10 text-red-500 border-red-500/20 hover:bg-red-500/20' : 'bg-gold-500/10 text-gold-500 border-gold-500/20 hover:bg-gold-500/20'}`}
                                >
                                    {user?.isTotpEnabled ? '無効化' : '設定開始'}
                                </button>
                            </div>

                            {/* Passkey */}
                            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10 hover:border-gold-500/20 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className={`p-3 rounded-xl ${user?.hasPasskey ? 'bg-blue-500/10 text-blue-500' : 'bg-gray-500/10 text-gray-500'}`}>
                                        <Key className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white">パスキー</h3>
                                        <p className="text-[10px] text-gray-500">生体認証またはセキュリティキー</p>
                                    </div>
                                </div>
                                <button
                                    onClick={handleRegisterPasskey}
                                    disabled={isPasskeyEnabling}
                                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border ${user?.hasPasskey ? 'bg-blue-500/10 text-blue-400 border-blue-500/20 hover:bg-blue-500/20' : 'bg-gray-500/5 text-gray-400 border-white/10 hover:bg-white/10'}`}
                                >
                                    {isPasskeyEnabling ? "処理中..." : user?.hasPasskey ? "追加" : "有効化"}
                                </button>
                            </div>

                            {/* Risk Section */}
                            <div className="pt-4 mt-2 border-t border-white/5">
                                <div className="p-4 bg-red-500/5 rounded-2xl border border-red-500/10 space-y-4">
                                    <div className="flex items-center gap-2 text-red-500">
                                        <Shield className="w-4 h-4" />
                                        <span className="text-[10px] font-black uppercase tracking-widest">Danger Zone</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <div className="space-y-1">
                                            <h4 className="text-xs font-bold text-white">シミュレーション初期化</h4>
                                            <p className="text-[10px] text-gray-500 max-w-[200px]">残高・取引履歴をすべて削除します</p>
                                        </div>
                                        <button
                                            onClick={() => {
                                                if (window.confirm("全てのデータをリセットしますか？")) {
                                                    // Handle reset
                                                }
                                            }}
                                            className="px-3 py-2 bg-red-500/10 text-red-500 border border-red-500/30 rounded-xl text-xs font-bold hover:bg-red-500 hover:text-white transition-all"
                                        >
                                            リセット
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Right Column: AI & System */}
                <div className="space-y-8">
                    {/* AI Agents */}
                    <Card title="AIエージェント構成" glow="secondary">
                        <div className="space-y-6">
                            <div className="flex items-center justify-between p-2">
                                <p className="text-[10px] text-gray-500 max-w-[70%]">評議会メンバーの役割と個性を定義します。議論の精度に直結します。</p>
                                <div className="flex items-center gap-2 text-emerald-500 text-[10px] font-black">
                                    <Users className="w-3 h-3" /> ONLINE
                                </div>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                {agents.map(agent => (
                                    <AgentEditor key={agent.id} agent={agent} />
                                ))}
                            </div>
                        </div>
                    </Card>

                    {/* System Config */}
                    <Card title="インフラストラクチャ" glow="primary">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10 hover:border-gold-500/20 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-white/5 rounded-xl text-gray-400">
                                        <Database className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white">RPC Node</h3>
                                        <p className="text-[10px] text-emerald-500 font-mono">CONNECTED (14ms)</p>
                                    </div>
                                </div>
                            </div>
                            <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/10 hover:border-gold-500/20 transition-colors">
                                <div className="flex items-center gap-4">
                                    <div className="p-3 bg-white/5 rounded-xl text-gray-400">
                                        <Cpu className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h3 className="text-sm font-bold text-white">AI Engine</h3>
                                        <p className="text-[10px] text-gold-500/80 font-mono">GEMINI-2.5-FLASH</p>
                                    </div>
                                </div>
                                <select className="bg-black/50 border border-white/10 rounded-lg px-2 py-1 text-[10px] text-white outline-none focus:border-gold-500/50">
                                    <option>2.5-Flash</option>
                                    <option>1.5-Pro</option>
                                </select>
                            </div>
                        </div>
                    </Card>
                </div>
            </div>

            {/* Phase 8 & 10: Security Scanner + Goal Portfolio */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card title="コントラクトセキュリティスキャナー" glow="danger">
                    <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
                        <Shield className="w-3 h-3" />
                        スマートコントラクトのリスク診断（Phase 8）
                    </div>
                    <SecurityScanner />
                </Card>
                <Card title="目標ベースポートフォリオ" glow="primary">
                    <div className="flex items-center gap-2 mb-4 text-xs text-gray-500">
                        <Target className="w-3 h-3" />
                        AI最適配分プランナー（Phase 10）
                    </div>
                    <GoalBasedPortfolio />
                </Card>
            </div>

            {/* TOTP Modal */}
            {isTotpModalOpen && totpSetupData && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl">
                    <div className="bg-[#0a0a0b] border border-gold-500/30 rounded-3xl w-full max-w-md p-8 shadow-[0_0_100px_rgba(255,215,0,0.1)] relative border-b-4 border-b-gold-500/50">
                        <button onClick={() => setIsTotpModalOpen(false)} className="absolute top-6 right-6 text-gray-500 hover:text-white">
                            <XCircle className="w-6 h-6" />
                        </button>

                        <div className="space-y-6 text-center">
                            <h2 className="text-2xl font-black text-white">2FA セットアップ</h2>
                            <div className="p-4 bg-white rounded-2xl w-fit mx-auto shadow-2xl">
                                <img src={totpSetupData.qrCodeUrl} alt="QR" className="w-48 h-48" />
                            </div>
                            <div className="space-y-2">
                                <input
                                    type="text"
                                    maxLength={6}
                                    placeholder="000000"
                                    value={totpToken}
                                    onChange={e => setTotpToken(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-4 text-center text-3xl font-mono text-white focus:border-gold-500 outline-none"
                                />
                                {totpError && <p className="text-red-500 text-xs">{totpError}</p>}
                            </div>
                            <button
                                onClick={handleVerifyTotp}
                                className="w-full py-4 bg-gold-500 text-black font-black rounded-2xl hover:bg-gold-400 active:scale-95 transition-all"
                            >
                                設定を完了する
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
