"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { PriceChart } from "./PriceChart";
import { useSimulation } from "@/context/SimulationContext";

const TERMINAL_PAIR_BY_SYMBOL: Record<string, string> = {
    BTC: "BTC/USDT",
    ETH: "ETH/USDT",
    SOL: "SOL/USDT",
    BNB: "BNB/USDT",
    MATIC: "POL/USDT",
    DOGE: "DOGE/USDT",
    LINK: "LINK/USDT",
    SHIB: "SHIB/USDT",
};

export function TerminalView() {
    const { marketData, selectedCurrency } = useSimulation();
    const defaultPairLabel = useMemo(
        () => TERMINAL_PAIR_BY_SYMBOL[selectedCurrency] || "BNB/USDT",
        [selectedCurrency],
    );
    const [activePairLabel, setActivePairLabel] = useState(defaultPairLabel);

    useEffect(() => {
        setActivePairLabel(defaultPairLabel);
    }, [defaultPairLabel]);

    return (
        <Card
            title={`${activePairLabel} Terminal`}
            glow={marketData.trend === "BULL" ? "success" : "danger"}
            className="h-auto min-h-[500px] w-full overflow-hidden lg:h-[450px]"
        >
            <div className="mt-2 h-full">
                <div className="h-[420px] min-h-[320px] w-full">
                    <div className="h-full min-h-0">
                        <PriceChart
                            headless
                            initialPairLabel={activePairLabel}
                            onPairChange={setActivePairLabel}
                        />
                    </div>
                </div>
            </div>
        </Card>
    );
}
