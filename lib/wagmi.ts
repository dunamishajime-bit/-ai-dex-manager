import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { trustWallet, metaMaskWallet, rainbowWallet, walletConnectWallet, coinbaseWallet } from '@rainbow-me/rainbowkit/wallets';
import { mainnet, polygon, optimism, arbitrum, base, zora, bsc } from 'wagmi/chains';
// Note: 'solana' is not directly supported by Wagmi (EVM only). 
// For this demo, we will focus on EVM chains. Solana would need a separate adapter (e.g. solana-wallet-adapter).
// We will simulate Solana support or use a multi-chain wrapper if needed, but for now standard EVM.

export const wagmiConfig = getDefaultConfig({
    appName: 'J-DEX MANAGER',
    projectId: '21fef48091f12692cad574a6f7753643', // Using a reliable public WC v2 project ID for testing so QR code modal loads correctly
    wallets: [
        {
            groupName: 'Recommended',
            wallets: [trustWallet, metaMaskWallet, rainbowWallet, walletConnectWallet, coinbaseWallet],
        },
    ],
    chains: [bsc, polygon, mainnet, arbitrum, base],
    ssr: true, // If your dApp uses server side rendering (SSR)
});
