/**
 * SES-CLAIMS.JS - Claim System for Layer 4 Consensus
 * Sovereign Execution Substrate - Layer 4
 * 
 * Foundation for epistemic consensus:
 * - Claims about subjects with evidence
 * - Attestations from agents
 * - Confidence scoring
 * - CID-wrapped for auditability
 * 
 * @version 1.0.0
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // VERSION
  // ============================================
  const CLAIMS_VERSION = '1.0.0';

  // ============================================
  // CLAIM PREDICATES
  // ============================================
  const PREDICATES = Object.freeze({
    VALID: 'valid',           // Content is valid
    USEFUL: 'useful',         // Content is useful
    CORRECT: 'correct',       // Computation is correct
    PREFERRED: 'preferred',   // Content is preferred choice
    NOVEL: 'novel',           // Content is novel/original
    ACCURATE: 'accurate',     // Information is accurate
    COMPLETE: 'complete',     // Work is complete
    EFFICIENT: 'efficient'    // Implementation is efficient
  });

  // ============================================
  // VERDICT TYPES
  // ============================================
  const VERDICTS = Object.freeze({
    ACCEPT: 'accept',
    REJECT: 'reject',
    ABSTAIN: 'abstain'
  });

  // ============================================
  // CLAIM CLASS
  // ============================================
  class Claim {
    constructor(options = {}) {
      this.claimId = null;  // CID set after storage
      this.author = options.author || 'did:anonymous';
      this.subject = options.subject; // CID of subject being claimed about
      this.predicate = options.predicate || PREDICATES.VALID;
      this.object = options.object || null; // Additional claim data
      this.evidenceCids = options.evidenceCids || []; // CIDs of supporting evidence
      this.confidence = Math.max(0, Math.min(1, options.confidence || 0.5)); // 0.0 - 1.0
      this.timestamp = new Date().toISOString();
      this.logicalTick = options.logicalTick || 0;
      this.signature = null;
      this.metadata = options.metadata || {};
    }

    /**
     * Add evidence CID
     */
    addEvidence(cid) {
      if (!this.evidenceCids.includes(cid)) {
        this.evidenceCids.push(cid);
      }
      return this;
    }

    /**
     * Serialize for storage/signing
     */
    toJSON() {
      return {
        claimId: this.claimId,
        author: this.author,
        subject: this.subject,
        predicate: this.predicate,
        object: this.object,
        evidenceCids: this.evidenceCids,
        confidence: this.confidence,
        timestamp: this.timestamp,
        logicalTick: this.logicalTick,
        signature: this.signature,
        metadata: this.metadata
      };
    }

    /**
     * Create from JSON
     */
    static fromJSON(json) {
      const claim = new Claim(json);
      claim.claimId = json.claimId;
      claim.signature = json.signature;
      claim.timestamp = json.timestamp;
      return claim;
    }

    /**
     * Get signing payload (without signature)
     */
    getSigningPayload() {
      const payload = this.toJSON();
      delete payload.signature;
      delete payload.claimId;
      return payload;
    }
  }

  // ============================================
  // ATTESTATION CLASS
  // ============================================
  class Attestation {
    constructor(options = {}) {
      this.attestationId = null; // CID set after storage
      this.claimId = options.claimId;
      this.agent = options.agent || 'did:anonymous';
      this.verdict = options.verdict || VERDICTS.ABSTAIN;
      this.confidence = Math.max(0, Math.min(1, options.confidence || 0.5));
      this.reasoningCid = options.reasoningCid || null; // CID of detailed reasoning
      this.timestamp = new Date().toISOString();
      this.logicalTick = options.logicalTick || 0;
      this.signature = null;
    }

    toJSON() {
      return {
        attestationId: this.attestationId,
        claimId: this.claimId,
        agent: this.agent,
        verdict: this.verdict,
        confidence: this.confidence,
        reasoningCid: this.reasoningCid,
        timestamp: this.timestamp,
        logicalTick: this.logicalTick,
        signature: this.signature
      };
    }

    static fromJSON(json) {
      const att = new Attestation(json);
      att.attestationId = json.attestationId;
      att.signature = json.signature;
      att.timestamp = json.timestamp;
      return att;
    }

    getSigningPayload() {
      const payload = this.toJSON();
      delete payload.signature;
      delete payload.attestationId;
      return payload;
    }
  }

  // ============================================
  // CLAIM ENGINE
  // ============================================
  class ClaimEngine {
    constructor(store, identity) {
      this.store = store;
      this.identity = identity;
      this.claims = new Map();        // claimId -> Claim
      this.attestations = new Map();  // attestationId -> Attestation
      this.claimAttestations = new Map(); // claimId -> attestationId[]
      this.listeners = [];
    }

    on(callback) {
      this.listeners.push(callback);
    }

    emit(event, data) {
      this.listeners.forEach(cb => {
        try {
          cb(event, data);
        } catch (e) {
          console.error('ClaimEngine listener error:', e);
        }
      });
    }

    /**
     * Create a new claim
     */
    async createClaim(subject, predicate, options = {}) {
      const claim = new Claim({
        author: this.identity?.getDID() || 'did:anonymous',
        subject,
        predicate,
        object: options.object,
        evidenceCids: options.evidenceCids || [],
        confidence: options.confidence || 0.5,
        logicalTick: options.logicalTick || Date.now(),
        metadata: options.metadata || {}
      });

      // Sign if identity available
      if (this.identity && this.identity.sign) {
        try {
          const signResult = await this.identity.sign(claim.getSigningPayload());
          claim.signature = signResult.signature;
        } catch (e) {
          console.warn('Failed to sign claim:', e);
        }
      }

      // Store and get CID
      const claimCid = await this.store.store(claim.toJSON());
      claim.claimId = claimCid;

      // Track locally
      this.claims.set(claimCid, claim);
      this.claimAttestations.set(claimCid, []);

      this.emit('claimCreated', { claim: claim.toJSON() });

      return claim;
    }

    /**
     * Attest to a claim
     */
    async attestClaim(claimId, verdict, options = {}) {
      // Verify claim exists
      let claim = this.claims.get(claimId);
      if (!claim) {
        const claimData = await this.store.fetch(claimId);
        if (!claimData) {
          throw new Error(`Claim not found: ${claimId}`);
        }
        claim = Claim.fromJSON(claimData);
        this.claims.set(claimId, claim);
      }

      // Store reasoning if provided
      let reasoningCid = null;
      if (options.reasoning) {
        reasoningCid = await this.store.store({
          type: 'attestation_reasoning',
          claimId: claimId,
          reasoning: options.reasoning,
          timestamp: new Date().toISOString()
        });
      }

      const attestation = new Attestation({
        claimId,
        agent: this.identity?.getDID() || 'did:anonymous',
        verdict,
        confidence: options.confidence || 0.5,
        reasoningCid,
        logicalTick: options.logicalTick || Date.now()
      });

      // Sign if identity available
      if (this.identity && this.identity.sign) {
        try {
          const signResult = await this.identity.sign(attestation.getSigningPayload());
          attestation.signature = signResult.signature;
        } catch (e) {
          console.warn('Failed to sign attestation:', e);
        }
      }

      // Store and get CID
      const attCid = await this.store.store(attestation.toJSON());
      attestation.attestationId = attCid;

      // Track locally
      this.attestations.set(attCid, attestation);
      if (!this.claimAttestations.has(claimId)) {
        this.claimAttestations.set(claimId, []);
      }
      this.claimAttestations.get(claimId).push(attCid);

      this.emit('attestationCreated', { 
        attestation: attestation.toJSON(),
        claimId 
      });

      return attestation;
    }

    /**
     * Get all attestations for a claim
     */
    async getAttestations(claimId) {
      const attCids = this.claimAttestations.get(claimId) || [];
      const attestations = [];

      for (const cid of attCids) {
        let att = this.attestations.get(cid);
        if (!att) {
          const attData = await this.store.fetch(cid);
          if (attData) {
            att = Attestation.fromJSON(attData);
            this.attestations.set(cid, att);
          }
        }
        if (att) {
          attestations.push(att);
        }
      }

      return attestations;
    }

    /**
     * Get claim by CID
     */
    async getClaim(claimId) {
      let claim = this.claims.get(claimId);
      if (!claim) {
        const claimData = await this.store.fetch(claimId);
        if (claimData) {
          claim = Claim.fromJSON(claimData);
          this.claims.set(claimId, claim);
        }
      }
      return claim;
    }

    /**
     * Calculate consensus score for a claim
     * Returns weighted average of attestation verdicts
     */
    async calculateConsensus(claimId) {
      const attestations = await this.getAttestations(claimId);

      if (attestations.length === 0) {
        return {
          claimId,
          consensus: null,
          reason: 'No attestations',
          totalAttestations: 0
        };
      }

      // Tally verdicts weighted by confidence
      let acceptScore = 0;
      let rejectScore = 0;
      let totalWeight = 0;

      for (const att of attestations) {
        const weight = att.confidence;
        totalWeight += weight;

        if (att.verdict === VERDICTS.ACCEPT) {
          acceptScore += weight;
        } else if (att.verdict === VERDICTS.REJECT) {
          rejectScore += weight;
        }
        // ABSTAIN doesn't contribute to scores
      }

      if (totalWeight === 0) {
        return {
          claimId,
          consensus: VERDICTS.ABSTAIN,
          acceptScore: 0,
          rejectScore: 0,
          totalAttestations: attestations.length,
          totalWeight: 0
        };
      }

      const normalizedAccept = acceptScore / totalWeight;
      const normalizedReject = rejectScore / totalWeight;

      // Determine consensus
      let consensus;
      if (normalizedAccept > 0.6) {
        consensus = VERDICTS.ACCEPT;
      } else if (normalizedReject > 0.6) {
        consensus = VERDICTS.REJECT;
      } else {
        consensus = VERDICTS.ABSTAIN;
      }

      return {
        claimId,
        consensus,
        acceptScore: normalizedAccept,
        rejectScore: normalizedReject,
        totalAttestations: attestations.length,
        totalWeight,
        attestations: attestations.map(a => a.toJSON())
      };
    }

    /**
     * List all claims
     */
    listClaims() {
      return Array.from(this.claims.values()).map(c => c.toJSON());
    }

    /**
     * List all attestations
     */
    listAttestations() {
      return Array.from(this.attestations.values()).map(a => a.toJSON());
    }

    /**
     * Export all claims and attestations
     */
    export() {
      return {
        version: CLAIMS_VERSION,
        exportedAt: new Date().toISOString(),
        claims: this.listClaims(),
        attestations: this.listAttestations()
      };
    }

    /**
     * Import claims and attestations
     */
    async import(data) {
      if (data.claims) {
        for (const claimData of data.claims) {
          const claim = Claim.fromJSON(claimData);
          this.claims.set(claim.claimId, claim);
          if (!this.claimAttestations.has(claim.claimId)) {
            this.claimAttestations.set(claim.claimId, []);
          }
        }
      }

      if (data.attestations) {
        for (const attData of data.attestations) {
          const att = Attestation.fromJSON(attData);
          this.attestations.set(att.attestationId, att);
          if (att.claimId && this.claimAttestations.has(att.claimId)) {
            this.claimAttestations.get(att.claimId).push(att.attestationId);
          }
        }
      }

      return {
        importedClaims: data.claims?.length || 0,
        importedAttestations: data.attestations?.length || 0
      };
    }

    /**
     * Get statistics
     */
    getStats() {
      const attestationsByVerdict = {
        accept: 0,
        reject: 0,
        abstain: 0
      };

      this.attestations.forEach(att => {
        attestationsByVerdict[att.verdict] = (attestationsByVerdict[att.verdict] || 0) + 1;
      });

      return {
        totalClaims: this.claims.size,
        totalAttestations: this.attestations.size,
        attestationsByVerdict,
        uniqueAgents: new Set(Array.from(this.attestations.values()).map(a => a.agent)).size
      };
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const ClaimsModule = Object.freeze({
    VERSION: CLAIMS_VERSION,
    PREDICATES: PREDICATES,
    VERDICTS: VERDICTS,
    Claim: Claim,
    Attestation: Attestation,
    ClaimEngine: ClaimEngine,
    // Factory
    createEngine: (store, identity) => new ClaimEngine(store, identity)
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ClaimsModule;
  } else if (typeof root !== 'undefined') {
    root.SESClaims = ClaimsModule;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
