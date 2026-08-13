/** @type {import('next').NextConfig} */
const nextConfig = {
    // The VPS runs the repository-wide `tsc --noEmit` gate before creating a
    // UI release.  On the 2 GiB host, having Next.js repeat that same checker
    // after webpack compilation can OOM before it writes the production
    // manifests.  This opt-in flag is only set by that verified release path;
    // ordinary local and CI builds continue to use Next's type checker.
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
