/** @type {import('next').NextConfig} */
const nextConfig = {
    // Next 16 requires an explicit Turbopack config when a legacy webpack
    // hook is present; older pinned Next versions ignore this empty option.
    turbopack: {},
    webpack: (config) => {
        config.resolve.alias = {
            ...config.resolve.alias,
            "@react-native-async-storage/async-storage": false,
        };
        return config;
    },
};

export default nextConfig;
