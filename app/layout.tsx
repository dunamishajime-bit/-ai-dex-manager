"use client";

import { Inter, Roboto_Mono } from 'next/font/google';
import './globals.css';
import { SimulationProvider } from '@/context/SimulationContext';
import { FlashEffect } from '@/components/ui/FlashEffect';
import { Web3Provider } from '@/context/Web3Context';
import { AgentProvider } from '@/context/AgentContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { Sidebar } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { TradeNotificationToast } from '@/components/features/TradeNotificationToast';
import { TradingPipelineManager } from "@/components/features/TradingPipelineManager";
import { useSimulation } from '@/context/SimulationContext';
import ParticleBackground from '@/components/layout/ParticleBackground';
import { BottomNav } from '@/components/layout/BottomNav';

import { LoginPage } from '@/components/features/LoginPage';
import { TutorialPopup } from '@/components/features/TutorialPopup';
import { AgentTicker } from '@/components/features/AgentTicker';
import LearningIndicator from '@/components/features/LearningIndicator';
import { usePathname } from 'next/navigation';
import { UserLearningProvider } from '@/context/UserLearningContext';
import { CurrencyProvider } from '@/context/CurrencyContext';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const robotoMono = Roboto_Mono({ subsets: ['latin'], variable: '--font-roboto-mono' });

const PUBLIC_PATHS = ['/reset-password', '/login', '/register'];

function AuthGuard({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading, user } = useAuth();
    const pathname = usePathname();

    // Don't guard admin page
    if (pathname === '/admin') {
        return <>{children}</>;
    }

    // Don't guard public paths
    if (PUBLIC_PATHS.some(path => pathname?.startsWith(path))) {
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

    const isAdmin = pathname === '/admin';
    const isPublicPath = PUBLIC_PATHS.some(path => pathname?.startsWith(path));

    if (!isAuthenticated && !isAdmin && !isPublicPath) {
        return <AuthGuard>{children}</AuthGuard>;
    }

    // specific layout for public paths? or just render children?
    // If public path, we might not want Sidebar/TopBar?
    // But login page is handled separately inside AuthGuard if not auth.
    // If we simply return children for public paths here, they won't get Sidebar/TopBar which is correct for Login/Reset.
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
                {/* Phase 7: Mobile bottom navigation */}
                <BottomNav />
            </div>
        </AuthGuard>
    );
}

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ja" className={`${inter.variable} ${robotoMono.variable}`}>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
                <title>DIS TERMINAL</title>
                <meta name="description" content="DIS TERMINAL - AIエージェントによる自律型DEXトレーディングプラットフォーム" />
                <meta name="robots" content="noindex, nofollow" />
                {/* Phase 7: PWA Meta Tags */}
                <link rel="manifest" href="/manifest.webmanifest" />
                <link rel="icon" href="/favicon.ico" />
                <link rel="apple-touch-icon" href="/icon-192.png" />
                <meta name="theme-color" content="#000000" />
                <meta name="apple-mobile-web-app-capable" content="yes" />
                <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
                <meta name="apple-mobile-web-app-title" content="DIS TERMINAL" />
                <script dangerouslySetInnerHTML={{
                    __html: `
                    if ('serviceWorker' in navigator) {
                        window.addEventListener('load', function() {
                            navigator.serviceWorker.register('/sw.js').catch(function(err) {
                                console.log('SW registration failed:', err);
                            });
                        });
                    }
                ` }} />
            </head>
            <body className={`${inter.className} antialiased bg-cyber-black`}>
                <AuthProvider>
                    <Web3Provider>
                        <AgentProvider>
                            <CurrencyProvider>
                                <SimulationProvider>
                                    <UserLearningProvider>
                                        <ParticleBackground />
                                        <AppLayout>
                                            {children}
                                        </AppLayout>
                                    </UserLearningProvider>
                                </SimulationProvider>
                            </CurrencyProvider>
                        </AgentProvider>
                    </Web3Provider>
                </AuthProvider>
                <div className="cyber-overlay" />
            </body>
        </html>
    );
}
