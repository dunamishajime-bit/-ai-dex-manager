"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { PriceChart } from "./PriceChart";
import { TradingPipelineManager } from "./TradingPipelineManager";
import { useSimulation } from "@/context/SimulationContext";
import { useMediaQuery } from "@/hooks/use-media-query";

export function TerminalView() {
    const { marketData, selectedCurrency } = useSimulation();
    const isDesktop = useMediaQuery("(min-width: 1024px)");
    const coinIdBySymbol: Record<string, string> = {
        BTC: "bitcoin",
        ETH: "ethereum",
        SOL: "solana",
        BNB: "binance-coin",
        POL: "polygon",
        DOGE: "dogecoin",
        XRP: "xrp",
        ADA: "cardano",
        DOT: "polkadot",
        LINK: "chainlink",
        AVAX: "avalanche",
    };
    const initialCoinId = coinIdBySymbol[selectedCurrency] ?? "ethereum";

    return (
        <Card
            title={`${selectedCurrency}/USDC ターミナル`}
            glow={marketData.trend === "BULL" ? "success" : "danger"}
            className="w-full h-auto min-h-[500px] lg:h-[450px] overflow-hidden"
        >
            <div className="h-full flex flex-col lg:flex-row gap-4 mt-2">
                {/* Left Side: Trading Pipeline Manager */}
                <div className="w-full lg:w-[40%] h-[250px] lg:h-full">
                    <TradingPipelineManager />
                </div>

                {/* Right Side: Price Chart */}
                <div className="w-full lg:w-[60%] h-[300px] lg:h-full flex flex-col">
                    <div className="flex-1 min-h-0">
                        <PriceChart headless initialCoinId={initialCoinId} initialPairLabel={`${selectedCurrency}/USDC`} />
                    </div>
                </div>
            </div>
        </Card>
    );
}
