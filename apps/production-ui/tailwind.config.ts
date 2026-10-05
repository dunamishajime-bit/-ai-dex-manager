import type { Config } from "tailwindcss";

const config: Config = {
    content: [
        "./pages/**/*.{js,ts,jsx,tsx,mdx}",
        "./components/**/*.{js,ts,jsx,tsx,mdx}",
        "./app/**/*.{js,ts,jsx,tsx,mdx}",
    ],
    theme: {
        extend: {
            colors: {
                primary: "var(--color-primary)",
                secondary: "var(--color-secondary)",
                success: "var(--color-success)",
                danger: "var(--color-danger)",
                warning: "var(--color-warning)",
                background: "var(--background)",
                foreground: "var(--foreground)",
                "cyber-black": "#050505",
                "cyber-gray": "#1a1a1a",
                "glass": "rgba(255, 255, 255, 0.05)",
                "gold-100": "#FFF9E6",
                "gold-200": "#FFF4BD",
                "gold-300": "#FFE880",
                "gold-400": "#FFE135",
                "gold-500": "#FFD700",
                "gold-600": "#B8860B",
                "gold-700": "#8B6914",
                "gold-800": "#5C4600",
            },
            fontFamily: {
                sans: ['Inter', 'Noto Sans JP', 'sans-serif'],
                mono: ['JetBrains Mono', 'Share Tech Mono', 'monospace'],
            },
            backgroundImage: {
                "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
                "gradient-conic":
                    "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
                'grid-pattern': "linear-gradient(to right, #1a1a1a 1px, transparent 1px), linear-gradient(to bottom, #1a1a1a 1px, transparent 1px)",
            },
            animation: {
                flash: 'flash 0.5s ease-in-out',
                scanline: 'scanline 2s linear infinite',
            },
            keyframes: {
                flash: {
                    '0%, 100%': { opacity: '0' },
                    '50%': { opacity: '0.8' },
                },
                scanline: {
                    '0%': { top: '0%' },
                    '100%': { top: '100%' },
                }
            },
        },
    },
    plugins: [],
};
export default config;
