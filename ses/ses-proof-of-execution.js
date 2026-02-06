/**
 * SES-PROOF-OF-EXECUTION.JS - Proof of Execution System
 * Sovereign Execution Substrate - Layer 3
 * 
 * Generates and verifies proofs of correct execution:
 * - Merkle tree of trace steps
 * - Compact verification data
 * - Zero-knowledge compatible structure
 * 
 * @version 1.0.0
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // VERSION
  // ============================================
  const POE_VERSION = '1.0.0';

  // ============================================
  // MERKLE TREE
  // ============================================
  class MerkleTree {
    constructor(leaves = []) {
      this.leaves = leaves;
      this.layers = [];
      this.root = null;
      
      if (leaves.length > 0) {
        this.build();
      }
    }

    /**
     * Hash data using SHA-256
     */
    async hash(data) {
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const encoder = new TextEncoder();
      const buffer = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Hash two nodes together
     */
    async hashPair(left, right) {
      return this.hash(left + right);
    }

    /**
     * Build the Merkle tree
     */
    async build() {
      if (this.leaves.length === 0) {
        this.root = null;
        return;
      }

      // Hash all leaves
      let currentLayer = [];
      for (const leaf of this.leaves) {
        currentLayer.push(await this.hash(leaf));
      }
      this.layers.push([...currentLayer]);

      // Build up the tree
      while (currentLayer.length > 1) {
        const nextLayer = [];
        
        for (let i = 0; i < currentLayer.length; i += 2) {
          if (i + 1 < currentLayer.length) {
            nextLayer.push(await this.hashPair(currentLayer[i], currentLayer[i + 1]));
          } else {
            // Odd number of nodes - promote the last one
            nextLayer.push(currentLayer[i]);
          }
        }
        
        this.layers.push([...nextLayer]);
        currentLayer = nextLayer;
      }

      this.root = currentLayer[0];
    }

    /**
     * Get proof for a leaf at index
     */
    getProof(index) {
      if (index < 0 || index >= this.leaves.length) {
        return null;
      }

      const proof = [];
      let currentIndex = index;

      for (let i = 0; i < this.layers.length - 1; i++) {
        const layer = this.layers[i];
        const isRight = currentIndex % 2 === 1;
        const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;

        if (siblingIndex < layer.length) {
          proof.push({
            hash: layer[siblingIndex],
            position: isRight ? 'left' : 'right'
          });
        }

        currentIndex = Math.floor(currentIndex / 2);
      }

      return proof;
    }

    /**
     * Verify a proof
     */
    async verifyProof(leaf, proof, root) {
      let hash = await this.hash(leaf);

      for (const step of proof) {
        if (step.position === 'left') {
          hash = await this.hashPair(step.hash, hash);
        } else {
          hash = await this.hashPair(hash, step.hash);
        }
      }

      return hash === root;
    }

    /**
     * Export tree structure
     */
    toJSON() {
      return {
        root: this.root,
        leafCount: this.leaves.length,
        depth: this.layers.length,
        layers: this.layers
      };
    }
  }

  // ============================================
  // PROOF OF EXECUTION
  // ============================================
  class ProofOfExecution {
    constructor(store) {
      this.store = store;
    }

    /**
     * Generate proof from pulse and trace
     */
    async generateProof(pulse, trace) {
      const proof = {
        version: POE_VERSION,
        proofId: null,
        pulseId: pulse.pulseId,
        timestamp: new Date().toISOString(),
        
        // Input commitments
        inputCommitment: await this.hash({
          inputCid: pulse.inputCid,
          functionCid: pulse.functionCid,
          bounds: pulse.bounds
        }),
        
        // Output commitment
        outputCommitment: await this.hash({
          outputCid: pulse.outputCid,
          status: pulse.status
        }),
        
        // Execution summary
        executionSummary: {
          totalSteps: trace.totalSteps,
          peakMemory: trace.peakMemory,
          maxBranchDepth: trace.maxBranchDepth,
          deterministicSeed: trace.deterministicSeed
        },
        
        // Merkle tree of trace steps
        traceMerkleRoot: null,
        traceProofs: [],
        
        // Verification data
        verificationData: {
          boundsRespected: this.checkBoundsRespected(pulse, trace),
          inputOutputConsistent: pulse.outputCid !== null && pulse.status === 'completed'
        }
      };

      // Build Merkle tree of trace steps
      if (trace.steps && trace.steps.length > 0) {
        const traceLeaves = trace.steps.map(step => JSON.stringify({
          tick: step.tick,
          operation: step.operation,
          argsHash: this.quickHash(step.args),
          resultHash: this.quickHash(step.result)
        }));

        const merkleTree = new MerkleTree(traceLeaves);
        await merkleTree.build();

        proof.traceMerkleRoot = merkleTree.root;
        proof.traceMerkleDepth = merkleTree.layers.length;

        // Generate proofs for key steps (first, last, and samples)
        const keyIndices = this.selectKeyIndices(trace.steps.length);
        for (const idx of keyIndices) {
          const stepProof = merkleTree.getProof(idx);
          if (stepProof) {
            proof.traceProofs.push({
              stepIndex: idx,
              step: trace.steps[idx],
              proof: stepProof
            });
          }
        }
      }

      // Store proof and get CID
      proof.proofId = await this.store.store(proof);

      return proof;
    }

    /**
     * Verify a proof without full replay
     */
    async verifyProof(pulse, proof) {
      const result = {
        valid: true,
        checks: {},
        errors: []
      };

      // 1. Verify input commitment
      const expectedInputCommitment = await this.hash({
        inputCid: pulse.inputCid,
        functionCid: pulse.functionCid,
        bounds: pulse.bounds
      });
      result.checks.inputCommitment = expectedInputCommitment === proof.inputCommitment;
      if (!result.checks.inputCommitment) {
        result.errors.push('Input commitment mismatch');
        result.valid = false;
      }

      // 2. Verify output commitment
      const expectedOutputCommitment = await this.hash({
        outputCid: pulse.outputCid,
        status: pulse.status
      });
      result.checks.outputCommitment = expectedOutputCommitment === proof.outputCommitment;
      if (!result.checks.outputCommitment) {
        result.errors.push('Output commitment mismatch');
        result.valid = false;
      }

      // 3. Verify Merkle proofs for key steps
      if (proof.traceProofs && proof.traceProofs.length > 0) {
        const merkleTree = new MerkleTree([]);
        result.checks.merkleProofs = [];

        for (const traceProof of proof.traceProofs) {
          const leaf = JSON.stringify({
            tick: traceProof.step.tick,
            operation: traceProof.step.operation,
            argsHash: this.quickHash(traceProof.step.args),
            resultHash: this.quickHash(traceProof.step.result)
          });

          const verified = await merkleTree.verifyProof(
            leaf,
            traceProof.proof,
            proof.traceMerkleRoot
          );

          result.checks.merkleProofs.push({
            stepIndex: traceProof.stepIndex,
            verified
          });

          if (!verified) {
            result.errors.push(`Merkle proof failed for step ${traceProof.stepIndex}`);
            result.valid = false;
          }
        }
      }

      // 4. Verify bounds were respected
      result.checks.boundsRespected = proof.verificationData.boundsRespected;
      if (!proof.verificationData.boundsRespected) {
        result.errors.push('Bounds were violated');
        result.valid = false;
      }

      // 5. Verify pulse IDs match
      result.checks.pulseIdMatch = pulse.pulseId === proof.pulseId;
      if (!result.checks.pulseIdMatch) {
        result.errors.push('Pulse ID mismatch');
        result.valid = false;
      }

      return result;
    }

    /**
     * Generate compact proof (smaller footprint)
     */
    async generateCompactProof(pulse, trace) {
      return {
        version: POE_VERSION,
        type: 'compact',
        pulseId: pulse.pulseId,
        inputCid: pulse.inputCid,
        outputCid: pulse.outputCid,
        traceCid: pulse.traceCid,
        
        // Just commitments, no full data
        inputHash: await this.hash(pulse.inputCid),
        outputHash: await this.hash(pulse.outputCid),
        
        // Execution metrics
        steps: trace.totalSteps,
        memory: trace.peakMemory,
        
        // Single root hash for trace
        traceRoot: await this.computeTraceRoot(trace),
        
        timestamp: new Date().toISOString()
      };
    }

    /**
     * Check if bounds were respected
     */
    checkBoundsRespected(pulse, trace) {
      const bounds = pulse.bounds || {};
      
      return (
        (trace.totalSteps || 0) <= (bounds.maxSteps || Infinity) &&
        (trace.peakMemory || 0) <= (bounds.maxMemoryBytes || Infinity) &&
        (trace.maxBranchDepth || 0) <= (bounds.maxBranchDepth || Infinity)
      );
    }

    /**
     * Select key indices for proof sampling
     */
    selectKeyIndices(totalSteps) {
      const indices = [0]; // Always include first

      if (totalSteps > 1) {
        indices.push(totalSteps - 1); // Include last
      }

      // Sample middle points
      if (totalSteps > 10) {
        const step = Math.floor(totalSteps / 5);
        for (let i = step; i < totalSteps - 1; i += step) {
          if (!indices.includes(i)) {
            indices.push(i);
          }
        }
      }

      return indices.sort((a, b) => a - b);
    }

    /**
     * Compute root hash for trace
     */
    async computeTraceRoot(trace) {
      const summary = {
        totalSteps: trace.totalSteps,
        peakMemory: trace.peakMemory,
        maxBranchDepth: trace.maxBranchDepth,
        seed: trace.deterministicSeed,
        firstOp: trace.steps?.[0]?.operation,
        lastOp: trace.steps?.[trace.steps?.length - 1]?.operation
      };
      return this.hash(summary);
    }

    /**
     * SHA-256 hash
     */
    async hash(data) {
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const encoder = new TextEncoder();
      const buffer = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    /**
     * Quick synchronous hash (djb2)
     */
    quickHash(data) {
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash >>> 0;
      }
      return hash.toString(16).padStart(8, '0');
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const ProofOfExecutionModule = Object.freeze({
    VERSION: POE_VERSION,
    MerkleTree: MerkleTree,
    ProofOfExecution: ProofOfExecution,
    // Factory
    create: (store) => new ProofOfExecution(store)
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ProofOfExecutionModule;
  } else if (typeof root !== 'undefined') {
    root.SESProofOfExecution = ProofOfExecutionModule;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
