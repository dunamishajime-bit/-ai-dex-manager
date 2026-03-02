"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { SimulationProvider } from "@/context/SimulationContext";
import { FlashEffect } from "@/components/ui/FlashEffect";
import { Web3Provider } from "@/context/Web3Context";
import { AgentProvider } from "@/context/AgentContext";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TradeNotificationToast } from "@/components/features/TradeNotificationToast";
import ParticleBackground from "@/components/layout/ParticleBackground";
import { BottomNav } from "@/components/layout/BottomNav";
import { LoginPage } from "@/components/features/LoginPage";
import { TutorialPopup } from "@/components/features/TutorialPopup";
import LearningIndicator from "@/components/features/LearningIndicator";
import { UserLearningProvider } from "@/context/UserLearningContext";
import { CurrencyProvider } from "@/context/CurrencyContext";

const PUBLIC_PATHS = ["/reset-password", "/login", "/register"];

function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading } = useAuth();
    const pathname = usePathname();

    if (pathname === "/admin") {
        return <>{children}</>;
    }

    if (PUBLIC_PATHS.some((path) => pathname?.startsWith(path))) {
        return <>{children}</>;
    }

    if (isLoading) {
        return (
            <div className="min-h-screen bg-cyber-black flex items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin" />
                    <p className="text-gold-400 font-mono text-sm">DIS-DEX Loading...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return <LoginPage />;
    }

    return (
        <>
            {children}
            <TutorialPopup />
        </>
    );
}

function AppLayout({ children }: { children: React.ReactNode }) {
    const { isAuthenticated } = useAuth();
    const pathname = usePathname();

    const isAdmin = pathname === "/admin";
    const isPublicPath = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));

    if (!isAuthenticated && !isAdmin && !isPublicPath) {
        return <AuthGuard>{children}</AuthGuard>;
    }

    if (isPublicPath) {
        return <AuthGuard>{children}</AuthGuard>;
    }

    return (
        <AuthGuard>
            <div className="flex h-screen bg-cyber-black text-white overflow-hidden">
                <Sidebar />
                <div className="flex-1 flex flex-col overflow-hidden">
                    <TopBar />
                    <main className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar pb-16 md:pb-4">
                        {children}
                    </main>
                </div>
                <FlashEffect />
                <TradeNotificationToast />
                <LearningIndicator />
                <BottomNav />
            </div>
        </AuthGuard>
    );
}

function ServiceWorkerRegistrar() {
    useEffect(() => {
        if (!("serviceWorker" in navigator)) {
            return;
        }
        const onLoad = () => {
            navigator.serviceWorker.register("/sw.js").catch((err) => {
                console.log("SW registration failed:", err);
            });
        };
        window.addEventListener("load", onLoad);
        return () => window.removeEventListener("load", onLoad);
    }, []);

    return null;
}

export default function LayoutClient({ children }: { children: React.ReactNode }) {
    return (
        <AuthProvider>
            <Web3Provider>
                <AgentProvider>
                    <CurrencyProvider>
                        <SimulationProvider>
                            <UserLearningProvider>
                                <ServiceWorkerRegistrar />
                                <ParticleBackground />
                                <AppLayout>{children}</AppLayout>
                            </UserLearningProvider>
                        </SimulationProvider>
                    </CurrencyProvider>
                </AgentProvider>
            </Web3Provider>
        </AuthProvider>
    );
}
