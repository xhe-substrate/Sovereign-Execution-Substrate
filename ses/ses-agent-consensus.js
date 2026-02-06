/**
 * SES Agent Consensus - Layer 4 Consensus via Reasoning
 * 
 * Implements agent-first epistemic consensus where agreement emerges from
 * reasoning about claims, not from hash power or stake.
 * 
 * Core Principles:
 * - Consensus through reasoning, not computation
 * - Evidence-based confidence scoring
 * - Multi-agent deliberation
 * - Transparent reasoning traces
 * - No proof-of-work, no proof-of-stake
 * 
 * Agents reason about claims and build evidence chains to support or refute them.
 */

class EvidenceChain {
  constructor(data) {
    this.id = data.id;
    this.claim_id = data.claim_id;
    this.agent_did = data.agent_did;
    this.position = data.position; // 'support' | 'refute' | 'neutral'
    this.confidence = data.confidence || 0.5; // 0-1
    this.reasoning = data.reasoning;
    this.evidence_cids = data.evidence_cids || [];
    this.timestamp = data.timestamp || Date.now();
    this.signature = data.signature;
  }
}

class ConsensusResult {
  constructor(data) {
    this.claim_id = data.claim_id;
    this.verdict = data.verdict; // 'accept' | 'reject' | 'uncertain'
    this.confidence = data.confidence;
    this.support_count = data.support_count || 0;
    this.refute_count = data.refute_count || 0;
    this.neutral_count = data.neutral_count || 0;
    this.evidence_chains = data.evidence_chains || [];
    this.reasoning_summary = data.reasoning_summary;
    this.timestamp = data.timestamp || Date.now();
    this.finalized = data.finalized || false;
  }
}

class AgentConsensus {
  constructor(config = {}) {
    this.store = config.store;
    this.aiInterface = config.aiInterface;
    this.claimsRegistry = config.claimsRegistry;
    
    // Consensus parameters
    this.minAgents = config.minAgents || 3;
    this.confidenceThreshold = config.confidenceThreshold || 0.7;
    this.unanimityBonus = config.unanimityBonus || 0.1;
    
    this.evidenceChains = new Map(); // claim_id -> EvidenceChain[]
    this.consensusResults = new Map(); // claim_id -> ConsensusResult
    
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      const stored = await this.store.get('agent_consensus');
      if (stored) {
        const data = JSON.parse(stored);
        
        // Restore evidence chains
        for (const [claimId, chains] of Object.entries(data.evidenceChains || {})) {
          this.evidenceChains.set(claimId, chains.map(c => new EvidenceChain(c)));
        }
        
        // Restore consensus results
        for (const [claimId, result] of Object.entries(data.consensusResults || {})) {
          this.consensusResults.set(claimId, new ConsensusResult(result));
        }
      }
    } catch (error) {
      console.warn('[AgentConsensus] Failed to load from store:', error);
    }
    
    this.initialized = true;
    console.log(`[AgentConsensus] Initialized with ${this.consensusResults.size} consensus results`);
  }
  
  /**
   * Multi-agent reasoning on a claim
   */
  async reason(claim, agentConfig = {}) {
    await this.initialize();
    
    console.log(`[AgentConsensus] Starting reasoning on claim: ${claim.subject}`);
    
    // Get or create claim
    const claimId = await this._getOrCreateClaim(claim);
    
    // Generate multiple agent perspectives
    const numAgents = agentConfig.numAgents || this.minAgents;
    const agents = await this._generateAgentPerspectives(numAgents);
    
    // Each agent reasons independently
    const evidenceChains = [];
    for (const agent of agents) {
      const evidence = await this._agentReason(claimId, claim, agent);
      evidenceChains.push(evidence);
    }
    
    // Store evidence chains
    this.evidenceChains.set(claimId, evidenceChains);
    
    // Aggregate reasoning to reach consensus
    const consensus = await this._aggregateConsensus(claimId, claim, evidenceChains);
    
    // Store result
    this.consensusResults.set(claimId, consensus);
    
    await this._persist();
    
    console.log(`[AgentConsensus] Consensus reached: ${consensus.verdict} (${(consensus.confidence * 100).toFixed(1)}%)`);
    
    return consensus;
  }
  
  /**
   * Single agent reasoning process
   */
  async _agentReason(claimId, claim, agentProfile) {
    // Construct reasoning prompt for this agent
    const prompt = this._buildReasoningPrompt(claim, agentProfile);
    
    // Get AI reasoning
    const response = await this.aiInterface.generate({
      model: agentProfile.model || 'default',
      prompt,
      parameters: {
        temperature: agentProfile.temperature || 0.7,
        max_tokens: 500
      }
    });
    
    // Parse reasoning response
    const reasoning = this._parseReasoning(response.text);
    
    // Create evidence chain
    const evidence = new EvidenceChain({
      id: `evidence_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      claim_id: claimId,
      agent_did: agentProfile.did,
      position: reasoning.position,
      confidence: reasoning.confidence,
      reasoning: reasoning.text,
      evidence_cids: reasoning.evidence_cids || [],
      signature: 'placeholder_signature'
    });
    
    return evidence;
  }
  
  /**
   * Build reasoning prompt for an agent
   */
  _buildReasoningPrompt(claim, agentProfile) {
    return `You are an agent with the following perspective: ${agentProfile.perspective}

Evaluate this claim:
Subject: ${claim.subject}
Predicate: ${claim.predicate}

Consider:
1. What evidence supports or refutes this claim?
2. What assumptions are being made?
3. What are the potential counterarguments?
4. How confident can we be in this claim?

Provide your reasoning in the following format:
POSITION: [support/refute/neutral]
CONFIDENCE: [0.0-1.0]
REASONING: [Your detailed reasoning]
EVIDENCE: [Any CIDs or references that support your position]`;
  }
  
  /**
   * Parse AI reasoning response
   */
  _parseReasoning(text) {
    const lines = text.split('\n');
    const reasoning = {
      position: 'neutral',
      confidence: 0.5,
      text: '',
      evidence_cids: []
    };
    
    for (const line of lines) {
      if (line.startsWith('POSITION:')) {
        const pos = line.substring(9).trim().toLowerCase();
        if (['support', 'refute', 'neutral'].includes(pos)) {
          reasoning.position = pos;
        }
      } else if (line.startsWith('CONFIDENCE:')) {
        const conf = parseFloat(line.substring(11).trim());
        if (!isNaN(conf) && conf >= 0 && conf <= 1) {
          reasoning.confidence = conf;
        }
      } else if (line.startsWith('REASONING:')) {
        reasoning.text = line.substring(10).trim();
      } else if (line.startsWith('EVIDENCE:')) {
        // Parse CID references
        const evidenceStr = line.substring(9).trim();
        const cids = evidenceStr.match(/Qm[a-zA-Z0-9]{44}/g);
        if (cids) {
          reasoning.evidence_cids = cids;
        }
      } else if (reasoning.text && !line.startsWith('POSITION') && !line.startsWith('CONFIDENCE')) {
        reasoning.text += ' ' + line;
      }
    }
    
    return reasoning;
  }
  
  /**
   * Aggregate evidence chains into consensus
   */
  async _aggregateConsensus(claimId, claim, evidenceChains) {
    const supportChains = evidenceChains.filter(e => e.position === 'support');
    const refuteChains = evidenceChains.filter(e => e.position === 'refute');
    const neutralChains = evidenceChains.filter(e => e.position === 'neutral');
    
    // Weighted voting based on confidence
    const supportScore = supportChains.reduce((sum, e) => sum + e.confidence, 0);
    const refuteScore = refuteChains.reduce((sum, e) => sum + e.confidence, 0);
    const totalScore = supportScore + refuteScore;
    
    // Determine verdict
    let verdict = 'uncertain';
    let confidence = 0.5;
    
    if (totalScore > 0) {
      const supportRatio = supportScore / totalScore;
      
      if (supportRatio >= 0.7) {
        verdict = 'accept';
        confidence = supportRatio;
      } else if (supportRatio <= 0.3) {
        verdict = 'reject';
        confidence = 1.0 - supportRatio;
      } else {
        verdict = 'uncertain';
        confidence = 0.5;
      }
      
      // Unanimity bonus
      if (evidenceChains.every(e => e.position === evidenceChains[0].position)) {
        confidence = Math.min(1.0, confidence + this.unanimityBonus);
      }
    }
    
    // Generate reasoning summary
    const reasoningSummary = this._generateSummary(evidenceChains, verdict);
    
    return new ConsensusResult({
      claim_id: claimId,
      verdict,
      confidence,
      support_count: supportChains.length,
      refute_count: refuteChains.length,
      neutral_count: neutralChains.length,
      evidence_chains: evidenceChains.map(e => e.id),
      reasoning_summary: reasoningSummary,
      finalized: confidence >= this.confidenceThreshold
    });
  }
  
  /**
   * Generate summary of reasoning
   */
  _generateSummary(evidenceChains, verdict) {
    const reasons = evidenceChains.map(e => e.reasoning).filter(Boolean);
    
    return {
      verdict,
      agent_count: evidenceChains.length,
      key_arguments: reasons.slice(0, 3),
      consensus_strength: evidenceChains.every(e => e.position === evidenceChains[0].position) ? 'unanimous' : 'mixed'
    };
  }
  
  /**
   * Generate agent perspectives for reasoning
   */
  async _generateAgentPerspectives(count) {
    const perspectives = [
      { perspective: 'skeptical', temperature: 0.3, did: 'agent:skeptic' },
      { perspective: 'optimistic', temperature: 0.7, did: 'agent:optimist' },
      { perspective: 'pragmatic', temperature: 0.5, did: 'agent:pragmatist' },
      { perspective: 'analytical', temperature: 0.2, did: 'agent:analyst' },
      { perspective: 'creative', temperature: 0.9, did: 'agent:creative' }
    ];
    
    return perspectives.slice(0, count);
  }
  
  /**
   * Get or create claim ID
   */
  async _getOrCreateClaim(claim) {
    // Generate deterministic ID from claim content
    const claimStr = JSON.stringify({
      subject: claim.subject,
      predicate: claim.predicate
    });
    
    return await generateCID(claimStr);
  }
  
  /**
   * Get consensus result for a claim
   */
  getConsensus(claimId) {
    return this.consensusResults.get(claimId);
  }
  
  /**
   * Get evidence chains for a claim
   */
  getEvidence(claimId) {
    return this.evidenceChains.get(claimId) || [];
  }
  
  /**
   * Get consensus statistics
   */
  getStats() {
    const results = Array.from(this.consensusResults.values());
    
    return {
      total_claims: results.length,
      accepted: results.filter(r => r.verdict === 'accept').length,
      rejected: results.filter(r => r.verdict === 'reject').length,
      uncertain: results.filter(r => r.verdict === 'uncertain').length,
      average_confidence: results.length > 0 
        ? (results.reduce((sum, r) => sum + r.confidence, 0) / results.length).toFixed(3)
        : 0,
      finalized: results.filter(r => r.finalized).length
    };
  }
  
  /**
   * Persist consensus data
   */
  async _persist() {
    try {
      const data = {
        evidenceChains: Object.fromEntries(
          Array.from(this.evidenceChains.entries()).map(([k, v]) => [k, v.map(e => e)])
        ),
        consensusResults: Object.fromEntries(this.consensusResults),
        version: '1.0.0'
      };
      
      await this.store.set('agent_consensus', JSON.stringify(data));
    } catch (error) {
      console.error('[AgentConsensus] Failed to persist:', error);
    }
  }
  
  /**
   * Export consensus data
   */
  async exportConsensus() {
    await this.initialize();
    
    return {
      version: '1.0.0',
      timestamp: Date.now(),
      consensusResults: Array.from(this.consensusResults.values()),
      stats: this.getStats()
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AgentConsensus, EvidenceChain, ConsensusResult };
}
