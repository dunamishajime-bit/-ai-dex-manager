import React, { useEffect, useRef } from 'react';
import { useSimulation } from "@/context/SimulationContext";
import { fetchTokensByChain } from "@/lib/dex-service";

export const MarketWatcher: React.FC = () => {
    const { addDiscussion, unlockAchievement } = useSimulation();
    const lastCheckTime = useRef<number>(Date.now());
    const isInitialMount = useRef(true);

    useEffect(() => {
        const checkInterval = setInterval(async () => {
            const now = Date.now();
            // Check every 60 seconds
            if (now - lastCheckTime.current > 60000) {
                lastCheckTime.current = now;

                try {
                    // Fetch top 50 tokens
                    const tokens = await fetchTokensByChain("all", 1);
                    const alerts: string[] = [];

                    tokens.forEach((coin: any) => {
                        // Check for significant 24h change as a proxy for "sudden move" in this demo
                        // In a real app, we would track minute-by-minute local state changes.
                        // Here we just alert if 24h change is extreme (> 10% or < -10%)

                        // To avoid spam, we might only check top 10?
                        // Let's just pick one random "Startling" event to simulate AI noticing something
                        // if we haven't alerted recently.
                    });

                    // For demo purposes, we will just log high volatility items
                    const volatile = tokens.filter((t: any) => Math.abs(t.price_change_percentage_24h) > 10);

                    if (volatile.length > 0) {
                        const target = volatile[0];
                        console.log(`[AI Market Watcher]Alert: ${target.symbol} is moving fast!(${target.price_change_percentage_24h} %)`);
                        unlockAchievement("market-watcher");
                    }

                } catch (e) {
                    console.error("MarketWatcher failed to fetch", e);
                }
            }
        }, 10000); // Check loop

        return () => clearInterval(checkInterval);
    }, []);

    return null;
};
