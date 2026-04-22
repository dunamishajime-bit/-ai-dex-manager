import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { metaMaskWallet } from '@rainbow-me/rainbowkit/wallets';
import { mainnet, arbitrum, base, bsc } from 'wagmi/chains';

import { http, fallback } from 'viem';

export const wagmiConfig = getDefaultConfig({
    appName: 'J-DEX MANAGER',
    projectId: '21fef48091f12692cad574a6f7753643', // Using a reliable public WC v2 project ID for testing so QR code modal loads correctly
    wallets: [
        {
            groupName: 'MetaMask',
            wallets: [metaMaskWallet],
        },
    ],
    chains: [bsc, mainnet, arbitrum, base],
    transports: {
        [bsc.id]: fallback([
            http('/api/rpcProxy?target=' + encodeURIComponent('https://bsc-dataseed.binance.org'), { timeout: 120000, retryCount: 5 }),
            http('/api/rpcProxy?target=' + encodeURIComponent('https://rpc.ankr.com/bsc'), { timeout: 120000, retryCount: 5 }),
        ], {
            rank: {
                interval: 30000,
                sampleCount: 10,
            },
        }),
        [mainnet.id]: http(),
        [arbitrum.id]: http(),
        [base.id]: http(),
    },
    ssr: true, // If your dApp uses server side rendering (SSR)
});
