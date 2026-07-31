/** @type {import('next').NextConfig} */
const nextConfig = {
    // Keep production builds viable on the 2 GiB VPS without changing runtime trading code.
    experimental: {
        cpus: 1,
        webpackBuildWorker: true,
    },
    webpack: (config) => {
        config.resolve.alias = {
            ...config.resolve.alias,
            "@react-native-async-storage/async-storage": false,
        };
        return config;
    },
};

export default nextConfig;