/**
 * SES-VERIFY.JS - Pulse Chain Verification
 * Deterministic verification and replay of pulse chains
 *
 * Core Invariants:
 * - Every pulse is independently verifiable
 * - Chains are validated from genesis
 * - Determinism is cryptographically proven
 * - No external trust required
 *
 * @version 1.0.0
 * @depends ses-core.js, ses-store.js, ses-identity.js
 */

(function(global) {
  'use strict';

  /**
   * SESVerify - Pulse Chain Verification Engine
   */
  class SESVerify {
    constructor(runtime, store, identity) {
      this.runtime = runtime;
      this.store = store;
      this.identity = identity;
      
      // Verification cache (CID -> result)
      this.verificationCache = new Map();
      
      // Event listeners
      this.listeners = {
        'verifyStart': [],
        'verifyComplete': [],
        'verifyFailed': [],
        'chainProgress': []
      };
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

    /**
     * Verify a single pulse
     * Validates signature, bounds, and content integrity
     * 
     * @param {string|object} pulseCID - Pulse CID or pulse object
     * @returns {object} Verification result
     */
    async verifyPulse(pulseCID) {
      this.emit('verifyStart', { type: 'pulse', target: pulseCID });

      try {
        // Fetch pulse data if CID provided
        let pulse = pulseCID;
        if (typeof pulseCID === 'string') {
          pulse = await this.store.fetch(pulseCID);
          if (!pulse) {
            // Try pulses store
            pulse = await this.store.fetch(pulseCID, global.SESStore?.STORES?.PULSES || 'pulses');
          }
        }

        if (!pulse) {
          return this.failResult('PULSE_NOT_FOUND', `Pulse not found: ${pulseCID}`);
        }

        const checks = {
          structureValid: false,
          boundsValid: false,
          signatureValid: false,
          cidMatch: false,
          inputExists: false,
          outputExists: false,
          traceExists: false
        };

        // 1. Structure validation
        checks.structureValid = this.validatePulseStructure(pulse);
        if (!checks.structureValid) {
          return this.failResult('INVALID_STRUCTURE', 'Pulse structure is invalid');
        }

        // 2. Bounds validation
        checks.boundsValid = this.validateBounds(pulse.bounds);
        if (!checks.boundsValid) {
          return this.failResult('INVALID_BOUNDS', 'Pulse bounds are invalid');
        }

        // 3. Signature validation (if signed)
        if (pulse.signature && pulse.author && pulse.author !== 'did:anonymous') {
          checks.signatureValid = await this.verifySignature(pulse);
        } else {
          checks.signatureValid = true; // Unsigned pulses are valid (but less trusted)
        }

        // 4. CID match validation
        const computedCid = await this.computePulseCID(pulse);
        checks.cidMatch = pulse.pulseId === computedCid;

        // 5. Content existence checks
        if (pulse.inputCid) {
          checks.inputExists = await this.store.exists(pulse.inputCid);
        } else {
          checks.inputExists = true;
        }

        if (pulse.outputCid) {
          checks.outputExists = await this.store.exists(pulse.outputCid);
        }

        if (pulse.traceCid) {
          checks.traceExists = await this.store.exists(pulse.traceCid);
        }

        const allValid = Object.values(checks).every(v => v);
        const result = {
          valid: allValid,
          pulseId: pulse.pulseId,
          checks,
          pulse,
          verifiedAt: new Date().toISOString()
        };

        // Cache result
        if (pulse.pulseId) {
          this.verificationCache.set(pulse.pulseId, result);
        }

        this.emit('verifyComplete', result);
        return result;

      } catch (error) {
        return this.failResult('VERIFICATION_ERROR', error.message, error);
      }
    }

    /**
     * Replay a pulse to verify deterministic execution
     * Re-executes and compares output
     * 
     * @param {string|object} pulseCID - Pulse CID or pulse object
     * @returns {object} Replay result with determinism check
     */
    async replayPulse(pulseCID) {
      this.emit('verifyStart', { type: 'replay', target: pulseCID });

      try {
        // Fetch pulse
        let pulse = pulseCID;
        if (typeof pulseCID === 'string') {
          pulse = await this.store.fetch(pulseCID);
          if (!pulse) {
            pulse = await this.store.fetch(pulseCID, global.SESStore?.STORES?.PULSES || 'pulses');
          }
        }

        if (!pulse) {
          return this.failResult('PULSE_NOT_FOUND', `Pulse not found: ${pulseCID}`);
        }

        // Check if function is available for replay
        if (!this.runtime.getFunction(pulse.functionCid)) {
          return this.failResult('FUNCTION_NOT_FOUND', 
            `Function not registered: ${pulse.functionCid}. Cannot replay without function.`);
        }

        // Fetch expected outputs
        const expectedOutput = pulse.outputCid ? await this.store.fetch(pulse.outputCid) : null;
        const expectedTrace = pulse.traceCid ? await this.store.fetch(pulse.traceCid) : null;

        // Create replay pulse (same config, fresh execution)
        const replayPulse = global.SESCore.Pulse.fromJSON({
          ...pulse,
          pulseId: null,
          outputCid: null,
          traceCid: null,
          status: 'pending'
        });

        // Execute replay
        const replayResult = await this.runtime.execute(replayPulse);

        // Compare results
        const outputMatch = JSON.stringify(replayResult.output) === JSON.stringify(expectedOutput);
        const stepsMatch = replayResult.trace.totalSteps === expectedTrace?.totalSteps;
        const memoryMatch = Math.abs(replayResult.trace.peakMemory - (expectedTrace?.peakMemory || 0)) < 1024; // 1KB tolerance

        const isDeterministic = outputMatch && stepsMatch;

        const result = {
          valid: isDeterministic,
          deterministic: isDeterministic,
          pulseId: pulse.pulseId,
          comparison: {
            outputMatch,
            stepsMatch,
            memoryMatch,
            expectedSteps: expectedTrace?.totalSteps,
            replaySteps: replayResult.trace.totalSteps,
            expectedOutput: expectedOutput,
            replayOutput: replayResult.output
          },
          replayTrace: replayResult.trace,
          replaySuccess: replayResult.success,
          verifiedAt: new Date().toISOString()
        };

        this.emit('verifyComplete', result);
        return result;

      } catch (error) {
        return this.failResult('REPLAY_ERROR', error.message, error);
      }
    }

    /**
     * Verify an entire pulse chain from head to genesis
     * Walks back through parentPulseId links
     * 
     * @param {string} headCID - CID of the chain head (most recent pulse)
     * @returns {object} Chain verification result
     */
    async verifyChain(headCID) {
      this.emit('verifyStart', { type: 'chain', target: headCID });

      try {
        const chainResults = [];
        const visitedPulses = new Set();
        let currentCID = headCID;
        let chainLength = 0;
        let allValid = true;

        // Walk the chain backwards
        while (currentCID) {
          // Prevent infinite loops
          if (visitedPulses.has(currentCID)) {
            return this.failResult('CYCLE_DETECTED', `Cycle detected at pulse: ${currentCID}`);
          }
          visitedPulses.add(currentCID);
          chainLength++;

          // Emit progress
          this.emit('chainProgress', {
            currentPulse: currentCID,
            depth: chainLength,
            valid: allValid
          });

          // Check cache first
          if (this.verificationCache.has(currentCID)) {
            const cached = this.verificationCache.get(currentCID);
            chainResults.push({ cached: true, ...cached });
            
            if (!cached.valid) {
              allValid = false;
            }
            
            currentCID = cached.pulse?.parentPulseId;
            continue;
          }

          // Verify current pulse
          const verifyResult = await this.verifyPulse(currentCID);
          chainResults.push(verifyResult);

          if (!verifyResult.valid) {
            allValid = false;
          }

          // Move to parent
          currentCID = verifyResult.pulse?.parentPulseId;
        }

        const result = {
          valid: allValid,
          headCID,
          chainLength,
          genesisReached: true,
          pulseResults: chainResults,
          validPulses: chainResults.filter(r => r.valid).length,
          invalidPulses: chainResults.filter(r => !r.valid).length,
          verifiedAt: new Date().toISOString()
        };

        this.emit('verifyComplete', result);
        return result;

      } catch (error) {
        return this.failResult('CHAIN_VERIFICATION_ERROR', error.message, error);
      }
    }

    /**
     * Check determinism of a pulse against its trace
     * Ensures execution is reproducible
     * 
     * @param {object} pulse - Pulse object
     * @param {object} trace - Execution trace
     * @returns {object} Determinism check result
     */
    async checkDeterminism(pulse, trace) {
      const checks = {
        hasDeterministicSeed: !!trace.deterministicSeed,
        seedMatchesInput: trace.deterministicSeed === pulse.inputCid,
        noWallClockDependency: true,
        noRandomnessLeakage: true,
        boundsRespected: true,
        stepsAccountedFor: true
      };

      // Check for wall clock dependencies in trace
      if (trace.steps) {
        for (const step of trace.steps) {
          // Check for suspicious operations
          const op = step.operation?.toLowerCase() || '';
          if (op.includes('date') || op.includes('now') || op.includes('time')) {
            if (!op.includes('logical')) {
              checks.noWallClockDependency = false;
            }
          }
          if (op.includes('random') || op.includes('math.random')) {
            checks.noRandomnessLeakage = false;
          }
        }
      }

      // Verify bounds were respected
      if (trace.totalSteps > pulse.bounds.maxSteps) {
        checks.boundsRespected = false;
      }
      if (trace.peakMemory > pulse.bounds.maxMemoryBytes) {
        checks.boundsRespected = false;
      }
      if (trace.maxBranchDepth > pulse.bounds.maxBranchDepth) {
        checks.boundsRespected = false;
      }

      // Verify step accounting
      if (trace.steps && trace.steps.length !== trace.totalSteps) {
        checks.stepsAccountedFor = false;
      }

      const isDeterministic = Object.values(checks).every(v => v);

      return {
        deterministic: isDeterministic,
        checks,
        warnings: this.generateDeterminismWarnings(checks),
        verifiedAt: new Date().toISOString()
      };
    }

    /**
     * Batch verify multiple pulses
     */
    async verifyBatch(pulseCIDs) {
      const results = [];
      for (const cid of pulseCIDs) {
        results.push(await this.verifyPulse(cid));
      }
      return {
        total: pulseCIDs.length,
        valid: results.filter(r => r.valid).length,
        invalid: results.filter(r => !r.valid).length,
        results
      };
    }

    /**
     * Get verification statistics
     */
    getStats() {
      let validCount = 0;
      let invalidCount = 0;
      
      this.verificationCache.forEach(result => {
        if (result.valid) validCount++;
        else invalidCount++;
      });

      return {
        cached: this.verificationCache.size,
        valid: validCount,
        invalid: invalidCount
      };
    }

    /**
     * Clear verification cache
     */
    clearCache() {
      this.verificationCache.clear();
    }

    // ==========================================
    // HELPER METHODS
    // ==========================================

    validatePulseStructure(pulse) {
      const required = ['bounds', 'author', 'status'];
      for (const field of required) {
        if (pulse[field] === undefined) return false;
      }
      return true;
    }

    validateBounds(bounds) {
      if (!bounds) return false;
      return (
        bounds.maxSteps > 0 &&
        bounds.maxMemoryBytes > 0 &&
        bounds.maxBranchDepth > 0 &&
        bounds.maxExecutionMs > 0
      );
    }

    async verifySignature(pulse) {
      if (!this.identity || !pulse.signature) return false;
      
      try {
        // Resolve author's public key
        const authorIdentity = await this.identity.resolve(pulse.author);
        if (!authorIdentity) return false;

        // Create signing payload (pulse without signature)
        const signingPayload = { ...pulse };
        delete signingPayload.signature;

        return await this.identity.verify(
          signingPayload,
          pulse.signature,
          authorIdentity.publicKey
        );
      } catch (error) {
        console.error('Signature verification error:', error);
        return false;
      }
    }

    async computePulseCID(pulse) {
      // CID is computed from pulse without pulseId (chicken-egg)
      const pulseForCID = { ...pulse };
      delete pulseForCID.pulseId;
      
      if (global.SESCore && global.SESCore.generateCID) {
        return global.SESCore.generateCID(pulseForCID);
      }
      
      // Fallback
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(pulseForCID)));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return 'cid:sha256:' + hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    generateDeterminismWarnings(checks) {
      const warnings = [];
      if (!checks.hasDeterministicSeed) {
        warnings.push('No deterministic seed found in trace');
      }
      if (!checks.seedMatchesInput) {
        warnings.push('Deterministic seed does not match input CID');
      }
      if (!checks.noWallClockDependency) {
        warnings.push('Potential wall-clock dependency detected');
      }
      if (!checks.noRandomnessLeakage) {
        warnings.push('Potential randomness leakage detected');
      }
      if (!checks.boundsRespected) {
        warnings.push('Execution exceeded declared bounds');
      }
      if (!checks.stepsAccountedFor) {
        warnings.push('Step count mismatch in trace');
      }
      return warnings;
    }

    failResult(code, message, error = null) {
      const result = {
        valid: false,
        error: { code, message, details: error?.stack },
        verifiedAt: new Date().toISOString()
      };
      this.emit('verifyFailed', result);
      return result;
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESVerifyModule = {
    Verify: SESVerify,
    // Singleton instance
    instance: null,
    getInstance: async function(runtime, store, identity) {
      if (!this.instance) {
        const storeInst = store || (global.SESStore ? await global.SESStore.getInstance() : null);
        const identityInst = identity || (global.SESIdentity ? await global.SESIdentity.getInstance(storeInst) : null);
        this.instance = new SESVerify(runtime, storeInst, identityInst);
      }
      return this.instance;
    }
  };

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESVerifyModule;
  } else {
    global.SESVerify = SESVerifyModule;
  }

})(typeof window !== 'undefined' ? window : global);
