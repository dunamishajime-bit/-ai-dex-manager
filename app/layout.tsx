import type { Metadata, Viewport } from "next";
import { Inter, Roboto_Mono } from "next/font/google";
import "./globals.css";
import LayoutClient from "./LayoutClient";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const robotoMono = Roboto_Mono({ subsets: ["latin"], variable: "--font-roboto-mono" });

export const metadata: Metadata = {
    title: "DIS TERMINAL",
    description: "DIS TERMINAL - AIエージェントによる自律売買DEXトレーディングプラットフォーム",
    robots: {
        index: false,
        follow: false,
    },
    manifest: "/manifest.webmanifest",
    icons: {
        icon: "/favicon.ico",
        apple: "/icon-192.png",
    },
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: "DIS TERMINAL",
    },
    other: {
        "mobile-web-app-capable": "yes",
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    maximumScale: 1,
    userScalable: false,
    themeColor: "#000000",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="ja" className={`${inter.variable} ${robotoMono.variable}`} suppressHydrationWarning>
            <body className={`${inter.className} antialiased bg-cyber-black`}>
                <LayoutClient>{children}</LayoutClient>
                <div className="cyber-overlay" />
            </body>
        </html>
    );
}
