import {
  sendTransactionWithRetry,
  // Removed waitForPaymasterTransactionReceipt
  sendParallelTransactions,
  sendBatchedTransaction,
  warmupClients
} from '../frontend/lib/paymaster';

interface TimingMetrics {
  setupTime: number;
  transactionSend: number;
  // receiptWait: number; // No longer explicitly waiting for full tx receipt
  userOpReceiptWait: number; // Added for UserOp receipt wait
  total: number;
  success: boolean;
  txHash?: string; // This will now be the txHash within the UserOp receipt
  error?: string;
}

async function measureTransactionTiming(
  request: any,
  testName: string
): Promise<TimingMetrics> {
  const startTotal = Date.now();

  try {
    console.log(`\n📊 Testing: ${testName}`);
    console.log('─'.repeat(60));

    const startSend = Date.now();
    const receipt = await sendTransactionWithRetry(request); // This now includes waiting for UserOp receipt
    const sendAndUserOpReceiptDuration = Date.now() - startSend;

    // We are no longer explicitly calling waitForPaymasterTransactionReceipt here
    // as sendTransactionWithRetry now returns after the UserOp receipt is available.

    const totalDuration = Date.now() - startTotal;

    return {
      setupTime: 0,
      transactionSend: sendAndUserOpReceiptDuration, // This now includes the UserOp receipt wait
      userOpReceiptWait: sendAndUserOpReceiptDuration, // For clarity, can reuse this
      total: totalDuration,
      success: true,
      txHash: receipt.receipt.transactionHash
    };
  } catch (error: any) {
    const totalDuration = Date.now() - startTotal;
    return {
      setupTime: 0,
      transactionSend: 0,
      userOpReceiptWait: 0,
      total: totalDuration,
      success: false,
      error: error.message
    };
  }
}

async function runPerformanceTest() {
  console.log('\n🚀 Base Sepolia Performance Test Suite');
  console.log('━'.repeat(60));

  // Warmup clients first
  console.log('\n🔥 Phase 1: Client Warmup');
  const warmupStart = Date.now();
  try {
    await warmupClients();
    console.log(`✅ Warmup completed in ${Date.now() - warmupStart}ms`);
  } catch (error: any) {
    console.error(`❌ Warmup failed:`, error.message);
    return;
  }

  const CONTRACT_ADDRESS = "0x9B8af95247a68cE5dc38361D4A03f56bD8463D3f";
  console.log(`📝 Using contract: ${CONTRACT_ADDRESS.slice(0, 10)}...${CONTRACT_ADDRESS.slice(-8)}`);

  // IMPORTANT: Get your actual smart account address for the sender parameter
  const SENDER_ADDRESS = "0x8ACE347a4d033af77512BC9ad52B118E4a247ea4"; // Replace with actual address

  // Test cases with REAL functions that exist in your ABI
  const testCases = [
    {
      name: 'Create Team via Relayer (Single UserOp)',
      type: 'single' as const,
      request: {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'createTeamRelayer',
        args: [
          SENDER_ADDRESS, // sender
          "Test Team A", // name
          1 // country (use appropriate country code)
        ]
      }
    },
    {
      name: 'Create Team 2 via Relayer (Single UserOp)',
      type: 'single' as const,
      request: {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'createTeamRelayer',
        args: [
          SENDER_ADDRESS, // sender
          "Test Team B", // name
          2 // country (use appropriate country code)
        ]
      }
    },
    {
      name: 'Get Team Info (Read-only - example, usually faster)',
      type: 'single' as const,
      request: {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'getTeam',
        args: [
          1 // teamId - adjust as needed
        ]
      }
    }
  ];

  const results: TimingMetrics[] = [];

  // Phase 2: Single Transaction Tests
  console.log('\n\n🧪 Phase 2: Single Transaction Tests (UserOp Receipt Only)');
  console.log('━'.repeat(60));

  for (const testCase of testCases) {
    if (testCase.type === 'single') {
      const metrics = await measureTransactionTiming(testCase.request, testCase.name);
      results.push(metrics);

      if (metrics.success) {
        console.log(`✅ UserOp Send & Receipt: ${metrics.transactionSend}ms`);
        console.log(`✅ Total Time: ${metrics.total}ms`);
        console.log(`📝 Underlying Tx Hash: ${metrics.txHash}`); // This is the transaction hash within the UserOp receipt

        if (metrics.total > 10000) { // Adjusted expectation due to faster confirmation
          console.log(`⚠️  Slower than expected (>10s) - check RPC connectivity`);
        } else if (metrics.total < 1000) { // Adjusted expectation
          console.log(`🎉 Excellent performance (<1s)`);
        } else {
          console.log(`✓ Normal Base Sepolia UserOp performance (1-10s)`);
        }
      } else {
        console.error(`❌ Test failed: ${metrics.error}`);
      }

      // Wait between tests to avoid nonce issues if using the same account
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Phase 3: Parallel Transaction Test
  console.log('\n\n🧪 Phase 3: Parallel Transaction Test (Sequential Send, Parallel UserOp Receipt Wait)');
  console.log('━'.repeat(60));
  console.log('⚠️  Note: This test uses the same sender for two separate UserOps dispatched sequentially.');

  try {
    const startParallel = Date.now();

    // Example: Create two teams in parallel (if you have multiple sender addresses)
    // Or two distinct operations from the same sender that need separate UserOps
    const { commitReceipt, calculateReceipt } = await sendParallelTransactions(
      {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'createTeamRelayer',
        args: [SENDER_ADDRESS, "Parallel Team Alpha", 3]
      },
      {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'createTeamRelayer',
        args: [SENDER_ADDRESS, "Parallel Team Beta", 4]
      }
    );

    const parallelTime = Date.now() - startParallel;

    console.log(`✅ Parallel execution completed`);
    console.log(`✅ First UserOp Tx: ${commitReceipt.receipt.transactionHash}`);
    console.log(`✅ Second UserOp Tx: ${calculateReceipt.receipt.transactionHash}`);
    console.log(`✅ Total Parallel UserOp Time: ${parallelTime}ms`);

    if (parallelTime < 15000) { // Adjusted for two sequential sends + parallel receipt wait
      console.log(`🎉 Good parallel performance`);
    }

    results.push({
      setupTime: 0,
      transactionSend: parallelTime,
      userOpReceiptWait: parallelTime, // Considering both send and wait contribute to this
      total: parallelTime,
      success: true
    });

  } catch (error: any) {
    console.error(`❌ Parallel test failed:`, error.message);
  }

  await new Promise(resolve => setTimeout(resolve, 2000));

  // Phase 4: Batched Transaction Test
  console.log('\n\n🧪 Phase 4: Batched Transaction Test');
  console.log('━'.repeat(60));
  console.log('💡 Batching multiple operations into single UserOp');

  try {
    const startBatch = Date.now();

    // Example: Batch multiple read operations or compatible writes
    const batchReceipt = await sendBatchedTransaction([
      {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'getActiveGames',
        args: []
      },
      {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'getActiveGameCount',
        args: []
      },
      {
        address: CONTRACT_ADDRESS as `0x${string}`,
        functionName: 'createTeamRelayer', // Add another write for batching demo
        args: [SENDER_ADDRESS, "Batched Team", 5]
      }
    ]);

    const batchTime = Date.now() - startBatch;

    console.log(`✅ Batched execution completed`);
    console.log(`✅ Batch UserOp Tx: ${batchReceipt.receipt.transactionHash}`);
    console.log(`✅ Total Batch UserOp Time: ${batchTime}ms`);
    console.log(`💰 Single UserOp for multiple operations`);

    if (batchTime < 10000) {
      console.log(`🎉 Excellent batch performance`);
    }

    results.push({
      setupTime: 0,
      transactionSend: batchTime,
      userOpReceiptWait: batchTime,
      total: batchTime,
      success: true
    });

  } catch (error: any) {
    console.error(`❌ Batch test failed:`, error.message);
  }

  // Summary
  console.log('\n\n📈 Performance Summary');
  console.log('━'.repeat(60));

  const successfulResults = results.filter(r => r.success);

  if (successfulResults.length > 0) {
    const avgTotal = successfulResults.reduce((sum, r) => sum + r.total, 0) / successfulResults.length;
    const minTotal = Math.min(...successfulResults.map(r => r.total));
    const maxTotal = Math.max(...successfulResults.map(r => r.total));

    console.log(`Tests Run: ${results.length}`);
    console.log(`Successful: ${successfulResults.length}`);
    console.log(`Failed: ${results.length - successfulResults.length}`);
    console.log(`\nTiming Statistics (UserOp Send to Receipt):`);
    console.log(`  Average: ${avgTotal.toFixed(0)}ms`);
    console.log(`  Fastest: ${minTotal.toFixed(0)}ms`);
    console.log(`  Slowest: ${maxTotal.toFixed(0)}ms`);

    console.log(`\n💡 Performance Notes for Base Sepolia (UserOp Focused):`);
    console.log(`  • Expected range: 1,000-10,000ms per UserOp (for bundling and inclusion)`);
    console.log(`  • Block time: ~2 seconds`);
    console.log(`  • Batching saves gas and reduces total time for multiple operations`);
    console.log(`  • For parallel execution with the same sender, UserOps are sent sequentially, but receipts awaited in parallel.`);

    if (avgTotal > 10000) {
      console.log(`\n⚠️  Performance Issues Detected:`);
      console.log(`  1. Check your RPC endpoint connectivity`);
      console.log(`  2. Verify FLASHBLOCKS_RPC_URL is correct`);
      console.log(`  3. Consider using a premium RPC provider`);
      console.log(`  4. Verify your Paymaster is correctly configured and funded`);
    }
  } else {
    console.log('❌ No successful tests completed');
    console.log('\n🔍 Troubleshooting:');
    console.log('  1. Verify contract address is correct');
    console.log('  2. Ensure SENDER_ADDRESS matches your smart account');
    console.log('  3. Check that you have the correct ABI imported');
    console.log('  4. Verify relayer permissions on the contract');
    console.log('  5. Ensure your Redis instance is running and accessible');
    console.log('  6. Check Paymaster logs for errors (e.g., funding)');
  }

  console.log('\n✨ Test suite completed\n');
}

// Run the test
runPerformanceTest().catch(console.error);