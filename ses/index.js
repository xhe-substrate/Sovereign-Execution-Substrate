(function(root) {
  'use strict';

  if (root.SESLayer3) return;

  const VERSION = '1.0.0';

  let PulseSchema, ContentStoreModule, DCXModule;

  if (typeof require === 'function') {
    PulseSchema = require('./pulse-schema.js');
    ContentStoreModule = require('./content-store.js');
    DCXModule = require('./dcx-runtime.js');
  } else {
    PulseSchema = root.PulseSchema;
    ContentStoreModule = root.ContentStoreModule;
    DCXModule = root.DCXModule;
  }

  function createDCXEnvironment(options = {}) {
    const store = new ContentStoreModule.ContentStore(options.store || {});
    const runtime = new DCXModule.DCXRuntime(store);

    return {
      store: store,
      runtime: runtime,
      async createAndExecute(input, fn, bounds = {}) {
        const pulse = await runtime.createPulse({
          input,
          fn,
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

  const SESLayer3 = Object.freeze({
    VERSION: VERSION,
    PulseSchema: PulseSchema,
    ContentStore: ContentStoreModule.ContentStore,
    DCXRuntime: DCXModule.DCXRuntime,
    ExecutionTrace: DCXModule.ExecutionTrace,
    BoundViolationError: DCXModule.BoundViolationError,
    sha256: ContentStoreModule.sha256,
    djb2: ContentStoreModule.djb2,
    createDCXEnvironment: createDCXEnvironment,
    DEFAULT_BOUNDS: PulseSchema.DEFAULT_BOUNDS,
    PulseStatus: PulseSchema.PulseStatus,
    PULSE_SCHEMA: PulseSchema.PULSE_SCHEMA,
    TRACE_SCHEMA: PulseSchema.TRACE_SCHEMA,
    validatePulse: PulseSchema.validatePulse,
    createPulseTemplate: PulseSchema.createPulseTemplate
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESLayer3;
  } else if (typeof root !== 'undefined') {
    root.SESLayer3 = SESLayer3;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));