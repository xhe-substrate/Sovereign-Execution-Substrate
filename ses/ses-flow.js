/**
 * SES-FLOW.JS - Thin Flow Orchestrator
 * 
 * Only orchestrates Pulses. No business logic.
 * Respects all DCX invariants.
 * 
 * Core Properties:
 * - All execution goes through Pulses
 * - Bounded parallelism
 * - CID-wrapped results at every step
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // FLOW STEP TYPES
  // ============================================
  const STEP_TYPES = {
    PULSE: 'pulse',           // Execute a Pulse
    SEQUENCE: 'sequence',     // Sequential execution
    PARALLEL: 'parallel',     // Bounded parallel execution
    CONDITION: 'condition',   // Conditional branching
    MAP: 'map'               // Map over array with bounded parallelism
  };

  // ============================================
  // FLOW DEFINITION
  // JSONFlow-like DSL for orchestration
  // ============================================
  class FlowDefinition {
    constructor(options = {}) {
      this.id = null; // CID set after storage
      this.name = options.name || 'unnamed-flow';
      this.version = options.version || '1.0.0';
      this.author = options.author || 'did:anonymous';
      this.steps = options.steps || [];
      this.bounds = {
        maxParallel: options.maxParallel || 4,
        maxSteps: options.maxSteps || 100,
        maxTotalMs: options.maxTotalMs || 300000 // 5 minutes
      };
    }

    addStep(step) {
      this.steps.push(step);
      return this;
    }

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        version: this.version,
        author: this.author,
        steps: this.steps,
        bounds: this.bounds
      };
    }

    static fromJSON(json) {
      const flow = new FlowDefinition(json);
      flow.id = json.id;
      return flow;
    }
  }

  // ============================================
  // FLOW EXECUTOR
  // Executes flow definitions via DCX runtime
  // ============================================
  class FlowExecutor {
    constructor(runtime, store, context) {
      this.runtime = runtime;
      this.store = store;
      this.context = context;
      this.variables = new Map();
      this.stepCount = 0;
      this.startTime = null;
      this.aborted = false;
      this.listeners = [];
    }

    on(callback) {
      this.listeners.push(callback);
    }

    emit(event, data) {
      this.listeners.forEach(cb => cb(event, data));
    }

    // Check flow bounds
    checkFlowBounds(flow) {
      if (this.stepCount >= flow.bounds.maxSteps) {
        throw new Error(`Flow step limit exceeded: ${this.stepCount} >= ${flow.bounds.maxSteps}`);
      }
      
      const elapsed = Date.now() - this.startTime;
      if (elapsed >= flow.bounds.maxTotalMs) {
        throw new Error(`Flow time limit exceeded: ${elapsed}ms >= ${flow.bounds.maxTotalMs}ms`);
      }
    }

    // Execute a flow definition
    async execute(flow, initialVariables = {}) {
      this.variables = new Map(Object.entries(initialVariables));
      this.stepCount = 0;
      this.startTime = Date.now();
      this.aborted = false;

      const results = [];

      try {
        for (const step of flow.steps) {
          if (this.aborted) break;
          
          this.checkFlowBounds(flow);
          
          const result = await this.executeStep(step, flow);
          results.push(result);
          
          // Store step output in variables if named
          if (step.output) {
            this.variables.set(step.output, result);
          }
        }

        // Store flow result
        const flowResult = {
          flowId: flow.id,
          success: true,
          results,
          variables: Object.fromEntries(this.variables),
          stepCount: this.stepCount,
          totalMs: Date.now() - this.startTime
        };

        const resultCid = await this.store.store(flowResult);
        flowResult.resultCid = resultCid;

        this.emit('complete', flowResult);
        return flowResult;

      } catch (error) {
        const flowResult = {
          flowId: flow.id,
          success: false,
          error: { message: error.message, type: error.constructor.name },
          results,
          stepCount: this.stepCount,
          totalMs: Date.now() - this.startTime
        };

        this.emit('error', flowResult);
        return flowResult;
      }
    }

    // Execute a single step
    async executeStep(step, flow) {
      this.stepCount++;
      this.emit('step', { step, stepCount: this.stepCount });

      switch (step.type) {
        case STEP_TYPES.PULSE:
          return this.executePulse(step);

        case STEP_TYPES.SEQUENCE:
          return this.executeSequence(step, flow);

        case STEP_TYPES.PARALLEL:
          return this.executeParallel(step, flow);

        case STEP_TYPES.CONDITION:
          return this.executeCondition(step, flow);

        case STEP_TYPES.MAP:
          return this.executeMap(step, flow);

        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
    }

    // Execute a Pulse step
    async executePulse(step) {
      // Resolve input from variables
      const input = this.resolveValue(step.input);

      // Get or create function
      let functionCid = step.functionCid;
      if (step.fn && typeof step.fn === 'function') {
        functionCid = await this.runtime.registerFunction(step.fn);
      }

      // Create and execute pulse
      const pulse = await this.runtime.createPulse({
        input,
        functionCid,
        maxSteps: step.maxSteps,
        maxMemoryBytes: step.maxMemoryBytes,
        maxBranchDepth: step.maxBranchDepth,
        maxExecutionMs: step.maxExecutionMs,
        author: step.author
      });

      const result = await this.runtime.execute(pulse);

      // Update context
      if (this.context) {
        await this.context.fromPulse(result.pulse, result.output);
      }

      return result;
    }

    // Execute steps in sequence
    async executeSequence(step, flow) {
      const results = [];
      
      for (const subStep of step.steps) {
        this.checkFlowBounds(flow);
        const result = await this.executeStep(subStep, flow);
        results.push(result);
        
        if (subStep.output) {
          this.variables.set(subStep.output, result);
        }
      }

      return results;
    }

    // Execute steps in bounded parallel
    async executeParallel(step, flow) {
      const maxParallel = Math.min(
        step.maxParallel || flow.bounds.maxParallel,
        flow.bounds.maxParallel
      );

      const steps = step.steps;
      const results = new Array(steps.length);
      let index = 0;

      // Process in chunks of maxParallel
      while (index < steps.length) {
        this.checkFlowBounds(flow);
        
        const chunk = steps.slice(index, index + maxParallel);
        const chunkResults = await Promise.all(
          chunk.map(s => this.executeStep(s, flow))
        );
        
        for (let i = 0; i < chunkResults.length; i++) {
          results[index + i] = chunkResults[i];
        }
        
        index += maxParallel;
      }

      return results;
    }

    // Execute conditional step
    async executeCondition(step, flow) {
      const condition = this.resolveValue(step.condition);
      
      if (condition) {
        if (step.then) {
          return this.executeStep(step.then, flow);
        }
      } else {
        if (step.else) {
          return this.executeStep(step.else, flow);
        }
      }

      return null;
    }

    // Execute map over array with bounded parallelism
    async executeMap(step, flow) {
      const array = this.resolveValue(step.array);
      if (!Array.isArray(array)) {
        throw new Error('Map step requires an array');
      }

      const maxParallel = Math.min(
        step.maxParallel || flow.bounds.maxParallel,
        flow.bounds.maxParallel
      );

      const results = new Array(array.length);
      let index = 0;

      while (index < array.length) {
        this.checkFlowBounds(flow);
        
        const chunk = array.slice(index, index + maxParallel);
        const chunkResults = await Promise.all(
          chunk.map((item, i) => {
            // Set item variable for the step
            this.variables.set(step.itemVar || 'item', item);
            this.variables.set(step.indexVar || 'index', index + i);
            return this.executeStep(step.step, flow);
          })
        );
        
        for (let i = 0; i < chunkResults.length; i++) {
          results[index + i] = chunkResults[i];
        }
        
        index += maxParallel;
      }

      return results;
    }

    // Resolve a value (variable reference or literal)
    resolveValue(value) {
      if (value === undefined || value === null) return value;
      
      if (typeof value === 'string' && value.startsWith('$')) {
        const varName = value.slice(1);
        const parts = varName.split('.');
        
        let resolved = this.variables.get(parts[0]);
        
        // Handle nested property access
        for (let i = 1; i < parts.length && resolved !== undefined; i++) {
          resolved = resolved?.[parts[i]];
        }
        
        return resolved;
      }

      return value;
    }

    // Abort execution
    abort() {
      this.aborted = true;
    }
  }

  // ============================================
  // FLOW BUILDER
  // Fluent API for building flows
  // ============================================
  class FlowBuilder {
    constructor(name) {
      this.flow = new FlowDefinition({ name });
    }

    version(v) {
      this.flow.version = v;
      return this;
    }

    author(a) {
      this.flow.author = a;
      return this;
    }

    bounds(b) {
      this.flow.bounds = { ...this.flow.bounds, ...b };
      return this;
    }

    pulse(options) {
      this.flow.addStep({ type: STEP_TYPES.PULSE, ...options });
      return this;
    }

    sequence(steps) {
      this.flow.addStep({ type: STEP_TYPES.SEQUENCE, steps });
      return this;
    }

    parallel(steps, maxParallel) {
      this.flow.addStep({ type: STEP_TYPES.PARALLEL, steps, maxParallel });
      return this;
    }

    condition(condition, thenStep, elseStep) {
      this.flow.addStep({
        type: STEP_TYPES.CONDITION,
        condition,
        then: thenStep,
        else: elseStep
      });
      return this;
    }

    map(array, step, options = {}) {
      this.flow.addStep({
        type: STEP_TYPES.MAP,
        array,
        step,
        ...options
      });
      return this;
    }

    build() {
      return this.flow;
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESFlow = {
    STEP_TYPES,
    FlowDefinition,
    FlowExecutor,
    FlowBuilder,
    flow: (name) => new FlowBuilder(name)
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESFlow;
  } else {
    global.SESFlow = SESFlow;
  }

})(typeof window !== 'undefined' ? window : global);
