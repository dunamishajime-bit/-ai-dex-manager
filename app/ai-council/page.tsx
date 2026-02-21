"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AIDiscussionPanel } from "@/components/features/AIDiscussionPanel";

function AICouncilContent() {
    const searchParams = useSearchParams();
    const token = searchParams.get("token") || "ETH";
    const coinId = searchParams.get("id");
    const pair = `${token}/JPY`;

    return (
        <div className="h-full p-6">
            <AIDiscussionPanel pair={pair} coinId={coinId || undefined} autoStart={true} />
        </div>
    );
}

export default function AICouncilPage() {
    return (
        <Suspense fallback={<div className="text-gold-400 p-10">Loading...</div>}>
            <AICouncilContent />
        </Suspense>
    );
}
