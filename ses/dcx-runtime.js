/**
 * DCX-RUNTIME.JS - Deterministic Controlled Execution Runtime
 * Sovereign Execution Substrate - Layer 3
 * 
 * Core Invariants (NON-NEGOTIABLE):
 * - Every state change originates from a Pulse
 * - No unbounded execution anywhere
 * - All results are replayable from CIDs
 * - Resource use is explicit and capped
 * - Parallelism is bounded
 * - AI is NOT part of the execution engine
 * 
 * @version 1.0.0-frozen
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // VERSION
  // ============================================
  const DCX_VERSION = '1.0.0';

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
  // EXECUTION TRACE
  // Complete record for deterministic replay
  // ============================================
  class ExecutionTrace {
    constructor() {
      this.steps = [];
      this.totalSteps = 0;
      this.peakMemory = 0;
      this.maxBranchDepth = 0;
      this.deterministicSeed = null;
      this.startTime = null;
      this.endTime = null;
    }

    addStep(tick, operation, args, result, memory) {
      this.steps.push({
        tick: tick,
        operation: operation,
        args: args,
        result: result,
        memory: memory || 0
      });
      this.totalSteps = this.steps.length;
      if (memory > this.peakMemory) {
        this.peakMemory = memory;
      }
    }

    toJSON() {
      return {
        steps: this.steps,
        totalSteps: this.totalSteps,
        peakMemory: this.peakMemory,
        maxBranchDepth: this.maxBranchDepth,
        deterministicSeed: this.deterministicSeed,
        startTime: this.startTime,
        endTime: this.endTime
      };
    }

    static fromJSON(json) {
      const trace = new ExecutionTrace();
      trace.steps = json.steps || [];
      trace.totalSteps = json.totalSteps || 0;
      trace.peakMemory = json.peakMemory || 0;
      trace.maxBranchDepth = json.maxBranchDepth || 0;
      trace.deterministicSeed = json.deterministicSeed;
      trace.startTime = json.startTime;
      trace.endTime = json.endTime;
      return trace;
    }
  }

  // ============================================
  // DCX RUNTIME
  // The execution engine core
  // ============================================
  class DCXRuntime {
    constructor(store) {
      if (!store || typeof store.store !== 'function' || typeof store.fetch !== 'function') {
        throw new Error('DCXRuntime requires a ContentStore with store() and fetch() methods');
      }
      
      this._store = store;
      this._functions = new Map();  // CID -> { fn, source }
      
      // Current execution state (reset per pulse)
      this._currentPulse = null;
      this._trace = null;
      this._stepCount = 0;
      this._memoryUsed = 0;
      this._branchDepth = 0;
      this._startTime = null;
      this._aborted = false;
      
      // Event listeners
      this._listeners = {
        step: [],
        boundViolation: [],
        complete: [],
        error: []
      };
    }

    // ==========================================
    // FUNCTION REGISTRY
    // ==========================================

    /**
     * Register a function and return its CID
     * @param {Function} fn - Function to register
     * @param {Object} metadata - Optional metadata
     * @returns {Promise<string>} Function CID
     */
    async registerFunction(fn, metadata = {}) {
      if (typeof fn !== 'function') {
        throw new Error('registerFunction requires a function');
      }
      
      const source = fn.toString();
      const functionData = {
        source: source,
        metadata: metadata,
        dcxVersion: DCX_VERSION
      };
      
      const cid = await this._store.store(functionData);
      this._functions.set(cid, { fn: fn, source: source, metadata: metadata });
      
      return cid;
    }

    /**
     * Get a registered function by CID
     * @param {string} cid - Function CID
     * @returns {Object|null} Function entry or null
     */
    getFunction(cid) {
      return this._functions.get(cid) || null;
    }

    /**
     * Check if function is registered
     * @param {string} cid - Function CID
     * @returns {boolean}
     */
    hasFunction(cid) {
      return this._functions.has(cid);
    }

    // ==========================================
    // EVENT SYSTEM
    // ==========================================

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Event handler
     */
    on(event, callback) {
      if (this._listeners[event]) {
        this._listeners[event].push(callback);
      }
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Event handler to remove
     */
    off(event, callback) {
      if (this._listeners[event]) {
        const idx = this._listeners[event].indexOf(callback);
        if (idx > -1) {
          this._listeners[event].splice(idx, 1);
        }
      }
    }

    /**
     * Emit an event
     * @private
     */
    _emit(event, data) {
      if (this._listeners[event]) {
        for (const cb of this._listeners[event]) {
          try {
            cb(data);
          } catch (e) {
            console.error('Event listener error:', e);
          }
        }
      }
    }

    // ==========================================
    // BOUND CHECKING
    // ==========================================

    /**
     * Check all resource bounds
     * @returns {Object} { valid, reason?, current?, limit? }
     */
    _checkBounds() {
      const pulse = this._currentPulse;
      if (!pulse) {
        return { valid: true };
      }

      const bounds = pulse.bounds;

      if (this._stepCount >= bounds.maxSteps) {
        return { valid: false, reason: 'maxSteps', current: this._stepCount, limit: bounds.maxSteps };
      }

      if (this._memoryUsed >= bounds.maxMemoryBytes) {
        return { valid: false, reason: 'maxMemoryBytes', current: this._memoryUsed, limit: bounds.maxMemoryBytes };
      }

      if (this._branchDepth >= bounds.maxBranchDepth) {
        return { valid: false, reason: 'maxBranchDepth', current: this._branchDepth, limit: bounds.maxBranchDepth };
      }

      const elapsed = Date.now() - this._startTime;
      if (elapsed >= bounds.maxExecutionMs) {
        return { valid: false, reason: 'maxExecutionMs', current: elapsed, limit: bounds.maxExecutionMs };
      }

      return { valid: true };
    }

    /**
     * Enforce bounds, throw if violated
     * @private
     */
    _enforceBounds() {
      const check = this._checkBounds();
      if (!check.valid) {
        this._aborted = true;
        this._emit('boundViolation', check);
        throw new BoundViolationError(check.reason, check.current, check.limit);
      }
    }

    // ==========================================
    // EXECUTION CONTEXT
    // Passed to executing functions
    // ==========================================

    /**
     * Create execution context for a function
     * @returns {Object} Execution context
     */
    _createContext() {
      const runtime = this;
      
      return Object.freeze({
        /**
         * Record an execution step
         * @param {string} operation - Operation name
         * @param {any} args - Operation arguments
         * @param {any} result - Operation result
         * @returns {any} The result (pass-through)
         */
        step: function(operation, args, result) {
          runtime._stepCount++;
          
          // Serialize args/result safely
          const safeArgs = runtime._safeSerialize(args);
          const safeResult = runtime._safeSerialize(result);
          
          if (runtime._trace) {
            runtime._trace.addStep(
              runtime._stepCount,
              operation,
              safeArgs,
              safeResult,
              runtime._memoryUsed
            );
          }
          
          runtime._emit('step', {
            stepCount: runtime._stepCount,
            operation: operation,
            usage: runtime._getUsage()
          });
          
          runtime._enforceBounds();
          
          return result;
        },

        /**
         * Allocate memory (tracked)
         * @param {number} bytes - Bytes to allocate
         * @returns {number} Bytes allocated
         */
        allocate: function(bytes) {
          runtime._memoryUsed += bytes;
          runtime._enforceBounds();
          return bytes;
        },

        /**
         * Enter a branch (for depth tracking)
         */
        enterBranch: function() {
          runtime._branchDepth++;
          if (runtime._trace) {
            runtime._trace.maxBranchDepth = Math.max(
              runtime._trace.maxBranchDepth,
              runtime._branchDepth
            );
          }
          runtime._enforceBounds();
        },

        /**
         * Exit a branch
         */
        exitBranch: function() {
          runtime._branchDepth = Math.max(0, runtime._branchDepth - 1);
        },

        /**
         * Check if execution is aborted
         * @returns {boolean}
         */
        isAborted: function() {
          return runtime._aborted;
        },

        /**
         * Get current resource usage
         * @returns {Object}
         */
        getUsage: function() {
          return runtime._getUsage();
        },

        /**
         * Get resource bounds
         * @returns {Object}
         */
        getBounds: function() {
          return runtime._currentPulse ? { ...runtime._currentPulse.bounds } : null;
        }
      });
    }

    /**
     * Get current resource usage
     * @private
     */
    _getUsage() {
      return {
        steps: this._stepCount,
        memory: this._memoryUsed,
        branchDepth: this._branchDepth,
        elapsed: this._startTime ? Date.now() - this._startTime : 0
      };
    }

    /**
     * Safely serialize a value
     * @private
     */
    _safeSerialize(value) {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch (e) {
        return '[unserializable]';
      }
    }

    // ==========================================
    // PULSE EXECUTION
    // ==========================================

    /**
     * Create a Pulse (does not execute)
     * @param {Object} options - Pulse options
     * @returns {Promise<Object>} Pulse object
     */
    async createPulse(options) {
      const PulseSchema = root.PulseSchema || 
        (typeof require === 'function' ? require('./pulse-schema.js') : null);
      
      if (!PulseSchema) {
        throw new Error('PulseSchema not available');
      }
      
      // Store input and get CID
      let inputCid = options.inputCid;
      if (options.input !== undefined && !inputCid) {
        inputCid = await this._store.store(options.input);
      }
      
      // Register or use existing function CID
      let functionCid = options.functionCid;
      if (options.fn && !functionCid) {
        functionCid = await this.registerFunction(options.fn, options.fnMetadata || {});
      }
      
      // Create pulse template
      const pulse = PulseSchema.createPulseTemplate({
        parentPulseId: options.parentPulseId,
        logicalTick: options.logicalTick || 0,
        maxSteps: options.maxSteps,
        maxMemoryBytes: options.maxMemoryBytes,
        maxBranchDepth: options.maxBranchDepth,
        maxExecutionMs: options.maxExecutionMs,
        inputCid: inputCid,
        functionCid: functionCid,
        author: options.author || 'did:anonymous'
      });
      
      return pulse;
    }

    /**
     * Execute a Pulse
     * @param {Object} pulse - Pulse to execute
     * @returns {Promise<Object>} Execution result
     */
    async execute(pulse) {
      const PulseSchema = root.PulseSchema || 
        (typeof require === 'function' ? require('./pulse-schema.js') : null);
      
      // Validate pulse
      const validation = PulseSchema.validatePulse(pulse);
      if (!validation.valid) {
        return {
          success: false,
          pulse: pulse,
          error: { type: 'ValidationError', message: validation.errors.join(', ') }
        };
      }
      
      // Reset runtime state
      this._currentPulse = pulse;
      this._trace = new ExecutionTrace();
      this._stepCount = 0;
      this._memoryUsed = 0;
      this._branchDepth = 0;
      this._startTime = Date.now();
      this._aborted = false;
      
      // Set trace metadata
      this._trace.deterministicSeed = pulse.inputCid;
      this._trace.startTime = new Date().toISOString();
      
      pulse.status = PulseSchema.PulseStatus.EXECUTING;

      try {
        // Fetch input
        const input = pulse.inputCid ? await this._store.fetch(pulse.inputCid) : null;
        
        // Get function
        const fnEntry = this.getFunction(pulse.functionCid);
        if (!fnEntry) {
          throw new Error('Function not found: ' + pulse.functionCid);
        }
        
        // Create execution context
        const ctx = this._createContext();
        
        // Execute function with bounds
        const output = await fnEntry.fn(input, ctx);
        
        // Store output
        pulse.outputCid = await this._store.store(output);
        
        // Finalize trace
        this._trace.endTime = new Date().toISOString();
        pulse.traceCid = await this._store.store(this._trace.toJSON());
        
        // Set final status
        pulse.status = PulseSchema.PulseStatus.COMPLETED;
        
        // Generate pulse ID
        pulse.pulseId = await this._store.store(pulse);
        
        const result = {
          success: true,
          pulse: pulse,
          output: output,
          trace: this._trace.toJSON()
        };
        
        this._emit('complete', result);
        
        return result;

      } catch (error) {
        // Finalize trace
        this._trace.endTime = new Date().toISOString();
        pulse.traceCid = await this._store.store(this._trace.toJSON());
        
        // Set error status
        pulse.status = error instanceof BoundViolationError 
          ? PulseSchema.PulseStatus.VIOLATED 
          : PulseSchema.PulseStatus.FAILED;
        
        pulse.error = {
          type: error.name || 'Error',
          message: error.message
        };
        
        if (error instanceof BoundViolationError) {
          pulse.error.reason = error.reason;
          pulse.error.current = error.current;
          pulse.error.limit = error.limit;
        }
        
        // Generate pulse ID
        pulse.pulseId = await this._store.store(pulse);
        
        const result = {
          success: false,
          pulse: pulse,
          error: pulse.error,
          trace: this._trace.toJSON()
        };
        
        this._emit('error', result);
        
        return result;

      } finally {
        this._currentPulse = null;
      }
    }

    // ==========================================
    // REPLAY & VERIFICATION
    // ==========================================

    /**
     * Verify a pulse by replaying it
     * @param {Object} pulse - Pulse to verify
     * @returns {Promise<Object>} Verification result
     */
    async verify(pulse) {
      // Fetch expected output and trace
      const expectedOutput = pulse.outputCid 
        ? await this._store.fetch(pulse.outputCid) 
        : null;
      const expectedTrace = pulse.traceCid 
        ? await this._store.fetch(pulse.traceCid) 
        : null;
      
      // Get function
      const fnEntry = this.getFunction(pulse.functionCid);
      if (!fnEntry) {
        return { valid: false, reason: 'Function not found: ' + pulse.functionCid };
      }
      
      // Create replay pulse (fresh execution)
      const replayPulse = {
        pulseId: null,
        parentPulseId: pulse.parentPulseId,
        logicalTick: pulse.logicalTick,
        bounds: { ...pulse.bounds },
        inputCid: pulse.inputCid,
        functionCid: pulse.functionCid,
        outputCid: null,
        traceCid: null,
        author: pulse.author,
        signature: null,
        status: 'pending',
        error: null
      };
      
      // Execute replay
      const result = await this.execute(replayPulse);
      
      if (!result.success) {
        return {
          valid: false,
          reason: 'Replay execution failed',
          error: result.error
        };
      }
      
      // Compare outputs (canonical JSON comparison)
      const outputMatch = JSON.stringify(result.output) === JSON.stringify(expectedOutput);
      const stepsMatch = result.trace.totalSteps === (expectedTrace?.totalSteps || 0);
      
      return {
        valid: outputMatch && stepsMatch,
        outputMatch: outputMatch,
        stepsMatch: stepsMatch,
        replayOutput: result.output,
        expectedOutput: expectedOutput,
        replaySteps: result.trace.totalSteps,
        expectedSteps: expectedTrace?.totalSteps || 0,
        replayPulse: result.pulse
      };
    }

    /**
     * Replay from pulse ID or pulse object
     * @param {string|Object} pulseIdOrData - Pulse ID or pulse object
     * @returns {Promise<Object>} Replay result
     */
    async replay(pulseIdOrData) {
      let pulse = pulseIdOrData;
      
      if (typeof pulseIdOrData === 'string') {
        pulse = await this._store.fetch(pulseIdOrData);
      }
      
      if (!pulse) {
        return { valid: false, reason: 'Pulse not found' };
      }
      
      return this.verify(pulse);
    }

    // ==========================================
    // UTILITY
    // ==========================================

    /**
     * Get the content store
     * @returns {ContentStore}
     */
    getStore() {
      return this._store;
    }

    /**
     * Get all registered function CIDs
     * @returns {string[]}
     */
    getFunctionCIDs() {
      return Array.from(this._functions.keys());
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const DCXModule = Object.freeze({
    VERSION: DCX_VERSION,
    DCXRuntime: DCXRuntime,
    ExecutionTrace: ExecutionTrace,
    BoundViolationError: BoundViolationError
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DCXModule;
  } else if (typeof root !== 'undefined') {
    root.DCXModule = DCXModule;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
