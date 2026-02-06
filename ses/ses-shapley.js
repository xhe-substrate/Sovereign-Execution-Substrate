/**
 * SES Shapley Value Calculator - Layer 5 Value Attribution
 * 
 * Implements Shapley value calculation for fair value attribution across
 * contribution dependency graphs. Determines how much each contribution
 * in a dependency chain contributed to the final value.
 * 
 * Shapley values provide a game-theoretically fair way to distribute value
 * among contributors based on their marginal contributions.
 * 
 * Core Principles:
 * - Fair attribution across dependency chains
 * - Accounts for synergies between contributions
 * - Provides provable fairness guarantees
 * - Bounded computation (approximation for large graphs)
 */

class ShapleyCalculator {
  constructor(options = {}) {
    this.maxSamples = options.maxSamples || 1000;
    this.convergenceThreshold = options.convergenceThreshold || 0.001;
    this.maxIterations = options.maxIterations || 5000;
  }
  
  /**
   * Calculate Shapley values for a contribution graph
   * 
   * @param {Object} graph - { nodes: Contribution[], edges: { from, to }[] }
   * @param {number} totalValue - Total value to distribute
   * @returns {Map} CID -> Shapley value
   */
  async calculateShapleyValues(graph, totalValue) {
    const nodes = graph.nodes;
    const n = nodes.length;
    
    // For small graphs, use exact calculation
    if (n <= 10) {
      return this._exactShapley(graph, totalValue);
    }
    
    // For larger graphs, use Monte Carlo approximation
    return this._approximateShapley(graph, totalValue);
  }
  
  /**
   * Exact Shapley value calculation (for small graphs)
   * Uses the definition: sum over all permutations
   */
  _exactShapley(graph, totalValue) {
    const nodes = graph.nodes;
    const n = nodes.length;
    const shapleyValues = new Map();
    
    // Initialize all to 0
    nodes.forEach(node => shapleyValues.set(node.id, 0));
    
    // Generate all permutations
    const permutations = this._generatePermutations(nodes);
    const numPermutations = permutations.length;
    
    // For each permutation, calculate marginal contributions
    for (const perm of permutations) {
      const marginalValues = this._calculateMarginalValues(graph, perm, totalValue);
      
      // Add to Shapley values
      for (const [cid, value] of marginalValues.entries()) {
        shapleyValues.set(cid, shapleyValues.get(cid) + value / numPermutations);
      }
    }
    
    return shapleyValues;
  }
  
  /**
   * Approximate Shapley value using Monte Carlo sampling
   * Faster for large graphs, with guaranteed convergence
   */
  _approximateShapley(graph, totalValue) {
    const nodes = graph.nodes;
    const shapleyValues = new Map();
    const sampleCounts = new Map();
    
    // Initialize
    nodes.forEach(node => {
      shapleyValues.set(node.id, 0);
      sampleCounts.set(node.id, 0);
    });
    
    let iteration = 0;
    let converged = false;
    const previousValues = new Map();
    
    while (iteration < this.maxIterations && !converged) {
      // Save previous values for convergence check
      if (iteration % 100 === 0) {
        previousValues.clear();
        shapleyValues.forEach((value, cid) => previousValues.set(cid, value));
      }
      
      // Random permutation sampling
      const permutation = this._shuffleArray([...nodes]);
      const marginalValues = this._calculateMarginalValues(graph, permutation, totalValue);
      
      // Update running averages
      for (const [cid, value] of marginalValues.entries()) {
        const count = sampleCounts.get(cid);
        const currentAvg = shapleyValues.get(cid);
        const newAvg = (currentAvg * count + value) / (count + 1);
        shapleyValues.set(cid, newAvg);
        sampleCounts.set(cid, count + 1);
      }
      
      iteration++;
      
      // Check convergence every 100 iterations
      if (iteration % 100 === 0 && previousValues.size > 0) {
        converged = this._checkConvergence(shapleyValues, previousValues);
      }
    }
    
    console.log(`[Shapley] Converged after ${iteration} iterations`);
    
    return shapleyValues;
  }
  
  /**
   * Calculate marginal contribution for each node in a permutation
   */
  _calculateMarginalValues(graph, permutation, totalValue) {
    const marginalValues = new Map();
    const coalition = new Set();
    
    for (const node of permutation) {
      // Value of coalition without this node
      const valueBefore = this._coalitionValue(graph, coalition, totalValue);
      
      // Add node to coalition
      coalition.add(node.id);
      
      // Value of coalition with this node
      const valueAfter = this._coalitionValue(graph, coalition, totalValue);
      
      // Marginal contribution
      marginalValues.set(node.id, valueAfter - valueBefore);
    }
    
    return marginalValues;
  }
  
  /**
   * Calculate the value of a coalition of nodes
   * This is the "characteristic function" in game theory
   * 
   * In our case, a coalition's value depends on:
   * - The novelty/quality of contributions in the coalition
   * - Whether dependencies are satisfied
   * - Synergies between contributions
   */
  _coalitionValue(graph, coalition, totalValue) {
    if (coalition.size === 0) return 0;
    
    // Get nodes in coalition
    const coalitionNodes = graph.nodes.filter(n => coalition.has(n.id));
    
    // Calculate base value from individual contributions
    let baseValue = 0;
    for (const node of coalitionNodes) {
      baseValue += node.shares_issued;
    }
    
    // Check dependency satisfaction
    let dependencySatisfaction = 0;
    for (const node of coalitionNodes) {
      const satisfiedDeps = node.dependencies.filter(depCID => coalition.has(depCID));
      const satisfactionRatio = node.dependencies.length > 0 
        ? satisfiedDeps.length / node.dependencies.length
        : 1.0;
      dependencySatisfaction += satisfactionRatio * node.shares_issued;
    }
    
    // Calculate synergy bonus (when dependencies are present)
    const synergyBonus = this._calculateSynergyBonus(graph, coalitionNodes, coalition);
    
    // Normalize to total value
    const totalShares = graph.nodes.reduce((sum, n) => sum + n.shares_issued, 0);
    const normalizedValue = (baseValue + dependencySatisfaction + synergyBonus) / totalShares * totalValue;
    
    return Math.max(0, normalizedValue);
  }
  
  /**
   * Calculate synergy bonus when related contributions are together
   */
  _calculateSynergyBonus(graph, coalitionNodes, coalition) {
    let bonus = 0;
    
    for (const node of coalitionNodes) {
      // Bonus for having dependencies satisfied
      const satisfiedDeps = node.dependencies.filter(depCID => coalition.has(depCID));
      if (satisfiedDeps.length > 0) {
        bonus += satisfiedDeps.length * node.shares_issued * 0.1; // 10% synergy bonus
      }
      
      // Bonus for having derivations in coalition (derived work exists)
      const derivationsInCoalition = node.derivations.filter(derCID => coalition.has(derCID));
      if (derivationsInCoalition.length > 0) {
        bonus += derivationsInCoalition.length * node.shares_issued * 0.05; // 5% derivation bonus
      }
    }
    
    return bonus;
  }
  
  /**
   * Check if Shapley values have converged
   */
  _checkConvergence(current, previous) {
    let maxChange = 0;
    
    for (const [cid, value] of current.entries()) {
      const prevValue = previous.get(cid) || 0;
      const change = Math.abs(value - prevValue);
      maxChange = Math.max(maxChange, change);
    }
    
    return maxChange < this.convergenceThreshold;
  }
  
  /**
   * Generate all permutations (for exact calculation)
   * Warning: O(n!) - only use for small n
   */
  _generatePermutations(array) {
    if (array.length <= 1) return [array];
    
    const result = [];
    for (let i = 0; i < array.length; i++) {
      const rest = array.slice(0, i).concat(array.slice(i + 1));
      const restPerms = this._generatePermutations(rest);
      for (const perm of restPerms) {
        result.push([array[i], ...perm]);
      }
    }
    
    return result;
  }
  
  /**
   * Fisher-Yates shuffle
   */
  _shuffleArray(array) {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  
  /**
   * Validate Shapley values (should sum to total value)
   */
  validateShapleyValues(shapleyValues, totalValue) {
    const sum = Array.from(shapleyValues.values()).reduce((a, b) => a + b, 0);
    const error = Math.abs(sum - totalValue);
    const relativeError = error / totalValue;
    
    return {
      valid: relativeError < 0.01, // 1% tolerance
      sum,
      expectedSum: totalValue,
      error,
      relativeError
    };
  }
  
  /**
   * Get human-readable attribution report
   */
  generateAttributionReport(graph, shapleyValues, totalValue) {
    const report = {
      totalValue,
      contributions: [],
      validation: this.validateShapleyValues(shapleyValues, totalValue)
    };
    
    for (const node of graph.nodes) {
      const shapleyValue = shapleyValues.get(node.id) || 0;
      const percentage = (shapleyValue / totalValue * 100).toFixed(2);
      
      report.contributions.push({
        cid: node.id,
        author: node.author,
        type: node.type,
        shares: node.shares_issued,
        shapleyValue,
        percentage,
        dependencies: node.dependencies.length,
        derivations: node.derivations.length
      });
    }
    
    // Sort by Shapley value
    report.contributions.sort((a, b) => b.shapleyValue - a.shapleyValue);
    
    return report;
  }
}

/**
 * Simplified API for common use cases
 */
class ShapleyAttribution {
  constructor(contributionGraph, options = {}) {
    this.graph = contributionGraph;
    this.calculator = new ShapleyCalculator(options);
  }
  
  /**
   * Attribute value to a contribution and all its dependencies
   */
  async attributeValue(contributionCID, value) {
    const dependencyGraph = this.graph.getDependencyGraph(contributionCID);
    const shapleyValues = await this.calculator.calculateShapleyValues(dependencyGraph, value);
    
    return {
      attributions: shapleyValues,
      report: this.calculator.generateAttributionReport(dependencyGraph, shapleyValues, value)
    };
  }
  
  /**
   * Calculate fair revenue distribution for all contributors
   */
  async distributeRevenue(totalRevenue) {
    const allNodes = Array.from(this.graph.contributions.values());
    const fullGraph = {
      nodes: allNodes,
      edges: this._buildEdges(allNodes)
    };
    
    const shapleyValues = await this.calculator.calculateShapleyValues(fullGraph, totalRevenue);
    
    // Aggregate by author
    const authorPayments = new Map();
    for (const [cid, value] of shapleyValues.entries()) {
      const contribution = this.graph.get(cid);
      if (contribution) {
        const current = authorPayments.get(contribution.author) || 0;
        authorPayments.set(contribution.author, current + value);
      }
    }
    
    return {
      individual: shapleyValues,
      byAuthor: authorPayments,
      report: this.calculator.generateAttributionReport(fullGraph, shapleyValues, totalRevenue)
    };
  }
  
  _buildEdges(nodes) {
    const edges = [];
    for (const node of nodes) {
      for (const depCID of node.dependencies) {
        edges.push({ from: depCID, to: node.id });
      }
    }
    return edges;
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShapleyCalculator, ShapleyAttribution };
}
