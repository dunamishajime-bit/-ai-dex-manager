import { config as dotenvConfig } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';

dotenvConfig({ path: '.env.local' });

type CompiledContract = {
  abi: unknown[];
  bytecode: `0x${string}`;
};

const contractPath = path.join(process.cwd(), 'contracts', 'DisDexSafeModule.sol');

const rpcUrl = process.env.RPC_URL_BSC || process.env.RPC_URL || '';
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.EXECUTION_PRIVATE_KEY || '';
const safeAddress = process.env.SAFE_ADDRESS || '';
const ownerAddress = process.env.SAFE_OWNER_ADDRESS || process.env.LEDGER_OWNER_ADDRESS || '';
const traderAddress = process.env.SAFE_TRADER_ADDRESS || process.env.TRADER_ADDRESS || '';
const guardianAddress = process.env.SAFE_GUARDIAN_ADDRESS || process.env.GUARDIAN_ADDRESS || '0x0000000000000000000000000000000000000000';

function fail(message: string): never {
  console.error(`[deploy-safe-module] ${message}`);
  process.exit(1);
}

function readContractSource(): string {
  if (!fs.existsSync(contractPath)) {
    fail(`Contract file not found: ${contractPath}`);
  }
  return fs.readFileSync(contractPath, 'utf8');
}

function compileContract(source: string): CompiledContract {
  const input = {
    language: 'Solidity',
    sources: {
      'DisDexSafeModule.sol': {
        content: source,
      },
    },
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      outputSelection: {
        '*': {
          '*': ['abi', 'evm.bytecode.object'],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input)));

  if (Array.isArray(output.errors)) {
    const fatalErrors = output.errors.filter((entry: { severity?: string }) => entry.severity === 'error');
    for (const entry of output.errors) {
      console.log(`[solc] ${entry.severity || 'info'}: ${entry.formattedMessage || entry.message}`);
    }
    if (fatalErrors.length > 0) {
      fail('Solidity compilation failed.');
    }
  }

  const contract = output.contracts?.['DisDexSafeModule.sol']?.['DisDexSafeModule'];
  if (!contract) {
    fail('Compiled contract artifact not found.');
  }

  const abi = contract.abi as unknown[];
  const bytecode = contract.evm?.bytecode?.object as string | undefined;
  if (!bytecode) {
    fail('Compiled bytecode not found.');
  }

  return {
    abi,
    bytecode: `0x${bytecode}` as `0x${string}`,
  };
}

async function main() {
  if (!rpcUrl) fail('RPC_URL_BSC or RPC_URL is missing in .env.local');
  if (!deployerPrivateKey) fail('DEPLOYER_PRIVATE_KEY or EXECUTION_PRIVATE_KEY is missing in .env.local');
  if (!safeAddress) fail('SAFE_ADDRESS is missing in .env.local');
  if (!ownerAddress) fail('SAFE_OWNER_ADDRESS or LEDGER_OWNER_ADDRESS is missing in .env.local');
  if (!traderAddress) fail('SAFE_TRADER_ADDRESS or TRADER_ADDRESS is missing in .env.local');

  const source = readContractSource();
  const compiled = compileContract(source);

  const account = privateKeyToAccount(deployerPrivateKey.startsWith('0x') ? (deployerPrivateKey as `0x${string}`) : (`0x${deployerPrivateKey}` as `0x${string}`));
  const publicClient = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: bsc,
    transport: http(rpcUrl),
  });

  const guardian = guardianAddress && guardianAddress !== '0x0000000000000000000000000000000000000000'
    ? guardianAddress
    : '0x0000000000000000000000000000000000000000';

  const hash = await walletClient.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode,
    account,
    args: [safeAddress as `0x${string}`, ownerAddress as `0x${string}`, traderAddress as `0x${string}`, guardian as `0x${string}`],
  });

  console.log(`[deploy-safe-module] deployment tx: ${hash}`);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`[deploy-safe-module] deployed at: ${receipt.contractAddress}`);
  console.log(`[deploy-safe-module] owner: ${ownerAddress}`);
  console.log(`[deploy-safe-module] trader: ${traderAddress}`);
  console.log(`[deploy-safe-module] safe: ${safeAddress}`);

  if (!receipt.contractAddress) {
    fail('Contract address not found after deployment.');
  }

  const moduleInfo = {
    contractAddress: receipt.contractAddress,
    safeAddress,
    ownerAddress,
    traderAddress,
    guardian,
    chainId: bsc.id,
  };

  console.log(`[deploy-safe-module] module info: ${JSON.stringify(moduleInfo, null, 2)}`);

  const enableModuleCalldata = encodeFunctionData({
    abi: parseAbi(['function enableModule(address module)']),
    functionName: 'enableModule',
    args: [receipt.contractAddress],
  });

  console.log('[deploy-safe-module] next step: execute Safe enableModule transaction');
  console.log(`[deploy-safe-module] calldata: ${enableModuleCalldata}`);
}

main().catch((error) => {
  console.error('[deploy-safe-module] failed:', error);
  process.exit(1);
});
