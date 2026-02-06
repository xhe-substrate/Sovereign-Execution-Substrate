/**
 * SES Contribution Graph - Layer 5 Contribution Economy
 * 
 * Implements the contribution graph and equity system where ideas become shares.
 * Every contribution is tracked, valued, and rewards are distributed based on
 * novelty, quality, impact, and dependency relationships.
 * 
 * Core Principles:
 * - Contributions are content-addressed (CIDs)
 * - Novelty and impact are AI-scored
 * - Value attribution uses Shapley values
 * - Shares compound like equity, not labor
 * - Dependency graphs track contribution ancestry
 */

class Contribution {
  constructor(data) {
    this.id = data.id; // CID
    this.author = data.author; // DID
    this.type = data.type; // "insight" | "solution" | "tool" | "research"
    this.content = data.content;
    this.timestamp = data.timestamp || Date.now();
    
    // Scoring
    this.novelty = data.novelty || 0.0; // 0.0-1.0 AI-scored
    this.quality = data.quality || 0.0; // 0.0-1.0 peer-reviewed
    this.impact = data.impact || 0.0; // 0.0-1.0 measured over time
    
    // Graph relationships
    this.dependencies = data.dependencies || []; // CIDs this builds on
    this.derivations = data.derivations || []; // CIDs that build on this
    
    // Economic
    this.shares_issued = data.shares_issued || 0;
    this.revenue_share = data.revenue_share || 0.0;
    this.value_generated = data.value_generated || 0.0;
    
    // Metadata
    this.tags = data.tags || [];
    this.domain = data.domain || "general";
    this.verified = data.verified || false;
  }
  
  toJSON() {
    return {
      id: this.id,
      author: this.author,
      type: this.type,
      content: this.content,
      timestamp: this.timestamp,
      novelty: this.novelty,
      quality: this.quality,
      impact: this.impact,
      dependencies: this.dependencies,
      derivations: this.derivations,
      shares_issued: this.shares_issued,
      revenue_share: this.revenue_share,
      value_generated: this.value_generated,
      tags: this.tags,
      domain: this.domain,
      verified: this.verified
    };
  }
}

class ContributionGraph {
  constructor(store) {
    this.store = store;
    this.contributions = new Map(); // CID -> Contribution
    this.authorIndex = new Map(); // DID -> CID[]
    this.typeIndex = new Map(); // type -> CID[]
    this.tagIndex = new Map(); // tag -> CID[]
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    // Load from store
    try {
      const stored = await this.store.get('contribution_graph');
      if (stored) {
        const data = JSON.parse(stored);
        data.contributions.forEach(c => {
          const contrib = new Contribution(c);
          this.contributions.set(contrib.id, contrib);
          this._indexContribution(contrib);
        });
      }
    } catch (error) {
      console.warn('[ContributionGraph] Failed to load from store:', error);
    }
    
    this.initialized = true;
    console.log(`[ContributionGraph] Initialized with ${this.contributions.size} contributions`);
  }
  
  /**
   * Add a new contribution to the graph
   */
  async addContribution(data) {
    await this.initialize();
    
    // Generate CID for the contribution
    const contentStr = JSON.stringify({
      author: data.author,
      type: data.type,
      content: data.content,
      timestamp: data.timestamp || Date.now(),
      dependencies: data.dependencies || []
    });
    
    const cid = await generateCID(contentStr);
    data.id = cid;
    
    const contribution = new Contribution(data);
    
    // Calculate initial shares
    contribution.shares_issued = this._calculateShares(contribution);
    
    // Store in graph
    this.contributions.set(cid, contribution);
    this._indexContribution(contribution);
    
    // Update dependency relationships
    for (const depCID of contribution.dependencies) {
      const dep = this.contributions.get(depCID);
      if (dep && !dep.derivations.includes(cid)) {
        dep.derivations.push(cid);
      }
    }
    
    // Persist
    await this._persist();
    
    console.log(`[ContributionGraph] Added contribution ${cid.slice(0, 12)}... (${contribution.shares_issued} shares)`);
    
    return contribution;
  }
  
  /**
   * Calculate shares for a contribution based on novelty, quality, and type
   */
  _calculateShares(contribution) {
    const baseShares = 
      contribution.novelty * 1000 +
      contribution.quality * 500 +
      contribution.impact * 2000;
    
    const typeMultipliers = {
      'insight': 1.0,
      'solution': 1.5,
      'tool': 2.0,
      'research': 1.2
    };
    
    const multiplier = typeMultipliers[contribution.type] || 1.0;
    return Math.floor(baseShares * multiplier);
  }
  
  /**
   * Update contribution metrics (novelty, impact, quality)
   */
  async updateMetrics(cid, metrics) {
    await this.initialize();
    
    const contribution = this.contributions.get(cid);
    if (!contribution) {
      throw new Error(`Contribution ${cid} not found`);
    }
    
    if (metrics.novelty !== undefined) contribution.novelty = metrics.novelty;
    if (metrics.quality !== undefined) contribution.quality = metrics.quality;
    if (metrics.impact !== undefined) contribution.impact = metrics.impact;
    
    // Recalculate shares
    const oldShares = contribution.shares_issued;
    contribution.shares_issued = this._calculateShares(contribution);
    
    await this._persist();
    
    console.log(`[ContributionGraph] Updated ${cid.slice(0, 12)}... shares: ${oldShares} -> ${contribution.shares_issued}`);
    
    return contribution;
  }
  
  /**
   * Get all contributions by an author
   */
  getByAuthor(did) {
    const cids = this.authorIndex.get(did) || [];
    return cids.map(cid => this.contributions.get(cid)).filter(Boolean);
  }
  
  /**
   * Get all contributions of a type
   */
  getByType(type) {
    const cids = this.typeIndex.get(type) || [];
    return cids.map(cid => this.contributions.get(cid)).filter(Boolean);
  }
  
  /**
   * Get all contributions with a tag
   */
  getByTag(tag) {
    const cids = this.tagIndex.get(tag) || [];
    return cids.map(cid => this.contributions.get(cid)).filter(Boolean);
  }
  
  /**
   * Get contribution by CID
   */
  get(cid) {
    return this.contributions.get(cid);
  }
  
  /**
   * Build dependency graph for Shapley value calculation
   */
  getDependencyGraph(cid) {
    const visited = new Set();
    const graph = { nodes: [], edges: [] };
    
    const traverse = (currentCID) => {
      if (visited.has(currentCID)) return;
      visited.add(currentCID);
      
      const contribution = this.contributions.get(currentCID);
      if (!contribution) return;
      
      graph.nodes.push(contribution);
      
      for (const depCID of contribution.dependencies) {
        graph.edges.push({ from: depCID, to: currentCID });
        traverse(depCID);
      }
    };
    
    traverse(cid);
    return graph;
  }
  
  /**
   * Calculate total shares for an author
   */
  getTotalShares(did) {
    const contributions = this.getByAuthor(did);
    return contributions.reduce((sum, c) => sum + c.shares_issued, 0);
  }
  
  /**
   * Get top contributors by shares
   */
  getTopContributors(limit = 10) {
    const authorShares = new Map();
    
    for (const contribution of this.contributions.values()) {
      const current = authorShares.get(contribution.author) || 0;
      authorShares.set(contribution.author, current + contribution.shares_issued);
    }
    
    return Array.from(authorShares.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([did, shares]) => ({ did, shares }));
  }
  
  /**
   * Calculate revenue distribution based on shares
   */
  calculateRevenueDistribution(totalRevenue) {
    const totalShares = Array.from(this.contributions.values())
      .reduce((sum, c) => sum + c.shares_issued, 0);
    
    const distribution = new Map();
    
    for (const contribution of this.contributions.values()) {
      const share = contribution.shares_issued / totalShares;
      const payment = totalRevenue * share;
      
      const current = distribution.get(contribution.author) || 0;
      distribution.set(contribution.author, current + payment);
    }
    
    return Array.from(distribution.entries())
      .map(([did, amount]) => ({ did, amount }))
      .sort((a, b) => b.amount - a.amount);
  }
  
  /**
   * Get recent contributions
   */
  getRecent(limit = 20) {
    return Array.from(this.contributions.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const contributions = Array.from(this.contributions.values());
    const authors = new Set(contributions.map(c => c.author));
    const totalShares = contributions.reduce((sum, c) => sum + c.shares_issued, 0);
    const avgNovelty = contributions.reduce((sum, c) => sum + c.novelty, 0) / contributions.length || 0;
    const avgQuality = contributions.reduce((sum, c) => sum + c.quality, 0) / contributions.length || 0;
    
    return {
      total_contributions: contributions.length,
      unique_authors: authors.size,
      total_shares: totalShares,
      average_novelty: avgNovelty.toFixed(3),
      average_quality: avgQuality.toFixed(3),
      types: this._getTypeBreakdown()
    };
  }
  
  _getTypeBreakdown() {
    const breakdown = {};
    for (const [type, cids] of this.typeIndex.entries()) {
      breakdown[type] = cids.length;
    }
    return breakdown;
  }
  
  /**
   * Index a contribution for fast lookups
   */
  _indexContribution(contribution) {
    // Author index
    const authorCIDs = this.authorIndex.get(contribution.author) || [];
    if (!authorCIDs.includes(contribution.id)) {
      authorCIDs.push(contribution.id);
      this.authorIndex.set(contribution.author, authorCIDs);
    }
    
    // Type index
    const typeCIDs = this.typeIndex.get(contribution.type) || [];
    if (!typeCIDs.includes(contribution.id)) {
      typeCIDs.push(contribution.id);
      this.typeIndex.set(contribution.type, typeCIDs);
    }
    
    // Tag index
    for (const tag of contribution.tags) {
      const tagCIDs = this.tagIndex.get(tag) || [];
      if (!tagCIDs.includes(contribution.id)) {
        tagCIDs.push(contribution.id);
        this.tagIndex.set(tag, tagCIDs);
      }
    }
  }
  
  /**
   * Persist graph to store
   */
  async _persist() {
    try {
      const data = {
        contributions: Array.from(this.contributions.values()).map(c => c.toJSON()),
        version: '1.0.0'
      };
      await this.store.set('contribution_graph', JSON.stringify(data));
    } catch (error) {
      console.error('[ContributionGraph] Failed to persist:', error);
    }
  }
  
  /**
   * Export graph for network sharing
   */
  async exportGraph() {
    await this.initialize();
    
    return {
      version: '1.0.0',
      timestamp: Date.now(),
      contributions: Array.from(this.contributions.values()).map(c => c.toJSON()),
      stats: this.getStats()
    };
  }
  
  /**
   * Import graph from network
   */
  async importGraph(data) {
    await this.initialize();
    
    let imported = 0;
    
    for (const contribData of data.contributions) {
      if (!this.contributions.has(contribData.id)) {
        const contribution = new Contribution(contribData);
        this.contributions.set(contribution.id, contribution);
        this._indexContribution(contribution);
        imported++;
      }
    }
    
    if (imported > 0) {
      await this._persist();
      console.log(`[ContributionGraph] Imported ${imported} new contributions`);
    }
    
    return { imported, total: this.contributions.size };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ContributionGraph, Contribution };
}
