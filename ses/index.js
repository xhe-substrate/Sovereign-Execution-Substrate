/**
 * SES-LAYER3 - Sovereign Execution Substrate Layer 3
 * Deterministic Controlled Execution (DCX) Reference Implementation
 * 
 * Single entry point for the frozen Layer 3 specification.
 * 
 * @version 1.0.0-frozen
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  const VERSION = '1.0.0';

  // ============================================
  // LOAD MODULES
  // ============================================
  let PulseSchema, ContentStoreModule, DCXModule;

  if (typeof require === 'function') {
    // Node.js environment
    PulseSchema = require('./pulse-schema.js');
    ContentStoreModule = require('./content-store.js');
    DCXModule = require('./dcx-runtime.js');
  } else {
    // Browser environment (assumes scripts loaded in order)
    PulseSchema = root.PulseSchema;
    ContentStoreModule = root.ContentStoreModule;
    DCXModule = root.DCXModule;
  }

  // ============================================
  // CONVENIENCE FACTORY
  // ============================================
  
  /**
   * Create a complete DCX environment
   * @param {Object} options - Configuration options
   * @returns {Object} { store, runtime }
   */
  function createDCXEnvironment(options = {}) {
    const store = new ContentStoreModule.ContentStore(options.store || {});
    const runtime = new DCXModule.DCXRuntime(store);
    
    return {
      store: store,
      runtime: runtime,
      
      // Convenience methods
      async createAndExecute(input, fn, bounds = {}) {
        const pulse = await runtime.createPulse({
          input: input,
          fn: fn,
          maxSteps: bounds.maxSteps,
          maxMemoryBytes: bounds.maxMemoryBytes,
          maxBranchDepth: bounds.maxBranchDepth,
          maxExecutionMs: bounds.maxExecutionMs,
          author: options.author || 'did:anonymous'
        });
        return runtime.execute(pulse);
      },
      
      async verify(pulse) {
        return runtime.verify(pulse);
      },
      
      async replay(pulseId) {
        return runtime.replay(pulseId);
      }
    };
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESLayer3 = Object.freeze({
    VERSION: VERSION,
    
    // Core modules
    PulseSchema: PulseSchema,
    ContentStore: ContentStoreModule.ContentStore,
    DCXRuntime: DCXModule.DCXRuntime,
    ExecutionTrace: DCXModule.ExecutionTrace,
    BoundViolationError: DCXModule.BoundViolationError,
    
    // CID utilities
    sha256: ContentStoreModule.sha256,
    djb2: ContentStoreModule.djb2,
    
    // Factory
    createDCXEnvironment: createDCXEnvironment,
    
    // Schema constants
    DEFAULT_BOUNDS: PulseSchema.DEFAULT_BOUNDS,
    PulseStatus: PulseSchema.PulseStatus,
    PULSE_SCHEMA: PulseSchema.PULSE_SCHEMA,
    TRACE_SCHEMA: PulseSchema.TRACE_SCHEMA,
    
    // Validation
    validatePulse: PulseSchema.validatePulse,
    createPulseTemplate: PulseSchema.createPulseTemplate
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESLayer3;
  } else if (typeof root !== 'undefined') {
    root.SESLayer3 = SESLayer3;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
