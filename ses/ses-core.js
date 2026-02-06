/**
 * SES-CORE.JS - Sovereign Execution Substrate
 * Deterministic Controlled Execution (DCX) Runtime
 *
 * Core Invariants:
 * - Every state change originates from a Pulse
 * - No unbounded execution anywhere
 * - All results are replayable from CIDs
 * - Resource use is explicit and capped
 * - Parallelism is bounded
 *
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // CONSTANTS & CONFIGURATION
  // ============================================
  const SES_VERSION = '1.0.0';
  const DEFAULT_BOUNDS = {
    maxSteps: 1000000,
    maxMemoryBytes: 100 * 1024 * 1024, // 100MB
    maxBranchDepth: 100,
    maxExecutionMs: 30000 // 30 seconds hard cap
  };

  // ============================================
  // CID (Content Identifier) GENERATION
  // SHA-256 based content addressing
  // ============================================
  async function generateCID(data) {
    const encoder = new TextEncoder();
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dataString));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'cid:sha256:' + hashHex;
  }

  // Synchronous CID for non-async contexts (uses djb2 hash as fallback)
  function generateCIDSync(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    return 'cid:djb2:' + Math.abs(hash).toString(16).padStart(8, '0');
  }

  // ============================================
  // PULSE SCHEMA
  // The fundamental unit of computation in SES
  // ============================================
  class Pulse {
    constructor(options = {}) {
      // Unique identifiers
      this.pulseId = null; // Set after creation (CID of entire pulse)
      this.parentPulseId = options.parentPulseId || null;

      // Timing (logical, not wall-clock)
      this.logicalTick = options.logicalTick || 0;
      this.createdAt = new Date().toISOString(); // For reference only, not used in execution

      // Resource Bounds (ENFORCED)
      this.bounds = {
        maxSteps: options.maxSteps || DEFAULT_BOUNDS.maxSteps,
        maxMemoryBytes: options.maxMemoryBytes || DEFAULT_BOUNDS.maxMemoryBytes,
        maxBranchDepth: options.maxBranchDepth || DEFAULT_BOUNDS.maxBranchDepth,
        maxExecutionMs: options.maxExecutionMs || DEFAULT_BOUNDS.maxExecutionMs
      };

      // Deterministic Execution Components (CIDs)
      this.inputCid = null;
      this.functionCid = null;
      this.outputCid = null;
      this.traceCid = null;

      // Identity & Attestation
      this.author = options.author || 'did:anonymous';
      this.signature = null; // Ed25519 signature (to be implemented)

      // Execution State
      this.status = 'pending'; // pending | executing | completed | failed | violated
      this.error = null;
    }

    toJSON() {
      return {
        pulseId: this.pulseId,
        parentPulseId: this.parentPulseId,
        logicalTick: this.logicalTick,
        createdAt: this.createdAt,
        bounds: { ...this.bounds },
        inputCid: this.inputCid,
        functionCid: this.functionCid,
        outputCid: this.outputCid,
        traceCid: this.traceCid,
        author: this.author,
        signature: this.signature,
        status: this.status,
        error: this.error
      };
    }

    static fromJSON(json) {
      const pulse = new Pulse(json);
      pulse.pulseId = json.pulseId;
      pulse.inputCid = json.inputCid;
      pulse.functionCid = json.functionCid;
      pulse.outputCid = json.outputCid;
      pulse.traceCid = json.traceCid;
      pulse.signature = json.signature;
      pulse.status = json.status;
      pulse.error = json.error;
      pulse.createdAt = json.createdAt;
      return pulse;
    }
  }

  // ============================================
  // EXECUTION TRACE
  // Complete record of execution for replay
  // ============================================
  class ExecutionTrace {
    constructor() {
      this.steps = [];
      this.totalSteps = 0;
      this.peakMemory = 0;
      this.maxBranchDepth = 0;
      this.startTime = null;
      this.endTime = null;
      this.deterministicSeed = null;
    }

    addStep(step) {
      this.steps.push({
        tick: this.totalSteps,
        operation: step.operation,
        args: step.args,
        result: step.result,
        memory: step.memory || 0
      });
      this.totalSteps++;
      if (step.memory > this.peakMemory) {
        this.peakMemory = step.memory;
      }
    }

    toJSON() {
      return {
        steps: this.steps,
        totalSteps: this.totalSteps,
        peakMemory: this.peakMemory,
        maxBranchDepth: this.maxBranchDepth,
        startTime: this.startTime,
        endTime: this.endTime,
        deterministicSeed: this.deterministicSeed
      };
    }
  }

  // ============================================
  // DCX RUNTIME
  // Deterministic Controlled Execution Engine
  // ============================================
  class DCXRuntime {
    constructor(store) {
      this.store = store;
      this.currentPulse = null;
      this.trace = null;
      this.stepCount = 0;
      this.memoryUsed = 0;
      this.branchDepth = 0;
      this.startTime = null;
      this.aborted = false;

      // Registered functions (CID -> function)
      this.functions = new Map();

      // Event listeners
      this.listeners = {
        'step': [],
        'boundViolation': [],
        'complete': [],
        'error': []
      };
    }

    // Register a function with its CID
    async registerFunction(fn, metadata = {}) {
      const fnString = fn.toString();
      const fnData = {
        code: fnString,
        metadata: metadata,
        version: SES_VERSION
      };
      const cid = await generateCID(fnData);
      this.functions.set(cid, { fn, data: fnData });
      return cid;
    }

    // Get function by CID
    getFunction(cid) {
      return this.functions.get(cid);
    }

    // Event handling
    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => cb(data));
      }
    }

    // Check resource bounds
    checkBounds() {
      const pulse = this.currentPulse;
      if (!pulse) return { valid: true };

      if (this.stepCount >= pulse.bounds.maxSteps) {
        return { valid: false, reason: 'maxSteps', current: this.stepCount, limit: pulse.bounds.maxSteps };
      }
      if (this.memoryUsed >= pulse.bounds.maxMemoryBytes) {
        return { valid: false, reason: 'maxMemory', current: this.memoryUsed, limit: pulse.bounds.maxMemoryBytes };
      }
      if (this.branchDepth >= pulse.bounds.maxBranchDepth) {
        return { valid: false, reason: 'maxBranchDepth', current: this.branchDepth, limit: pulse.bounds.maxBranchDepth };
      }

      const elapsed = Date.now() - this.startTime;
      if (elapsed >= pulse.bounds.maxExecutionMs) {
        return { valid: false, reason: 'maxExecutionMs', current: elapsed, limit: pulse.bounds.maxExecutionMs };
      }

      return { valid: true };
    }

    // Track a step (must be called by executing functions)
    step(operation, args, result) {
      this.stepCount++;

      const stepData = {
        operation,
        args: this.serializeArgs(args),
        result: this.serializeResult(result),
        memory: this.memoryUsed
      };

      if (this.trace) {
        this.trace.addStep(stepData);
      }

      this.emit('step', {
        stepCount: this.stepCount,
        operation,
        bounds: this.currentPulse?.bounds,
        usage: {
          steps: this.stepCount,
          memory: this.memoryUsed,
          branchDepth: this.branchDepth,
          elapsed: Date.now() - this.startTime
        }
      });

      const boundsCheck = this.checkBounds();
      if (!boundsCheck.valid) {
        this.aborted = true;
        this.emit('boundViolation', boundsCheck);
        throw new BoundViolationError(boundsCheck.reason, boundsCheck.current, boundsCheck.limit);
      }

      return result;
    }

    serializeArgs(args) {
      try {
        return JSON.parse(JSON.stringify(args));
      } catch (e) {
        return '[unserializable]';
      }
    }

    serializeResult(result) {
      try {
        return JSON.parse(JSON.stringify(result));
      } catch (e) {
        return '[unserializable]';
      }
    }

    // Allocate memory (tracked)
    allocate(bytes) {
      this.memoryUsed += bytes;
      this.checkBounds();
      return bytes;
    }

    // Enter/exit branch (for depth tracking)
    enterBranch() {
      this.branchDepth++;
      if (this.trace) {
        this.trace.maxBranchDepth = Math.max(this.trace.maxBranchDepth, this.branchDepth);
      }
      this.checkBounds();
    }

    exitBranch() {
      this.branchDepth = Math.max(0, this.branchDepth - 1);
    }

    // Create and execute a Pulse
    async createPulse(options) {
      const pulse = new Pulse(options);

      // Store input and get CID
      if (options.input !== undefined) {
        pulse.inputCid = await this.store.store(options.input);
      }

      // Register or use existing function CID
      if (options.fn) {
        pulse.functionCid = await this.registerFunction(options.fn, options.fnMetadata || {});
      } else if (options.functionCid) {
        pulse.functionCid = options.functionCid;
      }

      return pulse;
    }

    // Execute a Pulse
    async execute(pulse) {
      // Reset runtime state
      this.currentPulse = pulse;
      this.trace = new ExecutionTrace();
      this.stepCount = 0;
      this.memoryUsed = 0;
      this.branchDepth = 0;
      this.startTime = Date.now();
      this.aborted = false;

      // Set deterministic seed from input
      this.trace.deterministicSeed = pulse.inputCid;
      this.trace.startTime = new Date().toISOString();

      pulse.status = 'executing';

      try {
        // Fetch input
        const input = pulse.inputCid ? await this.store.fetch(pulse.inputCid) : null;

        // Get function
        const fnEntry = this.getFunction(pulse.functionCid);
        if (!fnEntry) {
          throw new Error(`Function not found: ${pulse.functionCid}`);
        }

        // Create bounded execution context
        const ctx = this.createExecutionContext();

        // Execute with bounds
        const output = await fnEntry.fn(input, ctx);

        // Store output and trace
        pulse.outputCid = await this.store.store(output);

        this.trace.endTime = new Date().toISOString();
        pulse.traceCid = await this.store.store(this.trace.toJSON());

        // Generate pulse ID from complete pulse
        pulse.status = 'completed';
        pulse.pulseId = await generateCID(pulse.toJSON());

        // Store the complete pulse
        await this.store.store(pulse.toJSON());

        this.emit('complete', {
          pulse: pulse.toJSON(),
          output,
          trace: this.trace.toJSON()
        });

        return {
          success: true,
          pulse: pulse.toJSON(),
          output,
          trace: this.trace.toJSON()
        };

      } catch (error) {
        pulse.status = error instanceof BoundViolationError ? 'violated' : 'failed';
        pulse.error = {
          type: error.constructor.name,
          message: error.message,
          ...(error instanceof BoundViolationError ? {
            reason: error.reason,
            current: error.current,
            limit: error.limit
          } : {})
        };

        this.trace.endTime = new Date().toISOString();
        pulse.traceCid = await this.store.store(this.trace.toJSON());
        pulse.pulseId = await generateCID(pulse.toJSON());

        this.emit('error', { pulse: pulse.toJSON(), error: pulse.error });

        return {
          success: false,
          pulse: pulse.toJSON(),
          error: pulse.error,
          trace: this.trace.toJSON()
        };
      } finally {
        this.currentPulse = null;
      }
    }

    // Create execution context with bound methods
    createExecutionContext() {
      const runtime = this;
      return {
        step: (op, args, result) => runtime.step(op, args, result),
        allocate: (bytes) => runtime.allocate(bytes),
        enterBranch: () => runtime.enterBranch(),
        exitBranch: () => runtime.exitBranch(),
        isAborted: () => runtime.aborted,
        getUsage: () => ({
          steps: runtime.stepCount,
          memory: runtime.memoryUsed,
          branchDepth: runtime.branchDepth,
          elapsed: Date.now() - runtime.startTime
        }),
        getBounds: () => ({ ...runtime.currentPulse.bounds })
      };
    }

    // Verify a pulse by replaying it
    async verify(pulse) {
      // Fetch all components
      const input = pulse.inputCid ? await this.store.fetch(pulse.inputCid) : null;
      const expectedOutput = pulse.outputCid ? await this.store.fetch(pulse.outputCid) : null;
      const expectedTrace = pulse.traceCid ? await this.store.fetch(pulse.traceCid) : null;

      // Get function
      const fnEntry = this.getFunction(pulse.functionCid);
      if (!fnEntry) {
        return { valid: false, reason: 'Function not found' };
      }

      // Create new pulse for replay
      const replayPulse = Pulse.fromJSON(pulse);
      replayPulse.outputCid = null;
      replayPulse.traceCid = null;

      // Execute replay
      const result = await this.execute(replayPulse);

      if (!result.success) {
        return { valid: false, reason: 'Replay execution failed', error: result.error };
      }

      // Compare outputs
      const outputMatch = JSON.stringify(result.output) === JSON.stringify(expectedOutput);
      const stepsMatch = result.trace.totalSteps === expectedTrace?.totalSteps;

      return {
        valid: outputMatch && stepsMatch,
        outputMatch,
        stepsMatch,
        replayOutput: result.output,
        expectedOutput,
        replaySteps: result.trace.totalSteps,
        expectedSteps: expectedTrace?.totalSteps
      };
    }

    // Replay from a specific pulse
    async replay(pulseIdOrData) {
      let pulseData = pulseIdOrData;

      if (typeof pulseIdOrData === 'string') {
        pulseData = await this.store.fetch(pulseIdOrData);
      }

      if (!pulseData) {
        throw new Error('Pulse not found for replay');
      }

      const pulse = Pulse.fromJSON(pulseData);
      return this.verify(pulse);
    }
  }

  // ============================================
  // BOUND VIOLATION ERROR
  // ============================================
  class BoundViolationError extends Error {
    constructor(reason, current, limit) {
      super(`Bound violation: ${reason} (${current} >= ${limit})`);
      this.name = 'BoundViolationError';
      this.reason = reason;
      this.current = current;
      this.limit = limit;
    }
  }

  // ============================================
  // PULSE SCHEMA DEFINITION (for documentation)
  // ============================================
  const PULSE_SCHEMA = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://ses.sovereign-substrate.org/schemas/pulse.json',
    title: 'Pulse',
    description: 'The fundamental unit of computation in the Sovereign Execution Substrate',
    type: 'object',
    required: ['bounds', 'inputCid', 'functionCid', 'author'],
    properties: {
      pulseId: {
        type: 'string',
        description: 'Content-addressed ID (CID) of the complete pulse',
        pattern: '^cid:(sha256|djb2):[a-f0-9]+$'
      },
      parentPulseId: {
        type: ['string', 'null'],
        description: 'CID of parent pulse for chaining'
      },
      logicalTick: {
        type: 'integer',
        minimum: 0,
        description: 'Logical time tick (not wall-clock)'
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        description: 'ISO timestamp for reference (not used in execution)'
      },
      bounds: {
        type: 'object',
        required: ['maxSteps', 'maxMemoryBytes', 'maxBranchDepth', 'maxExecutionMs'],
        properties: {
          maxSteps: { type: 'integer', minimum: 1 },
          maxMemoryBytes: { type: 'integer', minimum: 1 },
          maxBranchDepth: { type: 'integer', minimum: 1 },
          maxExecutionMs: { type: 'integer', minimum: 1 }
        }
      },
      inputCid: { type: 'string', description: 'CID of input data' },
      functionCid: { type: 'string', description: 'CID of execution function' },
      outputCid: { type: ['string', 'null'], description: 'CID of output data' },
      traceCid: { type: ['string', 'null'], description: 'CID of execution trace' },
      author: { type: 'string', description: 'DID of pulse author' },
      signature: { type: ['string', 'null'], description: 'Ed25519 signature' },
      status: {
        type: 'string',
        enum: ['pending', 'executing', 'completed', 'failed', 'violated']
      },
      error: {
        type: ['object', 'null'],
        properties: {
          type: { type: 'string' },
          message: { type: 'string' },
          reason: { type: 'string' },
          current: { type: 'number' },
          limit: { type: 'number' }
        }
      }
    }
  };

  // ============================================
  // EXPORT
  // ============================================
  const SESCore = {
    VERSION: SES_VERSION,
    DEFAULT_BOUNDS,
    Pulse,
    ExecutionTrace,
    DCXRuntime,
    BoundViolationError,
    PULSE_SCHEMA,
    generateCID,
    generateCIDSync
  };

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESCore;
  } else {
    global.SESCore = SESCore;
  }

})(typeof window !== 'undefined' ? window : global);
