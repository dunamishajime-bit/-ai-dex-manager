"use client";

import { useState, useEffect } from "react";
import { Lock, Cpu, Mail, User, Eye, EyeOff, ArrowRight, UserPlus, ArrowLeft, Shield, KeyRound, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { isRegistrationDisabled } from "@/lib/user-store";

type PageMode = "login" | "register" | "verify2fa" | "forgot";

export function LoginPage() {
    const { login, register, verify2FA, pending2FAEmail, pending2FACode } = useAuth();

    const [mode, setMode] = useState<PageMode>("login");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [nickname, setNickname] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [verifyCode, setVerifyCode] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [successMsg, setSuccessMsg] = useState("");
    const [displayCode, setDisplayCode] = useState<string | null>(null);

    // Forgot password states
    const [forgotStep, setForgotStep] = useState<1 | 2 | 3>(1);
    const [forgotEmail, setForgotEmail] = useState("");
    const [forgotCode, setForgotCode] = useState("");
    const [generatedForgotCode, setGeneratedForgotCode] = useState("");
    const [newPassword, setNewPassword] = useState("");
    const [forgotMessage, setForgotMessage] = useState("");

    const [mounted, setMounted] = useState(false);
    const [isTransitioning, setIsTransitioning] = useState(false);
    const [transitionProgress, setTransitionProgress] = useState(0);
    const [registrationDisabled, setRegistrationDisabled] = useState(false);

    useEffect(() => {
        setMounted(true);
        setRegistrationDisabled(isRegistrationDisabled());
    }, []);

    // Transition effect
    useEffect(() => {
        if (isTransitioning) {
            const interval = setInterval(() => {
                setTransitionProgress(prev => {
                    if (prev >= 100) {
                        clearInterval(interval);
                        return 100;
                    }
                    return prev + 2;
                });
            }, 30);
            return () => clearInterval(interval);
        }
    }, [isTransitioning]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const result = await login(email, password);
        if (result.requires2FA) {
            setMode("verify2fa");
            // Demo code display removed
        } else if (!result.success) {
            setError(result.error || "ログインに失敗しました");
        }
        setLoading(false);
    };

    const handleRegister = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const result = await register(email, password, nickname);
        if (result.success) {
            setMode("verify2fa");
            // Demo code display removed
            setSuccessMsg("登録完了！メールに送信された認証コードを入力してください。");
        } else {
            setError(result.error || "登録に失敗しました");
        }
        setLoading(false);
    };

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        const result = await verify2FA(verifyCode);
        if (result.success) {
            setIsTransitioning(true);
            // Result success triggers global auth state change
        } else {
            setError(result.error || "認証に失敗しました");
            setLoading(false);
        }
    };

    const handleForgotSendCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        if (!forgotEmail.includes("@")) {
            setForgotMessage("有効なメールアドレスを入力してください");
            return;
        }

        setLoading(true);
        try {
            const res = await fetch("/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: forgotEmail })
            });
            const data = await res.json();

            if (data.success) {
                setForgotMessage("再設定用のメールを送信しました。メール内のリンクを確認してください。");
                // In demo mode, the code might still be returned or simulated
                if (data.simulated) {
                    setForgotMessage("【シミュレーション】再設定メール送信を模倣しました。実際のメールは送信されません。");
                }
            } else {
                setForgotMessage(data.error || "送信に失敗しました");
            }
        } catch (err) {
            setForgotMessage("通信エラーが発生しました");
        }
        setLoading(false);
    };

    const handleForgotVerifyCode = (e: React.FormEvent) => {
        e.preventDefault();
        if (forgotCode === generatedForgotCode) {
            setForgotMessage("");
            setForgotStep(3);
        } else {
            setForgotMessage("確認コードが一致しません");
        }
    };

    const handleResetPassword = (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            setForgotMessage("パスワードは6文字以上にしてください");
            return;
        }
        setForgotMessage("パスワードが正常にリセットされました！");
        setTimeout(() => {
            setMode("login");
            setForgotStep(1);
            setForgotEmail("");
            setForgotCode("");
            setNewPassword("");
            setForgotMessage("");
        }, 2000);
    };

    if (!mounted) return null;

    return (
        <div className="min-h-screen flex items-center justify-center bg-cyber-black relative overflow-hidden">
            {/* Background Image Overlay with Gradients */}
            <div className="absolute inset-0 z-0">
                <img
                    src="/backgrounds/login_bg.png"
                    alt="background"
                    className="w-full h-full object-cover opacity-60 transition-opacity duration-1000"
                    style={{ filter: 'brightness(0.35) contrast(1.1) saturate(1.2)' }}
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '0';
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black" />
                <div className="absolute inset-0 bg-gradient-to-tr from-gold-900/10 via-transparent to-gold-900/5 opacity-40 mix-blend-overlay" />
            </div>

            {/* Background Grids */}
            <div className="absolute inset-0 bg-grid-gold opacity-[0.05] pointer-events-none"></div>
            <div className="absolute inset-0 bg-gradient-radial from-gold-500/5 to-transparent opacity-30 pointer-events-none"></div>

            {/* Scanning line effect */}
            <div className="absolute inset-0 bg-scanlines opacity-[0.03] pointer-events-none shadow-inner animate-pulse"></div>

            {/* Transition Overlay */}
            {isTransitioning && (
                <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-6">
                    <div className="absolute inset-0 bg-grid-gold opacity-10 animate-pulse pointer-events-none" />
                    <div className="absolute inset-0 bg-scanlines pointer-events-none" />

                    <div className="w-full max-w-sm relative">
                        {/* Status lines */}
                        <div className="mb-8 font-mono text-[10px] text-gold-500/60 flex flex-col gap-1">
                            <div className="flex justify-between">
                                <span>INITIALIZING NEURAL LINK...</span>
                                <span>OK</span>
                            </div>
                            <div className="flex justify-between">
                                <span>ESTABLISHING SECURE PROTOCOL...</span>
                                <span>OK</span>
                            </div>
                            <div className="flex justify-between">
                                <span>SYNCING AGENT COHORTS...</span>
                                <span className="animate-pulse">LOADING</span>
                            </div>
                        </div>

                        {/* Title */}
                        <h2 className="text-2xl font-bold text-white mb-2 tracking-widest text-center animate-glitch">
                            ACCESS GRANTED
                        </h2>
                        <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden mb-6 border border-gold-500/20 shadow-[0_0_10px_rgba(255,215,0,0.2)]">
                            <div
                                className="h-full bg-gradient-to-r from-gold-600 via-gold-400 to-gold-600 transition-all duration-300 ease-out shadow-[0_0_15px_rgba(255,215,0,0.5)]"
                                style={{ width: `${transitionProgress}%` }}
                            />
                        </div>

                        {/* Animated Message */}
                        <p className="text-center font-mono text-xs text-gold-500 animate-pulse-slow tracking-widest uppercase">
                            {transitionProgress < 30 && "Decrypting data streams..."}
                            {transitionProgress >= 30 && transitionProgress < 60 && "Verifying biometric hash..."}
                            {transitionProgress >= 60 && transitionProgress < 90 && "Initializing AI core..."}
                            {transitionProgress >= 90 && "Welcome back."}
                        </p>

                        {/* Background Decoration */}
                        <div className="absolute -inset-10 bg-gold-500/5 rounded-full blur-[100px] -z-10 animate-pulse" />
                    </div>
                </div>
            )}

            <div className="z-10 w-full max-w-md p-8 glass-panel rounded-xl border border-gold-500/30 relative group shadow-[0_0_40px_rgba(255,215,0,0.1)]">
                {/* Decorative gold corners */}
                <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-gold-500"></div>
                <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-gold-500"></div>
                <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-gold-500"></div>
                <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-gold-500"></div>

                {/* Logo */}
                <div className="flex flex-col items-center mb-8">
                    <div className="w-16 h-16 bg-gold-500/10 rounded-full flex items-center justify-center mb-4 border border-gold-500/30 shadow-[0_0_25px_rgba(255,215,0,0.4)] animate-pulse">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-gold-500 to-gold-600 flex items-center justify-center text-black font-bold text-lg">
                            Dis
                        </div>
                    </div>
                    <h1 className="text-3xl font-bold tracking-wider bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(255,215,0,0.3)]">
                        DIS-DEX
                    </h1>
                    <p className="text-xs text-gold-400/60 mt-2 font-mono tracking-widest">
                        {mode === "login" ? "SECURE ACCESS TERMINAL" :
                            mode === "register" ? "NEW ACCOUNT REGISTRATION" :
                                mode === "verify2fa" ? "TWO-FACTOR AUTHENTICATION" :
                                    "PASSWORD RECOVERY"}
                    </p>
                </div>

                {/* ============ LOGIN MODE ============ */}
                {mode === "login" && (
                    <>
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">
                                    Email
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 focus:shadow-[0_0_10px_rgba(255,215,0,0.2)] transition-all font-mono placeholder-gray-700 text-sm"
                                        placeholder="user@example.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">
                                    Password
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 focus:shadow-[0_0_10px_rgba(255,215,0,0.2)] transition-all font-mono placeholder-gray-700 text-sm"
                                        placeholder="••••••••"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gold-500/50 hover:text-gold-500"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="text-red-500 text-xs font-mono bg-red-500/10 p-2 rounded border border-red-500/20 text-center">
                                    ⚠ {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full py-3 px-4 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/50 text-gold-400 font-mono text-sm tracking-widest uppercase transition-all duration-300 relative overflow-hidden rounded group ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    {loading ? (
                                        <div className="w-4 h-4 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin" />
                                    ) : (
                                        <ArrowRight className="w-4 h-4" />
                                    )}
                                    {loading ? "AUTHENTICATING..." : "ログイン"}
                                </span>
                                <div className="absolute inset-0 bg-gold-500/10 transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300"></div>
                            </button>
                        </form>

                        {/* Register Button */}
                        {!registrationDisabled && (
                            <div className="mt-4">
                                <button
                                    onClick={() => { setMode("register"); setError(""); }}
                                    className="w-full py-3 px-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-mono text-sm tracking-widest uppercase transition-all duration-300 rounded flex items-center justify-center gap-2"
                                >
                                    <UserPlus className="w-4 h-4" />
                                    新規会員登録
                                </button>
                            </div>
                        )}

                        <div className="mt-4 text-center">
                            <button
                                onClick={() => { setMode("forgot"); setError(""); }}
                                className="text-xs text-gold-500/50 hover:text-gold-400 font-mono transition-colors underline underline-offset-4"
                            >
                                パスワードを忘れた場合
                            </button>
                        </div>

                        <div className="mt-4 text-center">
                            <a
                                href="/admin"
                                className="text-[10px] text-gray-600 hover:text-red-400 font-mono transition-colors underline underline-offset-4"
                            >
                                管理者ログイン →
                            </a>
                        </div>
                    </>
                )}

                {/* ============ REGISTER MODE ============ */}
                {mode === "register" && (
                    <>
                        <form onSubmit={handleRegister} className="space-y-4">
                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">
                                    メールアドレス
                                </label>
                                <div className="relative">
                                    <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 font-mono placeholder-gray-700 text-sm"
                                        placeholder="user@example.com"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">
                                    ニックネーム
                                </label>
                                <div className="relative">
                                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type="text"
                                        value={nickname}
                                        onChange={(e) => setNickname(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 font-mono placeholder-gray-700 text-sm"
                                        placeholder="あなたのニックネーム"
                                        required
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-mono text-gold-500 mb-2 uppercase tracking-wider">
                                    パスワード（6文字以上）
                                </label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gold-500/50" />
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-black/50 border border-gold-500/20 rounded px-10 py-3 text-white focus:outline-none focus:border-gold-500 font-mono placeholder-gray-700 text-sm"
                                        placeholder="••••••••"
                                        required
                                        minLength={6}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gold-500/50 hover:text-gold-500"
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <div className="text-red-500 text-xs font-mono bg-red-500/10 p-2 rounded border border-red-500/20 text-center">
                                    ⚠ {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full py-3 px-4 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-mono text-sm tracking-widest uppercase transition-all duration-300 rounded flex items-center justify-center gap-2 ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {loading ? (
                                    <div className="w-4 h-4 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
                                ) : (
                                    <UserPlus className="w-4 h-4" />
                                )}
                                {loading ? "登録中..." : "アカウント作成"}
                            </button>
                        </form>

                        <button
                            onClick={() => { setMode("login"); setError(""); }}
                            className="w-full mt-4 text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors text-center flex items-center justify-center gap-1"
                        >
                            <ArrowLeft className="w-3 h-3" />
                            ログイン画面に戻る
                        </button>
                    </>
                )}

                {/* ============ 2FA VERIFY MODE ============ */}
                {mode === "verify2fa" && (
                    <>
                        <div className="text-center mb-4">
                            <div className="w-16 h-16 mx-auto mb-3 bg-gold-500/10 rounded-full flex items-center justify-center border border-gold-500/30">
                                <KeyRound className="w-8 h-8 text-gold-400" />
                            </div>
                            <p className="text-sm text-gray-400 mb-2">
                                <span className="text-gold-400">{pending2FAEmail}</span> に認証コードを送信しました
                            </p>
                            <p className="text-xs text-gray-500">4桁の認証コードを入力してください</p>
                        </div>

                        {/* Show code for demo has been removed */}

                        {successMsg && (
                            <div className="mb-4 text-emerald-400 text-xs font-mono bg-emerald-500/10 p-2 rounded border border-emerald-500/20 text-center">
                                ✅ {successMsg}
                            </div>
                        )}

                        <form onSubmit={handleVerify} className="space-y-4">
                            <div className="flex justify-center">
                                <input
                                    type="text"
                                    value={verifyCode}
                                    onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                    className="w-48 bg-black/50 border border-gold-500/30 rounded-lg px-4 py-4 text-white text-center text-3xl font-mono tracking-[0.5em] focus:outline-none focus:border-gold-500 focus:shadow-[0_0_15px_rgba(255,215,0,0.3)] transition-all"
                                    placeholder="0000"
                                    maxLength={4}
                                    autoFocus
                                />
                            </div>

                            {error && (
                                <div className="text-red-500 text-xs font-mono bg-red-500/10 p-2 rounded border border-red-500/20 text-center">
                                    ⚠ {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading || verifyCode.length !== 4}
                                className={`w-full py-3 px-4 bg-gold-500/10 hover:bg-gold-500/20 border border-gold-500/50 text-gold-400 font-mono text-sm tracking-widest uppercase transition-all duration-300 rounded flex items-center justify-center gap-2 ${(loading || verifyCode.length !== 4) ? 'opacity-50 cursor-not-allowed' : ''}`}
                            >
                                {loading ? (
                                    <div className="w-4 h-4 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin" />
                                ) : (
                                    <Shield className="w-4 h-4" />
                                )}
                                {loading ? "認証中..." : "認証する"}
                            </button>
                        </form>

                        <div className="mt-4 text-center">
                            <button
                                onClick={async () => {
                                    if (pending2FAEmail) {
                                        setError("");
                                        setSuccessMsg("コードを再送信しています...");
                                        // Re-trigger login to resend code (simplest way given current context)
                                        // In a real app, separate resend API is better, but login handles it here.
                                        await login(pending2FAEmail, password);
                                        setSuccessMsg("コードを再送信しました！");
                                    }
                                }}
                                className="text-xs text-gold-500/60 hover:text-gold-400 font-mono flex items-center justify-center gap-1 mx-auto transition-colors"
                            >
                                <RefreshCw className="w-3 h-3" />
                                コードを再送信
                            </button>
                        </div>

                        <button
                            onClick={() => { setMode("login"); setError(""); setVerifyCode(""); setDisplayCode(null); setSuccessMsg(""); }}
                            className="w-full mt-4 text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors text-center flex items-center justify-center gap-1"
                        >
                            <ArrowLeft className="w-3 h-3" />
                            ログイン画面に戻る
                        </button>
                    </>
                )}

                {/* ============ FORGOT PASSWORD MODE ============ */}
                {mode === "forgot" && (
                    <div className="space-y-6">
                        <div className="text-center mb-4">
                            <h2 className="text-lg font-bold text-gold-400 font-mono">PASSWORD RECOVERY</h2>
                            <p className="text-xs text-gray-500 mt-1">
                                {forgotStep === 1 && "登録メールアドレスを入力してください"}
                                {forgotStep === 2 && "確認コードを入力してください"}
                                {forgotStep === 3 && "新しいパスワードを設定してください"}
                            </p>
                            <div className="flex justify-center gap-2 mt-3">
                                {[1, 2, 3].map(s => (
                                    <div key={s} className={`w-8 h-1 rounded ${s <= forgotStep ? 'bg-gold-500' : 'bg-white/10'}`} />
                                ))}
                            </div>
                        </div>

                        {forgotStep === 1 && (
                            <form onSubmit={handleForgotSendCode} className="space-y-4">
                                <input
                                    type="email"
                                    value={forgotEmail}
                                    onChange={(e) => setForgotEmail(e.target.value)}
                                    className="w-full bg-black/50 border border-gold-500/20 rounded px-4 py-3 text-white focus:outline-none focus:border-gold-500 font-mono placeholder-gray-700 text-sm"
                                    placeholder="user@example.com"
                                />
                                <button type="submit" className="w-full py-3 bg-gold-500/10 border border-gold-500/50 text-gold-400 font-mono text-sm rounded hover:bg-gold-500/20 transition-colors">
                                    確認コード送信
                                </button>
                            </form>
                        )}

                        {forgotStep === 2 && (
                            <form onSubmit={handleForgotVerifyCode} className="space-y-4">
                                <input
                                    type="text"
                                    value={forgotCode}
                                    onChange={(e) => setForgotCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                                    className="w-full bg-black/50 border border-gold-500/20 rounded px-4 py-3 text-white focus:outline-none focus:border-gold-500 font-mono placeholder-gray-700 text-sm text-center tracking-[0.5em]"
                                    placeholder="0000"
                                    maxLength={4}
                                />
                                <button type="submit" className="w-full py-3 bg-gold-500/10 border border-gold-500/50 text-gold-400 font-mono text-sm rounded hover:bg-gold-500/20 transition-colors">
                                    コード確認
                                </button>
                            </form>
                        )}

                        {forgotStep === 3 && (
                            <form onSubmit={handleResetPassword} className="space-y-4">
                                <input
                                    type="password"
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full bg-black/50 border border-gold-500/20 rounded px-4 py-3 text-white focus:outline-none focus:border-gold-500 font-mono placeholder-gray-700 text-sm"
                                    placeholder="新しいパスワード（6文字以上）"
                                />
                                <button type="submit" className="w-full py-3 bg-gold-500/10 border border-gold-500/50 text-gold-400 font-mono text-sm rounded hover:bg-gold-500/20 transition-colors">
                                    パスワードリセット
                                </button>
                            </form>
                        )}

                        {forgotMessage && (
                            <div className={`text-xs font-mono p-2 rounded text-center border ${forgotMessage.includes("送信") || forgotMessage.includes("正常") ? 'bg-gold-500/10 border-gold-500/20 text-gold-400' : 'bg-red-500/10 border-red-500/20 text-red-400'}`}>
                                {forgotMessage}
                            </div>
                        )}

                        <button
                            onClick={() => { setMode("login"); setForgotStep(1); setForgotMessage(""); }}
                            className="w-full text-xs text-gray-500 hover:text-gray-300 font-mono transition-colors text-center flex items-center justify-center gap-1"
                        >
                            <ArrowLeft className="w-3 h-3" />
                            ログイン画面に戻る
                        </button>
                    </div>
                )}

                <div className="mt-6 text-center">
                    <p className="text-[10px] text-gray-600 font-mono">
                        SYSTEM VERSION 5.0.0<br />
                        DIS-DEX TRACKER | AUTHORIZED PERSONNEL ONLY
                    </p>
                </div>
            </div>
        </div>
    );
}
