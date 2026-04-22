"use client";

import "./globals.css";
import { usePathname } from "next/navigation";

import { SimulationProvider } from "@/context/SimulationContext";
import { FlashEffect } from "@/components/ui/FlashEffect";
import { Web3Provider } from "@/context/Web3Context";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { TradeNotificationToast } from "@/components/features/TradeNotificationToast";
import ParticleBackground from "@/components/layout/ParticleBackground";
import { BottomNav } from "@/components/layout/BottomNav";
import { LoginPage } from "@/components/features/LoginPage";
import LearningIndicator from "@/components/features/LearningIndicator";
import { CurrencyProvider } from "@/context/CurrencyContext";
import {
  PUBLIC_ADMIN_ENABLED,
  PUBLIC_REGISTER_ENABLED,
  PUBLIC_RESET_PASSWORD_ENABLED,
  SITE_BRAND_NAME,
} from "@/lib/site-access";

const PUBLIC_PATHS = [
  "/login",
  ...(PUBLIC_RESET_PASSWORD_ENABLED ? ["/reset-password"] : []),
  ...(PUBLIC_REGISTER_ENABLED ? ["/register"] : []),
];

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const pathname = usePathname();

  if (pathname === "/admin" && PUBLIC_ADMIN_ENABLED) {
    return <>{children}</>;
  }

  if (PUBLIC_PATHS.some((path) => pathname?.startsWith(path))) {
    return <>{children}</>;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cyber-black">
        <div className="flex flex-col items-center gap-4">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-gold-500/30 border-t-gold-500" />
          <p className="font-mono text-sm text-gold-400">{SITE_BRAND_NAME} Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const pathname = usePathname();

  const isAdmin = pathname === "/admin" && PUBLIC_ADMIN_ENABLED;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname?.startsWith(path));

  if (!isAuthenticated && !isAdmin && !isPublicPath) {
    return <AuthGuard>{children}</AuthGuard>;
  }

  if (isPublicPath) {
    return <AuthGuard>{children}</AuthGuard>;
  }

  return (
    <AuthGuard>
      <div className="flex h-screen overflow-hidden bg-cyber-black text-white">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopBar />
          <main className="custom-scrollbar flex-1 overflow-y-auto p-4 pb-16 md:p-6 md:pb-4">{children}</main>
        </div>
        <FlashEffect />
        <TradeNotificationToast />
        <LearningIndicator />
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
    <html lang="ja">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <title>{SITE_BRAND_NAME}</title>
        <meta name="description" content="個人用の運用状況とトレード履歴を確認するための非公開サイトです。" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="googlebot" content="noindex, nofollow, noarchive" />
        <meta name="bingbot" content="noindex, nofollow, noarchive" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <meta name="theme-color" content="#000000" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={SITE_BRAND_NAME} />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                if (!('serviceWorker' in navigator)) return;
                window.addEventListener('load', function() {
                  navigator.serviceWorker.getRegistrations()
                    .then(function(registrations) {
                      return Promise.all(registrations.map(function(registration) {
                        return registration.unregister();
                      }));
                    })
                    .then(function() {
                      if (!window.caches) return;
                      return caches.keys().then(function(keys) {
                        return Promise.all(keys.map(function(key) {
                          return caches.delete(key);
                        }));
                      });
                    })
                    .catch(function(err) {
                      console.log('SW cleanup failed:', err);
                    });
                });
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased bg-cyber-black">
        <AuthProvider>
          <Web3Provider>
            <CurrencyProvider>
              <SimulationProvider>
                <ParticleBackground />
                <AppLayout>{children}</AppLayout>
              </SimulationProvider>
            </CurrencyProvider>
          </Web3Provider>
        </AuthProvider>
        <div className="cyber-overlay" />
      </body>
    </html>
  );
}
