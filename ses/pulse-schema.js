/**
 * PULSE-SCHEMA.JS - Frozen Pulse Specification
 * Sovereign Execution Substrate - Layer 3
 * 
 * This is the CANONICAL schema definition.
 * No UI convenience, no implementation details.
 * 
 * @version 1.0.0-frozen
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // VERSION
  // ============================================
  const SCHEMA_VERSION = '1.0.0';

  // ============================================
  // DEFAULT RESOURCE BOUNDS
  // These are the maximum-safe defaults.
  // Implementations MUST enforce these.
  // ============================================
  const DEFAULT_BOUNDS = Object.freeze({
    maxSteps: 1000000,           // 1M steps
    maxMemoryBytes: 104857600,   // 100 MiB
    maxBranchDepth: 100,         // 100 nested branches
    maxExecutionMs: 30000        // 30 seconds hard cap
  });

  // ============================================
  // PULSE STATUS ENUM
  // ============================================
  const PulseStatus = Object.freeze({
    PENDING: 'pending',
    EXECUTING: 'executing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    VIOLATED: 'violated'
  });

  // ============================================
  // PULSE SCHEMA (JSON Schema Draft 2020-12)
  // ============================================
  const PULSE_SCHEMA = Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://ses.sovereign-substrate.org/schemas/pulse/1.0.0',
    title: 'Pulse',
    description: 'The fundamental, indivisible unit of computation in SES Layer 3',
    type: 'object',
    
    required: [
      'bounds',
      'inputCid',
      'functionCid',
      'author'
    ],
    
    properties: {
      // Identity
      pulseId: {
        type: ['string', 'null'],
        description: 'CID of this pulse (computed after execution)',
        pattern: '^cid:[a-z0-9]+:[a-f0-9]+$'
      },
      parentPulseId: {
        type: ['string', 'null'],
        description: 'CID of parent pulse (null for root pulses)'
      },
      
      // Logical Time
      logicalTick: {
        type: 'integer',
        minimum: 0,
        description: 'Monotonic logical clock (not wall-clock)'
      },
      
      // Resource Bounds (ENFORCED, NOT ADVISORY)
      bounds: {
        type: 'object',
        required: ['maxSteps', 'maxMemoryBytes', 'maxBranchDepth', 'maxExecutionMs'],
        additionalProperties: false,
        properties: {
          maxSteps: {
            type: 'integer',
            minimum: 1,
            maximum: 1000000000,
            description: 'Maximum execution steps'
          },
          maxMemoryBytes: {
            type: 'integer',
            minimum: 1,
            maximum: 1073741824,
            description: 'Maximum memory allocation in bytes'
          },
          maxBranchDepth: {
            type: 'integer',
            minimum: 1,
            maximum: 1000,
            description: 'Maximum recursion/branch depth'
          },
          maxExecutionMs: {
            type: 'integer',
            minimum: 1,
            maximum: 300000,
            description: 'Hard timeout in milliseconds'
          }
        }
      },
      
      // Content-Addressed References
      inputCid: {
        type: 'string',
        description: 'CID of input data'
      },
      functionCid: {
        type: 'string',
        description: 'CID of execution function'
      },
      outputCid: {
        type: ['string', 'null'],
        description: 'CID of output (set after execution)'
      },
      traceCid: {
        type: ['string', 'null'],
        description: 'CID of execution trace (set after execution)'
      },
      
      // Authorship
      author: {
        type: 'string',
        description: 'DID of the pulse author'
      },
      signature: {
        type: ['string', 'null'],
        description: 'Cryptographic signature (Ed25519)'
      },
      
      // Execution State
      status: {
        type: 'string',
        enum: ['pending', 'executing', 'completed', 'failed', 'violated'],
        description: 'Current execution status'
      },
      
      // Error (only if status is failed or violated)
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
    },
    
    additionalProperties: false
  });

  // ============================================
  // EXECUTION TRACE SCHEMA
  // ============================================
  const TRACE_SCHEMA = Object.freeze({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://ses.sovereign-substrate.org/schemas/trace/1.0.0',
    title: 'ExecutionTrace',
    description: 'Complete execution record for deterministic replay',
    type: 'object',
    
    required: ['steps', 'totalSteps', 'peakMemory', 'maxBranchDepth', 'deterministicSeed'],
    
    properties: {
      steps: {
        type: 'array',
        items: {
          type: 'object',
          required: ['tick', 'operation'],
          properties: {
            tick: { type: 'integer', minimum: 0 },
            operation: { type: 'string' },
            args: { },
            result: { },
            memory: { type: 'integer', minimum: 0 }
          }
        }
      },
      totalSteps: { type: 'integer', minimum: 0 },
      peakMemory: { type: 'integer', minimum: 0 },
      maxBranchDepth: { type: 'integer', minimum: 0 },
      deterministicSeed: { type: 'string' },
      startTime: { type: 'string' },
      endTime: { type: 'string' }
    },
    
    additionalProperties: false
  });

  // ============================================
  // PULSE VALIDATOR
  // ============================================
  function validatePulse(pulse) {
    const errors = [];
    
    // Required fields
    if (!pulse.bounds) {
      errors.push('Missing required field: bounds');
    } else {
      if (typeof pulse.bounds.maxSteps !== 'number' || pulse.bounds.maxSteps < 1) {
        errors.push('bounds.maxSteps must be a positive integer');
      }
      if (typeof pulse.bounds.maxMemoryBytes !== 'number' || pulse.bounds.maxMemoryBytes < 1) {
        errors.push('bounds.maxMemoryBytes must be a positive integer');
      }
      if (typeof pulse.bounds.maxBranchDepth !== 'number' || pulse.bounds.maxBranchDepth < 1) {
        errors.push('bounds.maxBranchDepth must be a positive integer');
      }
      if (typeof pulse.bounds.maxExecutionMs !== 'number' || pulse.bounds.maxExecutionMs < 1) {
        errors.push('bounds.maxExecutionMs must be a positive integer');
      }
    }
    
    if (typeof pulse.inputCid !== 'string' || !pulse.inputCid) {
      errors.push('Missing required field: inputCid');
    }
    
    if (typeof pulse.functionCid !== 'string' || !pulse.functionCid) {
      errors.push('Missing required field: functionCid');
    }
    
    if (typeof pulse.author !== 'string' || !pulse.author) {
      errors.push('Missing required field: author');
    }
    
    // Status validation
    if (pulse.status && !Object.values(PulseStatus).includes(pulse.status)) {
      errors.push('Invalid status value');
    }
    
    // CID pattern validation
    const cidPattern = /^cid:[a-z0-9]+:[a-f0-9]+$/;
    if (pulse.pulseId && !cidPattern.test(pulse.pulseId)) {
      errors.push('Invalid pulseId format');
    }
    if (pulse.inputCid && !cidPattern.test(pulse.inputCid)) {
      errors.push('Invalid inputCid format');
    }
    if (pulse.functionCid && !cidPattern.test(pulse.functionCid)) {
      errors.push('Invalid functionCid format');
    }
    
    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  // ============================================
  // PULSE FACTORY
  // ============================================
  function createPulseTemplate(options) {
    return {
      pulseId: null,
      parentPulseId: options.parentPulseId || null,
      logicalTick: options.logicalTick || 0,
      bounds: {
        maxSteps: options.maxSteps || DEFAULT_BOUNDS.maxSteps,
        maxMemoryBytes: options.maxMemoryBytes || DEFAULT_BOUNDS.maxMemoryBytes,
        maxBranchDepth: options.maxBranchDepth || DEFAULT_BOUNDS.maxBranchDepth,
        maxExecutionMs: options.maxExecutionMs || DEFAULT_BOUNDS.maxExecutionMs
      },
      inputCid: options.inputCid || null,
      functionCid: options.functionCid || null,
      outputCid: null,
      traceCid: null,
      author: options.author || 'did:anonymous',
      signature: null,
      status: PulseStatus.PENDING,
      error: null
    };
  }

  // ============================================
  // EXPORT
  // ============================================
  const PulseSchema = Object.freeze({
    VERSION: SCHEMA_VERSION,
    DEFAULT_BOUNDS: DEFAULT_BOUNDS,
    PulseStatus: PulseStatus,
    PULSE_SCHEMA: PULSE_SCHEMA,
    TRACE_SCHEMA: TRACE_SCHEMA,
    validatePulse: validatePulse,
    createPulseTemplate: createPulseTemplate
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PulseSchema;
  } else if (typeof root !== 'undefined') {
    root.PulseSchema = PulseSchema;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
