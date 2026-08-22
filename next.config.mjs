/** @type {import('next').NextConfig} */
const nextConfig = {
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
