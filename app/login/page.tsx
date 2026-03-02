
"use client";

import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, LogIn, AlertCircle, Smartphone, ArrowRight, ShieldCheck, Fingerprint, LayoutDashboard } from "lucide-react";

export default function LoginPage() {
    const { login, loginWithPasskey, verifyTOTP } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [step, setStep] = useState<"login" | "totp">("login");
    const [totpToken, setTotpToken] = useState("");
    const [isPasskeyAuth, setIsPasskeyAuth] = useState(false);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setMessage(null);

        try {
            const result = await login(email, password);
            if (result.success) {
                if (result.requires2FA) {
                    router.push("/api/auth/verify?email=" + encodeURIComponent(email));
                } else if (result.requiresTOTP) {
                    setStep("totp");
                } else {
                    router.push("/");
                }
            } else {
                setError(result.error || "Login failed");
            }
        } catch (err: any) {
            setError(err.message || "An unexpected error occurred");
        }
    };

    const handlePasskeyLogin = async () => {
        if (!email) {
            setError("パスキー認証にはメールアドレスの入力が必要です。");
            return;
        }
        setIsPasskeyAuth(true);
        setError(null);
        try {
            const result = await loginWithPasskey(email);
            if (result.success) {
                router.push("/");
            } else {
                setError(result.error || "パスキー認証に失敗しました。");
            }
        } catch (err: any) {
            console.error(err);
            setError(err.message || "パスキーログインに失敗しました。");
        } finally {
            setIsPasskeyAuth(false);
        }
    };

    const handleTotpVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        try {
            const result = await verifyTOTP(totpToken);
            if (result.success) {
                router.push("/");
            } else {
                setError(result.error || "Verification failed");
            }
        } catch (err: any) {
            setError("Validation error");
        }
    };

    return (
        <div className="relative min-h-screen bg-[#0a0a0a] flex items-center justify-center p-4 overflow-hidden">
            {/* Background Image */}
            <div className="absolute inset-0 z-0">
                <img
                    src="/backgrounds/login_bg.png"
                    alt="login-bg"
                    className="w-full h-full object-cover opacity-50"
                    style={{ filter: 'brightness(0.4) contrast(1.1)' }}
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '0';
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black" />
            </div>

            <div className="relative z-10 w-full max-w-md bg-black/40 border border-white/10 rounded-2xl p-8 backdrop-blur-xl shadow-2xl">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-black text-gold-500 mb-2 tracking-tighter italic">DIS-DEX MANAGER</h1>
                    <p className="text-gray-400">Sign in to access AI Trading Council</p>
                </div>

                {step === "login" ? (
                    <form onSubmit={handleLogin} className="space-y-6">
                        <div>
                            <label className="block text-sm text-gray-400 mb-2">Email</label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white focus:border-gold-500/50 focus:outline-none focus:ring-1 focus:ring-gold-500/50 transition-all font-mono"
                                    placeholder="name@example.com"
                                    required
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm text-gray-400 mb-2">Password</label>
                            <div className="relative">
                                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
                                <input
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full bg-white/5 border border-white/10 rounded-lg py-3 pl-10 pr-4 text-white focus:border-gold-500/50 focus:outline-none focus:ring-1 focus:ring-gold-500/50 transition-all"
                                    placeholder="••••••••"
                                    required
                                />
                            </div>
                            <div className="flex justify-end mt-2">
                                <Link href="/reset-password" className="text-xs text-gold-500/80 hover:text-gold-400 hover:underline transition-colors">
                                    パスワードをお忘れですか？
                                </Link>
                            </div>
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 p-3 rounded-lg">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}

                        <div className="space-y-3">
                            <button
                                type="submit"
                                className="w-full bg-gold-500 hover:bg-gold-400 text-black font-bold py-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-gold-500/20 active:scale-95"
                            >
                                <LogIn className="w-5 h-5" />
                                SIGN IN
                                <ArrowRight className="w-4 h-4" />
                            </button>

                            <div className="relative py-2">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-white/10"></div>
                                </div>
                                <div className="relative flex justify-center text-[10px] uppercase tracking-widest">
                                    <span className="bg-[#121214] px-2 text-gray-500">Secure Authentication</span>
                                </div>
                            </div>

                            <button
                                type="button"
                                onClick={handlePasskeyLogin}
                                disabled={isPasskeyAuth}
                                className="w-full bg-white/5 hover:bg-white/10 text-white font-medium py-3 rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                                <Fingerprint className="w-5 h-5 text-blue-400" />
                                {isPasskeyAuth ? "Authenticating..." : "Sign in with Passkey"}
                            </button>
                        </div>
                    </form>
                ) : (
                    <form onSubmit={handleTotpVerify} className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="text-center space-y-2 mb-4">
                            <div className="p-3 bg-gold-500/10 rounded-full w-fit mx-auto">
                                <Smartphone className="w-8 h-8 text-gold-500" />
                            </div>
                            <h2 className="text-xl font-bold text-white uppercase tracking-wider">Multi-Factor Auth</h2>
                            <p className="text-xs text-gray-400">Enter the 6-digit code from your authenticator app.</p>
                        </div>

                        <div>
                            <input
                                type="text"
                                value={totpToken}
                                onChange={(e) => setTotpToken(e.target.value)}
                                className="w-full bg-white/5 border border-white/20 rounded-xl py-4 text-3xl text-center font-mono tracking-[0.5em] text-white focus:border-gold-500 focus:outline-none transition-all"
                                placeholder="000000"
                                maxLength={6}
                                autoFocus
                                required
                            />
                        </div>

                        {error && (
                            <div className="flex items-center gap-2 text-red-500 text-sm bg-red-500/10 p-3 rounded-lg">
                                <AlertCircle className="w-4 h-4" />
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            className="w-full bg-gold-500 hover:bg-gold-400 text-black font-bold py-4 rounded-xl transition-all duration-300 flex items-center justify-center gap-2"
                        >
                            <ShieldCheck className="w-5 h-5" />
                            VERIFY CODE
                        </button>

                        <button
                            type="button"
                            onClick={() => setStep("login")}
                            className="w-full text-gray-500 text-xs hover:text-white transition-colors flex items-center justify-center gap-1 uppercase tracking-widest"
                        >
                            Back to Login
                        </button>
                    </form>
                )}

                <div className="text-center text-[10px] text-gray-600 mt-6 font-mono space-y-2">
                    <p>TEST ACCESS: testluke@luke.com / testluke1313</p>
                    <Link href="/admin" className="inline-flex items-center gap-1 hover:text-gold-500/50 transition-colors">
                        <LayoutDashboard className="w-3 h-3" />
                        ADMIN DASHBOARD
                    </Link>
                </div>
            </div>
        </div>
    );
}
