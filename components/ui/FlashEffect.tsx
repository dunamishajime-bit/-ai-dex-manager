"use client";

import { useSimulation } from "@/context/SimulationContext";
import { useEffect, useState } from "react";

export function FlashEffect() {
    const { transactions, isFlashEnabled } = useSimulation();
    const [flash, setFlash] = useState(false);
    const [lastTxId, setLastTxId] = useState<string | null>(null);

    useEffect(() => {
        if (!isFlashEnabled) return;

        if (transactions.length > 0) {
            const latest = transactions[0];
            if (latest.id !== lastTxId) {
                setFlash(true);
                setLastTxId(latest.id);
                setTimeout(() => setFlash(false), 500);
            }
        }
    }, [transactions, lastTxId]);

    if (!flash) return null;

    return (
        <div className="fixed inset-0 z-50 pointer-events-none bg-gold-500/20 mix-blend-screen animate-flash" />
    );
}
