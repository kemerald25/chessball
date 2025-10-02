"use server";
import { createPaymasterClient } from "viem/account-abstraction";
import { createPublicClient, http, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { createBundlerClient } from "viem/account-abstraction";
import { redis } from "./redis";
import { UserOperationReceipt } from "viem/account-abstraction";
import { CONTRACT_ABI } from "./contract";

const COINBASE_PAYMASTER_RPC_URL = "https://api.developer.coinbase.com/rpc/v1/base-sepolia/KiHWxKEG8TxntMt0pd9prqKwXidd2OjC";
const FLASHBLOCKS_RPC_URL = "https://base-sepolia.g.alchemy.com/v2/wOfztwyjs9yCVkn-o9877DpNDo85pmoo";
const RELAYER_PRIVATE_KEY = "0x5152049a71c35e5d800c66269ed17759307d020fbf2fb69317d9202481d77a6e";

const FLASHBLOCKS_POLLING_INTERVAL = 25;
const FLASHBLOCKS_TIMEOUT = 3000;

function getCoinbasePaymasterRpcUrl() {
  if (!COINBASE_PAYMASTER_RPC_URL) {
    throw new Error("COINBASE_PAYMASTER_RPC_URL environment variable is required");
  }
  return COINBASE_PAYMASTER_RPC_URL;
}

let _flashblocksClient: ReturnType<typeof createPublicClient> | null = null;
let _smartAccount: Awaited<ReturnType<typeof toCoinbaseSmartAccount>> | null = null;
let _bundlerClient: Awaited<ReturnType<typeof createBundlerClient>> | null = null;
let _paymasterClient: ReturnType<typeof createPaymasterClient> | null = null;

function getFlashblocksClient() {
  if (!_flashblocksClient) {
    _flashblocksClient = createPublicClient({
      chain: baseSepolia,
      transport: http(FLASHBLOCKS_RPC_URL, {
        timeout: FLASHBLOCKS_TIMEOUT,
        retryCount: 1,
        retryDelay: 50,
        fetchOptions: {
          keepalive: true,
        },
      }),
      pollingInterval: FLASHBLOCKS_POLLING_INTERVAL,
      batch: {
        multicall: {
          batchSize: 2048,
          wait: 0,
        },
      },
      cacheTime: 0,
    });
  }
  return _flashblocksClient;
}

function getPaymasterClient() {
  if (!_paymasterClient) {
    _paymasterClient = createPaymasterClient({
      transport: http(getCoinbasePaymasterRpcUrl(), {
        timeout: 2000,
        retryCount: 1,
        retryDelay: 50,
        fetchOptions: {
          keepalive: true,
        },
      }),
    });
  }
  return _paymasterClient;
}

export async function createSmartAccount() {
  if (_smartAccount) {
    return _smartAccount;
  }

  const privateKey = RELAYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
  }

  const owner = privateKeyToAccount(privateKey as Hex);
  const client = getFlashblocksClient();

  _smartAccount = await toCoinbaseSmartAccount({
    client,
    owners: [owner],
    version: "1.1",
  });

  return _smartAccount;
}

export async function createRelayerBundlerClient() {
  if (_bundlerClient) {
    return _bundlerClient;
  }

  const smartAccount = await createSmartAccount();

  _bundlerClient = createBundlerClient({
    account: smartAccount,
    client: getFlashblocksClient(),
    transport: http(FLASHBLOCKS_RPC_URL, {
      timeout: FLASHBLOCKS_TIMEOUT,
      retryCount: 1,
      retryDelay: 50,
      fetchOptions: {
        keepalive: true,
      },
    }),
    chain: baseSepolia,
    paymaster: getPaymasterClient(),
  });

  return _bundlerClient;
}

// Redis nonce management
export async function getNextRelayerNonce(account: Hex): Promise<bigint> {
  const nonceKey = `relayer_nonce:${account}`;

  try {
    if (!redis) {
      throw new Error("Redis client not available");
    }

    const nonceStr = await redis.incr(nonceKey);
    const nonce = Number(nonceStr);

    if (nonce === 1) {
      const client = getFlashblocksClient();
      const blockchainNonce = await client.getTransactionCount({
        address: account,
        blockTag: "pending",
      });

      await redis.set(nonceKey, Number(blockchainNonce) + 1);
      return BigInt(blockchainNonce as number);
    }

    return BigInt(nonce - 1);
  } catch (error) {
    console.error("Error getting next relayer nonce:", error);
    throw new Error(`Failed to get next nonce: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function resetRelayerNonce(account: Hex): Promise<void> {
  const nonceKey = `relayer_nonce:${account}`;

  try {
    if (!redis) {
      throw new Error("Redis client not available");
    }

    const client = getFlashblocksClient();
    const blockchainNonce = await client.getTransactionCount({
      address: account,
      blockTag: "pending",
    });

    await redis.set(nonceKey, Number(blockchainNonce));
    console.log(`Reset nonce for ${account} to ${blockchainNonce}`);
  } catch (error) {
    console.error("Error resetting relayer nonce:", error);
    throw new Error(`Failed to reset nonce: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function getCurrentRelayerNonce(account: Hex): Promise<bigint> {
  const nonceKey = `relayer_nonce:${account}`;

  try {
    if (!redis) {
      throw new Error("Redis client not available");
    }

    const nonceStr = await redis.get(nonceKey);
    const nonce = nonceStr !== null ? Number(nonceStr) : null;

    if (nonce === null) {
      const client = getFlashblocksClient();
      const blockchainNonce = await client.getTransactionCount({
        address: account,
        blockTag: "pending",
      });
      return BigInt(blockchainNonce as number);
    }

    return BigInt(nonce);
  } catch (error) {
    console.error("Error getting current relayer nonce:", error);
    throw new Error(`Failed to get current nonce: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

export async function sendTransactionWithRetry(
  request: any,
  maxRetries: number = 1,
): Promise<UserOperationReceipt> {
  const startTime = performance.now();

  const bundlerClient = await createRelayerBundlerClient();
  const smartAccount = await createSmartAccount();

  const setupTime = performance.now() - startTime;
  console.log(`⚡ Setup: ${setupTime.toFixed(1)}ms`);

  const call = {
    abi: CONTRACT_ABI,
    functionName: request.functionName,
    to: request.address,
    args: request.args,
  };

  let retryCount = 0;

  while (retryCount <= maxRetries) {
    try {
      const sendStart = performance.now();

      const userOpHash = await bundlerClient.sendUserOperation({
        account: smartAccount,
        calls: [call],
      });

      const sendTime = performance.now() - sendStart;
      console.log(`⚡ Sent: ${sendTime.toFixed(1)}ms | ${userOpHash.slice(0, 10)}...`);

      const receiptStart = performance.now();

      // Removed waitForPaymasterTransactionReceipt
      const receipt = await bundlerClient.waitForUserOperationReceipt({
        hash: userOpHash as `0x${string}`,
        pollingInterval: FLASHBLOCKS_POLLING_INTERVAL,
        timeout: FLASHBLOCKS_TIMEOUT,
      });

      const receiptTime = performance.now() - receiptStart;
      const totalTime = performance.now() - startTime;

      console.log(`⚡ UserOp Receipt: ${receiptTime.toFixed(1)}ms`);
      console.log(`🎯 Total: ${totalTime.toFixed(1)}ms`);

      return receipt;
    } catch (error: any) {
      retryCount++;
      console.error(`❌ Attempt ${retryCount} failed:`, error.message);

      if (
        error.message?.includes("insufficient funds") ||
        error.message?.includes("execution reverted") ||
        error.message?.includes("paymaster") ||
        retryCount > maxRetries
      ) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error("Failed to commit UserOperation after retries");
}

// Removed - no longer needed as sendTransactionWithRetry won't use it
// export async function waitForPaymasterTransactionReceipt(
//   hash: string | UserOperationReceipt,
// ) {
//   const startTime = performance.now();

//   const txHash = typeof hash === "string" ? hash : hash.receipt.transactionHash;
//   console.log(`⏳ Confirming: ${txHash.slice(0, 10)}...`);

//   const client = getFlashblocksClient();
//   const receipt = await client.waitForTransactionReceipt({
//     hash: txHash as `0x${string}`,
//     confirmations: 0,
//     pollingInterval: FLASHBLOCKS_POLLING_INTERVAL,
//     timeout: FLASHBLOCKS_TIMEOUT,
//   });

//   const confirmTime = performance.now() - startTime;
//   console.log(`✅ Confirmed: ${confirmTime.toFixed(1)}ms`);

//   return receipt;
// }

export async function sendParallelTransactions(
  commitRequest: any,
  calculateRequest: any,
): Promise<{
  commitReceipt: UserOperationReceipt;
  calculateReceipt: UserOperationReceipt;
}> {
  const startTime = performance.now();
  console.log(`🚀 Parallel send with sequential dispatch...`);

  const bundlerClient = await createRelayerBundlerClient();
  const smartAccount = await createSmartAccount();

  // Build both calls
  const call1 = {
    abi: CONTRACT_ABI,
    functionName: commitRequest.functionName,
    to: commitRequest.address,
    args: commitRequest.args,
  };

  const call2 = {
    abi: CONTRACT_ABI,
    functionName: calculateRequest.functionName,
    to: calculateRequest.address,
    args: calculateRequest.args,
  };

  // Send first transaction (bundler handles nonce increment)
  const sendStart1 = performance.now();
  const userOpHash1 = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [call1],
  });
  console.log(`⚡ Sent #1: ${(performance.now() - sendStart1).toFixed(1)}ms | ${userOpHash1.slice(0, 10)}...`);

  // Send second transaction immediately after (bundler handles the next nonce)
  const sendStart2 = performance.now();
  const userOpHash2 = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [call2],
  });
  console.log(`⚡ Sent #2: ${(performance.now() - sendStart2).toFixed(1)}ms | ${userOpHash2.slice(0, 10)}...`);

  // Wait for both user operation receipts in parallel
  const [commitReceipt, calculateReceipt] = await Promise.all([
    bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash1 as `0x${string}`,
      pollingInterval: FLASHBLOCKS_POLLING_INTERVAL,
      timeout: FLASHBLOCKS_TIMEOUT,
    }),
    bundlerClient.waitForUserOperationReceipt({
      hash: userOpHash2 as `0x${string}`,
      pollingInterval: FLASHBLOCKS_POLLING_INTERVAL,
      timeout: FLASHBLOCKS_TIMEOUT,
    }),
  ]);

  const totalTime = performance.now() - startTime;
  console.log(`🎉 Parallel complete: ${totalTime.toFixed(1)}ms`);

  return { commitReceipt, calculateReceipt };
}

export async function sendBatchedTransaction(
  requests: Array<{ address: Hex; functionName: string; args: any[] }>,
): Promise<UserOperationReceipt> {
  const startTime = performance.now();
  console.log(`📦 Batch (${requests.length} calls)...`);

  const bundlerClient = await createRelayerBundlerClient();
  const smartAccount = await createSmartAccount();

  const calls = requests.map((req) => ({
    abi: CONTRACT_ABI,
    functionName: req.functionName,
    to: req.address,
    args: req.args,
  }));

  const sendStart = performance.now();
  const userOpHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls,
  });

  const sendTime = performance.now() - sendStart;
  console.log(`⚡ Batch sent: ${sendTime.toFixed(1)}ms`);

  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash as `0x${string}`,
    pollingInterval: FLASHBLOCKS_POLLING_INTERVAL,
    timeout: FLASHBLOCKS_TIMEOUT,
  });

  const totalTime = performance.now() - startTime;
  console.log(`🎯 Batch total: ${totalTime.toFixed(1)}ms`);

  return receipt;
}

export async function warmupClients() {
  console.log("🔥 Warming up clients...");
  const start = performance.now();
  
  await Promise.all([
    createSmartAccount(),
    createRelayerBundlerClient(),
    getFlashblocksClient(),
    getPaymasterClient(),
  ]);
  
  console.log(`🔥 Warmup complete: ${(performance.now() - start).toFixed(1)}ms`);
}