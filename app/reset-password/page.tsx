"use client";

import React, { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Lock, CheckCircle, AlertCircle, ArrowRight, LogIn } from "lucide-react";

import { updateLocalPassword } from "@/lib/user-store";

export default function ResetPasswordPage() {
    const searchParams = useSearchParams();
    const router = useRouter();
    const token = searchParams.get("token");

    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

    useEffect(() => {
        if (!token) {
            setError("無効なトークンです。");
            setStatus("error");
        }
    }, [token]);


    // ... existing imports

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (password !== confirmPassword) {
            setError("パスワードが一致しません");
            return;
        }

        if (password.length < 6) {
            setError("パスワードは6文字以上にしてください。");
            return;
        }

        setStatus("loading");
        setError(null);

        try {
            const res = await fetch("/api/auth/reset-password/confirm", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token, newPassword: password })
            });
            const data = await res.json();

            if (data.success) {
                // Update local password if email is returned (Client-side persistence)
                if (data.email) {
                    updateLocalPassword(data.email, password);
                }
                setStatus("success");
            } else {
                setError(data.error || "パスワードリセットに失敗しました");
                setStatus("error");
            }
        } catch (err) {
            setError("通信エラーが発生しました");
            setStatus("error");
        }
    };

    return (
        <div className="min-h-screen bg-cyber-black flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-grid-gold opacity-[0.05] pointer-events-none"></div>

            <div className="w-full max-w-md p-8 glass-panel rounded-xl border border-gold-500/30 relative">
                <div className="text-center mb-8">
                    <div className="w-16 h-16 bg-gold-500/10 rounded-full flex items-center justify-center mb-4 mx-auto border border-gold-500/30 shadow-[0_0_20px_rgba(255,215,0,0.2)]">
                        <Lock className="w-8 h-8 text-gold-500" />
                    </div>
                    <h1 className="text-2xl font-bold text-white tracking-wider">パスワードの再設定</h1>
                    <p className="text-xs text-gray-500 mt-2 font-mono uppercase tracking-widest">RESET ACCESS CREDENTIALS</p>
                </div>

                {status === "success" ? (
                    <div className="space-y-6 text-center animate-in fade-in slide-in-from-bottom-4">
                        <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg flex flex-col items-center gap-3">
                            <CheckCircle className="w-8 h-8 text-emerald-500" />
                            <p className="text-emerald-400 font-medium">パスワードが正常に更新されました</p>
                        </div>
                        <button
                            onClick={() => router.push("/login")}
                            className="w-full py-4 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-gold-500/20"
                        >
                            <LogIn className="w-5 h-5" />
                            ログイン画面へ
                        </button>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">新しいパスワード</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 transition-all font-mono text-sm"
                                        placeholder="••••••••"
                                        required
                                        disabled={status === "loading" || status === "error" && !token}
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">パスワードの確認</label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 transition-all font-mono text-sm"
                                        placeholder="••••••••"
                                        required
                                        disabled={status === "loading" || status === "error" && !token}
                                    />
                                </div>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 p-4 rounded border border-red-500/20">
                                <AlertCircle className="w-5 h-5 shrink-0" />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={status === "loading" || !token}
                            className="w-full py-4 bg-gold-500 hover:bg-gold-400 disabled:opacity-50 text-black font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-gold-500/20 group"
                        >
                            {status === "loading" ? (
                                <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                            ) : (
                                <>
                                    パスワードを更新
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </>
                            )}
                        </button>
                    </form>
                )}

                <div className="mt-8 text-center">
                    <p className="text-[10px] text-gray-600 font-mono tracking-widest uppercase">
                        SECURE RECOVERY PROTOCOL V2.0
                    </p>
                </div>
            </div>
        </div>
    );
}
