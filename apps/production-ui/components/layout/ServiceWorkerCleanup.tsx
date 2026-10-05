"use client";

import { useEffect } from "react";

export function ServiceWorkerCleanup() {
    useEffect(() => {
        if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

        const cleanup = async () => {
            try {
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));

                if (!("caches" in window)) return;
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
            } catch (error) {
                console.warn("[SW Cleanup] Failed:", error);
            }
        };

        void cleanup();

        return () => {
            // no-op
        };
    }, []);

    return null;
}
