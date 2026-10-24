/** @type {import('next').NextConfig} */
const nextConfig = {
    // Build a portable Linux standalone artifact only in isolated VPS staging.
    // Local validation and all normal builds retain their previous behavior.
    ...(process.env.DISDEX_UI_VPS_STANDALONE === "1"
        ? { output: "standalone", experimental: { cpus: 2 } }
        : {}),
    // The production VPS is memory-constrained. Its verified release path
    // performs the repository typecheck separately, so skip Next's duplicate
    // checker only when that release path explicitly opts in.
    typescript: {
        ignoreBuildErrors: process.env.DISDEX_UI_VERIFIED_TSC === "1",
    },
    webpack: (config) => {
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
