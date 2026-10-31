import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    // Keep an isolated worktree/release from traversing sibling worktrees.
    outputFileTracingRoot: projectRoot,
    experimental: {
        // This UI release is built on memory-constrained hosts. Keep the
        // production bundle deterministic while reducing webpack peak RSS.
        webpackMemoryOptimizations: true,
        cpus: 1,
        workerThreads: true,
    },
    // The production VPS is memory-constrained. Its verified release path
    // performs the repository typecheck separately, so skip Next's duplicate
    // checker only when that release path explicitly opts in.
    typescript: {
        ignoreBuildErrors: process.env.DISDEX_UI_VERIFIED_TSC === "1",
    },
    async redirects() {
        return [
            { source: "/decision-status/zec", destination: "/decision-status", permanent: false },
            { source: "/history/zec", destination: "/history", permanent: false },
        ];
    },
    webpack: (config) => {
        config.parallelism = 1;
        config.resolve.alias = {
            ...config.resolve.alias,
            "@react-native-async-storage/async-storage": false,
        };
        config.ignoreWarnings = [
            ...(config.ignoreWarnings || []),
            {
                module: /node_modules[\\/]ox[\\/]_esm[\\/]tempo[\\/]internal[\\/]virtualMasterPool\.js/,
                message: /Critical dependency: the request of a dependency is an expression/,
            },
        ];
        return config;
    },
};

export default nextConfig;
