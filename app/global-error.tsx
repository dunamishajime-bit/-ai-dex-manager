"use client";

import { useEffect } from "react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error("[GlobalError]", error);
    }, [error]);

    return (
        <html lang="ja">
            <body className="min-h-screen bg-cyber-black text-white flex items-center justify-center p-6">
                <div className="max-w-md w-full bg-white/5 border border-gold-500/20 rounded-xl p-6 text-center">
                    <h1 className="text-lg font-bold text-gold-400 mb-2">DIS TERMINAL ERROR</h1>
                    <p className="text-sm text-gray-300 mb-4">ページ表示中にエラーが発生しました。</p>
                    <button
                        onClick={reset}
                        className="px-4 py-2 rounded-lg bg-gold-500 text-black font-bold hover:bg-gold-400 transition-colors"
                    >
                        再試行
                    </button>
                </div>
            </body>
        </html>
    );
}
