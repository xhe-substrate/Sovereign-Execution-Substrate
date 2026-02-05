/**
 * SES-TEST.JS - Determinism Test Suite
 * 
 * Proves that execution is deterministic and replayable offline.
 * All tests run entirely in browser without server dependency.
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // TEST FRAMEWORK (Minimal, no dependencies)
  // ============================================
  class TestRunner {
    constructor() {
      this.tests = [];
      this.results = [];
      this.onProgress = null;
    }

    test(name, fn) {
      this.tests.push({ name, fn });
    }

    async run() {
      this.results = [];
      const startTime = Date.now();

      for (const test of this.tests) {
        const result = {
          name: test.name,
          passed: false,
          error: null,
          duration: 0
        };

        const testStart = Date.now();
        try {
          await test.fn();
          result.passed = true;
        } catch (e) {
          result.error = e.message;
        }
        result.duration = Date.now() - testStart;
        this.results.push(result);

        if (this.onProgress) {
          this.onProgress(result, this.results.length, this.tests.length);
        }
      }

      return {
        total: this.tests.length,
        passed: this.results.filter(r => r.passed).length,
        failed: this.results.filter(r => !r.passed).length,
        results: this.results,
        duration: Date.now() - startTime
      };
    }
  }

  function assert(condition, message) {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  function assertEqual(actual, expected, message) {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    if (actualStr !== expectedStr) {
      throw new Error(message || `Expected ${expectedStr}, got ${actualStr}`);
    }
  }

  // ============================================
  // TEST SUITE: DETERMINISM TESTS
  // ============================================
  async function runDeterminismTests() {
    const runner = new TestRunner();
    const store = new SESStore.MemoryStore();
    const runtime = new SESCore.DCXRuntime(store);

    // ----------------------------------------
    // TEST 1: CID Generation Determinism
    // ----------------------------------------
    runner.test('CID generation is deterministic', async () => {
      const data = { test: 'data', number: 42, nested: { a: 1 } };
      
      const cid1 = await SESStore.generateCID(data);
      const cid2 = await SESStore.generateCID(data);
      const cid3 = await SESStore.generateCID(data);
      
      assertEqual(cid1, cid2, 'CID1 should equal CID2');
      assertEqual(cid2, cid3, 'CID2 should equal CID3');
      assert(cid1.startsWith('cid:sha256:'), 'CID should be SHA-256 based');
    });

    // ----------------------------------------
    // TEST 2: Same Input = Same Output
    // ----------------------------------------
    runner.test('Same input produces same output', async () => {
      const fn = async (input, ctx) => {
        ctx.step('compute', { input }, null);
        return { result: input.a + input.b };
      };

      const fnCid = await runtime.registerFunction(fn);
      const input = { a: 10, b: 20 };

      // Execute twice
      const pulse1 = await runtime.createPulse({ input, functionCid: fnCid });
      const result1 = await runtime.execute(pulse1);

      const pulse2 = await runtime.createPulse({ input, functionCid: fnCid });
      const result2 = await runtime.execute(pulse2);

      assertEqual(result1.output, result2.output, 'Outputs should be identical');
      assertEqual(result1.output, { result: 30 }, 'Output should be { result: 30 }');
    });

    // ----------------------------------------
    // TEST 3: Replay Produces Same Result
    // ----------------------------------------
    runner.test('Replay produces identical result', async () => {
      const fn = async (input, ctx) => {
        let sum = 0;
        for (let i = 0; i < input.iterations; i++) {
          ctx.step('iterate', { i }, null);
          sum += i;
        }
        ctx.step('complete', {}, sum);
        return { sum, iterations: input.iterations };
      };

      const fnCid = await runtime.registerFunction(fn);
      const input = { iterations: 50 };

      // Execute original
      const pulse = await runtime.createPulse({ input, functionCid: fnCid });
      const original = await runtime.execute(pulse);

      // Replay
      const replay = await runtime.replay(original.pulse);

      assert(replay.valid, 'Replay should be valid');
      assert(replay.outputMatch, 'Output should match');
      assert(replay.stepsMatch, 'Step count should match');
    });

    // ----------------------------------------
    // TEST 4: Verify Confirms Determinism
    // ----------------------------------------
    runner.test('Verify confirms deterministic execution', async () => {
      const fn = async (input, ctx) => {
        const arr = input.array.slice();
        ctx.step('copy', {}, arr);
        arr.sort((a, b) => a - b);
        ctx.step('sort', {}, arr);
        return arr;
      };

      const fnCid = await runtime.registerFunction(fn);
      const input = { array: [5, 3, 8, 1, 9, 2] };

      const pulse = await runtime.createPulse({ input, functionCid: fnCid });
      const result = await runtime.execute(pulse);

      const verification = await runtime.verify(result.pulse);

      assert(verification.valid, 'Verification should pass');
      assertEqual(verification.replayOutput, [1, 2, 3, 5, 8, 9], 'Sorted output should match');
    });

    // ----------------------------------------
    // TEST 5: Bounds Are Enforced
    // ----------------------------------------
    runner.test('Bounds violation stops execution', async () => {
      const fn = async (input, ctx) => {
        // Try to exceed step limit
        for (let i = 0; i < 10000; i++) {
          ctx.step('loop', { i }, null);
        }
        return 'should not reach here';
      };

      const fnCid = await runtime.registerFunction(fn);
      const pulse = await runtime.createPulse({
        input: {},
        functionCid: fnCid,
        maxSteps: 100 // Very low limit
      });

      const result = await runtime.execute(pulse);

      assert(!result.success, 'Execution should fail');
      assertEqual(result.pulse.status, 'violated', 'Status should be violated');
      assertEqual(result.error.reason, 'maxSteps', 'Reason should be maxSteps');
    });

    // ----------------------------------------
    // TEST 6: Memory Bounds Are Enforced
    // ----------------------------------------
    runner.test('Memory bounds are enforced', async () => {
      const fn = async (input, ctx) => {
        // Allocate memory beyond limit
        for (let i = 0; i < 100; i++) {
          ctx.allocate(1024 * 1024); // 1MB each
          ctx.step('alloc', { i }, null);
        }
        return 'should not reach here';
      };

      const fnCid = await runtime.registerFunction(fn);
      const pulse = await runtime.createPulse({
        input: {},
        functionCid: fnCid,
        maxMemoryBytes: 5 * 1024 * 1024 // 5MB limit
      });

      const result = await runtime.execute(pulse);

      assert(!result.success, 'Execution should fail');
      assertEqual(result.pulse.status, 'violated', 'Status should be violated');
    });

    // ----------------------------------------
    // TEST 7: Branch Depth Is Tracked
    // ----------------------------------------
    runner.test('Branch depth is tracked and bounded', async () => {
      const fn = async (input, ctx) => {
        function recurse(depth) {
          if (depth >= input.maxDepth) return depth;
          ctx.enterBranch();
          ctx.step('recurse', { depth }, null);
          const result = recurse(depth + 1);
          ctx.exitBranch();
          return result;
        }
        return recurse(0);
      };

      const fnCid = await runtime.registerFunction(fn);
      const pulse = await runtime.createPulse({
        input: { maxDepth: 20 },
        functionCid: fnCid,
        maxBranchDepth: 100
      });

      const result = await runtime.execute(pulse);

      assert(result.success, 'Execution should succeed');
      assertEqual(result.output, 20, 'Should reach depth 20');
    });

    // ----------------------------------------
    // TEST 8: CID Changes With Data
    // ----------------------------------------
    runner.test('Different data produces different CIDs', async () => {
      const data1 = { value: 1 };
      const data2 = { value: 2 };

      const cid1 = await SESStore.generateCID(data1);
      const cid2 = await SESStore.generateCID(data2);

      assert(cid1 !== cid2, 'Different data should produce different CIDs');
    });

    // ----------------------------------------
    // TEST 9: Trace Is Complete
    // ----------------------------------------
    runner.test('Execution trace is complete and ordered', async () => {
      const fn = async (input, ctx) => {
        ctx.step('step1', {}, 1);
        ctx.step('step2', {}, 2);
        ctx.step('step3', {}, 3);
        return 'done';
      };

      const fnCid = await runtime.registerFunction(fn);
      const pulse = await runtime.createPulse({ input: {}, functionCid: fnCid });
      const result = await runtime.execute(pulse);

      assert(result.success, 'Execution should succeed');
      assertEqual(result.trace.totalSteps, 3, 'Should have 3 steps');
      assertEqual(result.trace.steps[0].operation, 'step1', 'First step should be step1');
      assertEqual(result.trace.steps[1].operation, 'step2', 'Second step should be step2');
      assertEqual(result.trace.steps[2].operation, 'step3', 'Third step should be step3');
    });

    // ----------------------------------------
    // TEST 10: Multiple Replays Are Consistent
    // ----------------------------------------
    runner.test('Multiple replays produce consistent results', async () => {
      const fn = async (input, ctx) => {
        let product = 1;
        for (const num of input.numbers) {
          ctx.step('multiply', { num }, null);
          product *= num;
        }
        return product;
      };

      const fnCid = await runtime.registerFunction(fn);
      const input = { numbers: [2, 3, 4, 5] };

      const pulse = await runtime.createPulse({ input, functionCid: fnCid });
      const original = await runtime.execute(pulse);

      // Replay multiple times
      const replays = [];
      for (let i = 0; i < 5; i++) {
        replays.push(await runtime.replay(original.pulse));
      }

      // All replays should match
      for (let i = 0; i < replays.length; i++) {
        assert(replays[i].valid, `Replay ${i} should be valid`);
        assertEqual(replays[i].replayOutput, 120, `Replay ${i} output should be 120`);
      }
    });

    // ----------------------------------------
    // TEST 11: No Wall Clock Dependency
    // ----------------------------------------
    runner.test('Execution is independent of wall clock', async () => {
      const fn = async (input, ctx) => {
        // Note: We can't actually use Date inside because it's non-deterministic
        // This test verifies that execution count, not time, determines bounds
        for (let i = 0; i < input.count; i++) {
          ctx.step('work', { i }, null);
        }
        return input.count;
      };

      const fnCid = await runtime.registerFunction(fn);
      
      // Run twice with same input
      const pulse1 = await runtime.createPulse({ input: { count: 100 }, functionCid: fnCid });
      const pulse2 = await runtime.createPulse({ input: { count: 100 }, functionCid: fnCid });

      const result1 = await runtime.execute(pulse1);
      const result2 = await runtime.execute(pulse2);

      assertEqual(result1.trace.totalSteps, result2.trace.totalSteps, 'Step counts should match');
      assertEqual(result1.output, result2.output, 'Outputs should match');
    });

    // ----------------------------------------
    // TEST 12: Content Store Round-Trip
    // ----------------------------------------
    runner.test('Content store round-trip preserves data', async () => {
      const testData = {
        string: 'hello',
        number: 42,
        array: [1, 2, 3],
        nested: { a: { b: { c: 'd' } } },
        special: 'unicode: \u00e9\u00f1\u00fc'
      };

      const cid = await store.store(testData);
      const retrieved = await store.fetch(cid);

      assertEqual(retrieved, testData, 'Retrieved data should match original');
    });

    // ----------------------------------------
    // TEST 13: Pulse Schema Compliance
    // ----------------------------------------
    runner.test('Pulse conforms to schema', async () => {
      const pulse = new SESCore.Pulse({
        maxSteps: 1000,
        author: 'did:test:123'
      });

      const json = pulse.toJSON();

      assert(json.bounds !== undefined, 'Pulse should have bounds');
      assert(json.bounds.maxSteps === 1000, 'maxSteps should be 1000');
      assert(json.bounds.maxMemoryBytes > 0, 'maxMemoryBytes should be set');
      assert(json.bounds.maxBranchDepth > 0, 'maxBranchDepth should be set');
      assert(json.author === 'did:test:123', 'Author should be set');
      assert(json.status === 'pending', 'Initial status should be pending');
    });

    // ----------------------------------------
    // TEST 14: Parallel Execution Independence
    // ----------------------------------------
    runner.test('Parallel pulses do not interfere', async () => {
      const fn = async (input, ctx) => {
        for (let i = 0; i < input.count; i++) {
          ctx.step('count', { i }, null);
        }
        return input.id;
      };

      const fnCid = await runtime.registerFunction(fn);

      // Create multiple pulses
      const pulses = [];
      for (let i = 0; i < 5; i++) {
        pulses.push(await runtime.createPulse({
          input: { id: `pulse-${i}`, count: 10 + i },
          functionCid: fnCid
        }));
      }

      // Execute all (sequentially for this test, but data should be isolated)
      const results = [];
      for (const pulse of pulses) {
        results.push(await runtime.execute(pulse));
      }

      // Verify each result matches its input
      for (let i = 0; i < results.length; i++) {
        assertEqual(results[i].output, `pulse-${i}`, `Pulse ${i} should return its ID`);
        assertEqual(results[i].trace.totalSteps, 10 + i, `Pulse ${i} should have correct step count`);
      }
    });

    // ----------------------------------------
    // TEST 15: Offline Operation
    // ----------------------------------------
    runner.test('System operates fully offline', async () => {
      // This test verifies that all operations work without any network calls
      const offlineStore = new SESStore.MemoryStore();
      const offlineRuntime = new SESCore.DCXRuntime(offlineStore);

      const fn = async (input, ctx) => {
        ctx.step('offline-work', input, null);
        return { offline: true, input };
      };

      const fnCid = await offlineRuntime.registerFunction(fn);
      const pulse = await offlineRuntime.createPulse({
        input: { test: 'offline' },
        functionCid: fnCid
      });

      const result = await offlineRuntime.execute(pulse);

      assert(result.success, 'Offline execution should succeed');
      assertEqual(result.output.offline, true, 'Should return offline flag');

      // Verify and replay offline
      const verification = await offlineRuntime.verify(result.pulse);
      assert(verification.valid, 'Offline verification should pass');
    });

    // Run all tests
    return runner.run();
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESTest = {
    TestRunner,
    assert,
    assertEqual,
    runDeterminismTests
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESTest;
  } else {
    global.SESTest = SESTest;
  }

})(typeof window !== 'undefined' ? window : global);
