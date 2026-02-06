/**
 * SES Production Commons Platform
 * 
 * Complete frontend for the contribution economy:
 * - Contribution Browser - Search/discover contributions
 * - Project Spaces - Organize contributions into projects
 * - Revenue Dashboard - Real-time Shapley attribution
 * - Dependency Graph Viewer - Contribution relationships
 * - Share Marketplace - Trade contribution shares
 * 
 * Makes the contribution economy actually usable.
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // Contribution Browser
  // ============================================
  class ContributionBrowser {
    constructor(store, contributionGraph) {
      this.store = store;
      this.graph = contributionGraph;
      this.filters = {
        type: null,
        author: null,
        dateRange: null,
        tags: [],
        minValue: null
      };
    }

    /**
     * Search contributions with filters
     */
    async search(query = '', filters = {}) {
      const allContributions = await this.graph.getAllContributions();
      
      let results = allContributions;

      // Text search
      if (query) {
        const queryLower = query.toLowerCase();
        results = results.filter(c => 
          c.name.toLowerCase().includes(queryLower) ||
          c.description?.toLowerCase().includes(queryLower) ||
          c.tags?.some(t => t.toLowerCase().includes(queryLower))
        );
      }

      // Apply filters
      if (filters.type) {
        results = results.filter(c => c.type === filters.type);
      }

      if (filters.author) {
        results = results.filter(c => c.author === filters.author);
      }

      if (filters.tags && filters.tags.length > 0) {
        results = results.filter(c => 
          filters.tags.some(tag => c.tags?.includes(tag))
        );
      }

      if (filters.minValue) {
        results = results.filter(c => 
          (c.shapleyValue || 0) >= filters.minValue
        );
      }

      if (filters.dateRange) {
        const { start, end } = filters.dateRange;
        results = results.filter(c => 
          c.timestamp >= start && c.timestamp <= end
        );
      }

      // Sort by relevance/value
      results.sort((a, b) => {
        if (query) {
          // If searching, prioritize exact matches
          const aMatch = a.name.toLowerCase() === query.toLowerCase();
          const bMatch = b.name.toLowerCase() === query.toLowerCase();
          if (aMatch && !bMatch) return -1;
          if (!aMatch && bMatch) return 1;
        }
        // Otherwise sort by Shapley value
        return (b.shapleyValue || 0) - (a.shapleyValue || 0);
      });

      return {
        query,
        filters,
        results,
        count: results.length,
        totalValue: results.reduce((sum, c) => sum + (c.shapleyValue || 0), 0)
      };
    }

    /**
     * Get trending contributions
     */
    async getTrending(period = '7d') {
      const periodMs = this._parsePeriod(period);
      const cutoff = Date.now() - periodMs;

      const allContributions = await this.graph.getAllContributions();
      
      const recent = allContributions.filter(c => c.timestamp >= cutoff);
      
      // Sort by usage/dependencies
      recent.sort((a, b) => {
        const aScore = (a.dependencies?.length || 0) + (a.shapleyValue || 0);
        const bScore = (b.dependencies?.length || 0) + (b.shapleyValue || 0);
        return bScore - aScore;
      });

      return recent.slice(0, 20);
    }

    /**
     * Get contribution details with full context
     */
    async getContributionDetails(cid) {
      const contribution = await this.graph.getContribution(cid);
      if (!contribution) return null;

      // Get dependencies
      const dependencies = await Promise.all(
        (contribution.dependencies || []).map(dep => 
          this.graph.getContribution(dep.cid)
        )
      );

      // Get dependents (who depends on this)
      const allContributions = await this.graph.getAllContributions();
      const dependents = allContributions.filter(c => 
        c.dependencies?.some(d => d.cid === cid)
      );

      // Get author's other contributions
      const authorContributions = allContributions.filter(c => 
        c.author === contribution.author && c.cid !== cid
      ).slice(0, 5);

      return {
        contribution,
        dependencies,
        dependents,
        authorContributions,
        stats: {
          directDependencies: dependencies.length,
          directDependents: dependents.length,
          totalValue: contribution.shapleyValue || 0,
          created: contribution.timestamp
        }
      };
    }

    _parsePeriod(period) {
      const match = period.match(/^(\d+)([dhwm])$/);
      if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7 days

      const [, num, unit] = match;
      const value = parseInt(num);

      switch (unit) {
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        case 'm': return value * 30 * 24 * 60 * 60 * 1000;
        default: return 7 * 24 * 60 * 60 * 1000;
      }
    }
  }

  // ============================================
  // Project Spaces
  // ============================================
  class ProjectSpace {
    constructor(data) {
      this.id = data.id;
      this.name = data.name;
      this.description = data.description || '';
      this.owner = data.owner;
      this.members = data.members || [];
      this.contributions = data.contributions || [];
      this.tags = data.tags || [];
      this.created = data.created || Date.now();
      this.updated = data.updated || Date.now();
      this.settings = data.settings || {
        visibility: 'public',
        allowContributions: true,
        revenueSharing: 'shapley'
      };
    }

    addContribution(cid) {
      if (!this.contributions.includes(cid)) {
        this.contributions.push(cid);
        this.updated = Date.now();
      }
    }

    removeContribution(cid) {
      const index = this.contributions.indexOf(cid);
      if (index > -1) {
        this.contributions.splice(index, 1);
        this.updated = Date.now();
      }
    }

    addMember(did) {
      if (!this.members.includes(did)) {
        this.members.push(did);
        this.updated = Date.now();
      }
    }

    toJSON() {
      return {
        id: this.id,
        name: this.name,
        description: this.description,
        owner: this.owner,
        members: this.members,
        contributions: this.contributions,
        tags: this.tags,
        created: this.created,
        updated: this.updated,
        settings: this.settings
      };
    }
  }

  class ProjectSpaceManager {
    constructor(store, contributionGraph) {
      this.store = store;
      this.graph = contributionGraph;
      this.spaces = new Map();
    }

    async initialize(userDID) {
      this.userDID = userDID;
      
      // Load saved spaces
      const saved = await this.store.get(`project_spaces_${userDID}`);
      if (saved) {
        const data = JSON.parse(saved);
        data.forEach(s => {
          const space = new ProjectSpace(s);
          this.spaces.set(space.id, space);
        });
      }
    }

    async createSpace(name, description, settings = {}) {
      const space = new ProjectSpace({
        id: `space-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name,
        description,
        owner: this.userDID,
        members: [this.userDID],
        settings
      });

      this.spaces.set(space.id, space);
      await this._save();

      return space;
    }

    async getSpace(spaceId) {
      return this.spaces.get(spaceId);
    }

    async listSpaces() {
      return Array.from(this.spaces.values());
    }

    async addContributionToSpace(spaceId, contributionCid) {
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error('Space not found');

      space.addContribution(contributionCid);
      await this._save();

      return space;
    }

    async getSpaceStats(spaceId) {
      const space = this.spaces.get(spaceId);
      if (!space) throw new Error('Space not found');

      const contributions = await Promise.all(
        space.contributions.map(cid => this.graph.getContribution(cid))
      );

      const totalValue = contributions.reduce((sum, c) => 
        sum + (c?.shapleyValue || 0), 0
      );

      const contributionsByAuthor = {};
      contributions.forEach(c => {
        if (c) {
          contributionsByAuthor[c.author] = 
            (contributionsByAuthor[c.author] || 0) + (c.shapleyValue || 0);
        }
      });

      return {
        space: space.toJSON(),
        totalContributions: contributions.length,
        totalValue,
        contributionsByAuthor,
        members: space.members.length,
        created: space.created,
        lastUpdated: space.updated
      };
    }

    async _save() {
      const data = Array.from(this.spaces.values()).map(s => s.toJSON());
      await this.store.set(`project_spaces_${this.userDID}`, JSON.stringify(data));
    }
  }

  // ============================================
  // Revenue Dashboard
  // ============================================
  class RevenueDashboard {
    constructor(store, shapley, contributionGraph) {
      this.store = store;
      this.shapley = shapley;
      this.graph = contributionGraph;
      this.revenueEvents = [];
    }

    async initialize(userDID) {
      this.userDID = userDID;
      
      // Load revenue history
      const saved = await this.store.get(`revenue_history_${userDID}`);
      if (saved) {
        this.revenueEvents = JSON.parse(saved);
      }
    }

    /**
     * Record revenue event
     */
    async recordRevenue(contributionCid, amount, source) {
      const event = {
        id: `rev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        contributionCid,
        amount,
        source,
        timestamp: Date.now(),
        attributed: false
      };

      this.revenueEvents.push(event);
      await this._save();

      // Trigger Shapley attribution
      await this._attributeRevenue(event);

      return event;
    }

    /**
     * Attribute revenue using Shapley values
     */
    async _attributeRevenue(event) {
      const contribution = await this.graph.getContribution(event.contributionCid);
      if (!contribution) return;

      // Calculate Shapley attribution
      const attribution = await this.shapley.calculateShapleyValue(
        event.contributionCid,
        this.graph
      );

      event.attribution = attribution;
      event.attributed = true;

      await this._save();

      // Emit event for UI updates
      this._emitRevenueEvent('revenue_attributed', event);
    }

    /**
     * Get user's total revenue
     */
    async getUserRevenue(userDID = this.userDID) {
      let total = 0;
      
      for (const event of this.revenueEvents) {
        if (event.attribution) {
          const userShare = event.attribution.contributors?.[userDID];
          if (userShare) {
            total += event.amount * userShare;
          }
        }
      }

      return total;
    }

    /**
     * Get revenue breakdown by contribution
     */
    async getRevenueByContribution() {
      const breakdown = {};

      for (const event of this.revenueEvents) {
        if (!breakdown[event.contributionCid]) {
          breakdown[event.contributionCid] = {
            total: 0,
            events: 0,
            attribution: null
          };
        }

        breakdown[event.contributionCid].total += event.amount;
        breakdown[event.contributionCid].events += 1;
        
        if (event.attribution) {
          breakdown[event.contributionCid].attribution = event.attribution;
        }
      }

      return breakdown;
    }

    /**
     * Get revenue timeline
     */
    async getRevenueTimeline(period = '30d') {
      const periodMs = this._parsePeriod(period);
      const cutoff = Date.now() - periodMs;

      const recentEvents = this.revenueEvents.filter(e => 
        e.timestamp >= cutoff
      );

      // Group by day
      const timeline = {};
      for (const event of recentEvents) {
        const day = new Date(event.timestamp).toISOString().split('T')[0];
        
        if (!timeline[day]) {
          timeline[day] = { total: 0, events: 0 };
        }

        timeline[day].total += event.amount;
        timeline[day].events += 1;
      }

      return Object.entries(timeline).map(([date, data]) => ({
        date,
        ...data
      })).sort((a, b) => a.date.localeCompare(b.date));
    }

    /**
     * Get top earning contributions
     */
    async getTopEarners(limit = 10) {
      const breakdown = await this.getRevenueByContribution();
      
      const sorted = Object.entries(breakdown)
        .map(([cid, data]) => ({ cid, ...data }))
        .sort((a, b) => b.total - a.total)
        .slice(0, limit);

      // Enrich with contribution details
      const enriched = await Promise.all(
        sorted.map(async item => ({
          ...item,
          contribution: await this.graph.getContribution(item.cid)
        }))
      );

      return enriched;
    }

    _parsePeriod(period) {
      const match = period.match(/^(\d+)([dhwm])$/);
      if (!match) return 30 * 24 * 60 * 60 * 1000;

      const [, num, unit] = match;
      const value = parseInt(num);

      switch (unit) {
        case 'd': return value * 24 * 60 * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'w': return value * 7 * 24 * 60 * 60 * 1000;
        case 'm': return value * 30 * 24 * 60 * 60 * 1000;
        default: return 30 * 24 * 60 * 60 * 1000;
      }
    }

    async _save() {
      await this.store.set(
        `revenue_history_${this.userDID}`, 
        JSON.stringify(this.revenueEvents)
      );
    }

    _emitRevenueEvent(type, data) {
      const event = new CustomEvent(`ses:${type}`, { detail: data });
      if (typeof window !== 'undefined') {
        window.dispatchEvent(event);
      }
    }
  }

  // ============================================
  // Dependency Graph Viewer
  // ============================================
  class DependencyGraphViewer {
    constructor(contributionGraph) {
      this.graph = contributionGraph;
    }

    /**
     * Generate graph data for visualization
     */
    async generateGraphData(rootCid, depth = 3) {
      const nodes = new Map();
      const edges = [];
      const visited = new Set();

      await this._traverseGraph(rootCid, depth, nodes, edges, visited);

      return {
        nodes: Array.from(nodes.values()),
        edges,
        stats: {
          totalNodes: nodes.size,
          totalEdges: edges.length,
          depth
        }
      };
    }

    async _traverseGraph(cid, depth, nodes, edges, visited, currentDepth = 0) {
      if (currentDepth > depth || visited.has(cid)) return;

      visited.add(cid);

      const contribution = await this.graph.getContribution(cid);
      if (!contribution) return;

      // Add node
      nodes.set(cid, {
        id: cid,
        label: contribution.name,
        type: contribution.type,
        value: contribution.shapleyValue || 0,
        author: contribution.author,
        depth: currentDepth
      });

      // Add edges and recurse
      if (contribution.dependencies) {
        for (const dep of contribution.dependencies) {
          edges.push({
            source: cid,
            target: dep.cid,
            weight: dep.weight || 1
          });

          await this._traverseGraph(
            dep.cid,
            depth,
            nodes,
            edges,
            visited,
            currentDepth + 1
          );
        }
      }
    }

    /**
     * Get critical path (highest value chain)
     */
    async getCriticalPath(rootCid) {
      const graphData = await this.generateGraphData(rootCid, 10);
      
      // Simple greedy algorithm: follow highest value edges
      const path = [rootCid];
      let current = rootCid;

      while (true) {
        const outEdges = graphData.edges.filter(e => e.source === current);
        if (outEdges.length === 0) break;

        // Find highest value target
        let maxValue = -1;
        let next = null;

        for (const edge of outEdges) {
          const targetNode = graphData.nodes.find(n => n.id === edge.target);
          if (targetNode && targetNode.value > maxValue) {
            maxValue = targetNode.value;
            next = edge.target;
          }
        }

        if (!next) break;
        
        path.push(next);
        current = next;
      }

      return {
        path,
        totalValue: path.reduce((sum, cid) => {
          const node = graphData.nodes.find(n => n.id === cid);
          return sum + (node?.value || 0);
        }, 0)
      };
    }

    /**
     * Get graph statistics
     */
    async getGraphStats(rootCid) {
      const graphData = await this.generateGraphData(rootCid, 10);

      const depths = graphData.nodes.map(n => n.depth);
      const values = graphData.nodes.map(n => n.value);

      return {
        totalNodes: graphData.nodes.length,
        totalEdges: graphData.edges.length,
        maxDepth: Math.max(...depths),
        avgDepth: depths.reduce((a, b) => a + b, 0) / depths.length,
        totalValue: values.reduce((a, b) => a + b, 0),
        avgValue: values.reduce((a, b) => a + b, 0) / values.length,
        maxValue: Math.max(...values)
      };
    }
  }

  // ============================================
  // Share Marketplace
  // ============================================
  class ShareMarketplace {
    constructor(store, contributionGraph, cst) {
      this.store = store;
      this.graph = contributionGraph;
      this.cst = cst;
      this.listings = new Map();
      this.trades = [];
    }

    async initialize(userDID) {
      this.userDID = userDID;

      // Load marketplace state
      const saved = await this.store.get('marketplace_listings');
      if (saved) {
        const data = JSON.parse(saved);
        data.forEach(listing => {
          this.listings.set(listing.id, listing);
        });
      }

      const tradesData = await this.store.get('marketplace_trades');
      if (tradesData) {
        this.trades = JSON.parse(tradesData);
      }
    }

    /**
     * List contribution shares for sale
     */
    async createListing(contributionCid, shareAmount, pricePerShare) {
      // Verify ownership
      const balance = await this.cst.getBalance(this.userDID, contributionCid);
      if (balance < shareAmount) {
        throw new Error('Insufficient shares');
      }

      const listing = {
        id: `listing-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        seller: this.userDID,
        contributionCid,
        shareAmount,
        pricePerShare,
        totalPrice: shareAmount * pricePerShare,
        created: Date.now(),
        status: 'active'
      };

      this.listings.set(listing.id, listing);
      await this._saveListings();

      return listing;
    }

    /**
     * Buy shares from listing
     */
    async buyShares(listingId, amount) {
      const listing = this.listings.get(listingId);
      if (!listing) throw new Error('Listing not found');
      if (listing.status !== 'active') throw new Error('Listing not active');
      if (amount > listing.shareAmount) throw new Error('Insufficient shares available');

      const totalCost = amount * listing.pricePerShare;

      // Check buyer has sufficient CST
      const buyerBalance = await this.cst.getBalance(this.userDID);
      if (buyerBalance < totalCost) {
        throw new Error('Insufficient CST balance');
      }

      // Execute trade
      await this.cst.transfer(this.userDID, listing.seller, totalCost);
      await this.cst.transferShares(
        listing.seller,
        this.userDID,
        listing.contributionCid,
        amount
      );

      // Update listing
      listing.shareAmount -= amount;
      if (listing.shareAmount === 0) {
        listing.status = 'completed';
      }

      // Record trade
      const trade = {
        id: `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        listingId,
        buyer: this.userDID,
        seller: listing.seller,
        contributionCid: listing.contributionCid,
        amount,
        pricePerShare: listing.pricePerShare,
        totalPrice: totalCost,
        timestamp: Date.now()
      };

      this.trades.push(trade);

      await this._saveListings();
      await this._saveTrades();

      return trade;
    }

    /**
     * Get active listings
     */
    async getActiveListings() {
      const active = Array.from(this.listings.values())
        .filter(l => l.status === 'active');

      // Enrich with contribution details
      const enriched = await Promise.all(
        active.map(async listing => ({
          ...listing,
          contribution: await this.graph.getContribution(listing.contributionCid)
        }))
      );

      return enriched;
    }

    /**
     * Get marketplace stats
     */
    async getMarketplaceStats() {
      const activeListings = await this.getActiveListings();
      
      const totalVolume = this.trades.reduce((sum, t) => sum + t.totalPrice, 0);
      const recentTrades = this.trades.filter(t => 
        t.timestamp > Date.now() - 24 * 60 * 60 * 1000
      );

      return {
        activeListings: activeListings.length,
        totalTrades: this.trades.length,
        totalVolume,
        recentTrades: recentTrades.length,
        avgPricePerShare: this.trades.length > 0
          ? this.trades.reduce((sum, t) => sum + t.pricePerShare, 0) / this.trades.length
          : 0
      };
    }

    async _saveListings() {
      const data = Array.from(this.listings.values());
      await this.store.set('marketplace_listings', JSON.stringify(data));
    }

    async _saveTrades() {
      await this.store.set('marketplace_trades', JSON.stringify(this.trades));
    }
  }

  // ============================================
  // Main Commons Platform
  // ============================================
  class CommonsPlat form {
    constructor(config = {}) {
      this.store = config.store;
      this.contributionGraph = config.contributionGraph;
      this.shapley = config.shapley;
      this.cst = config.cst;

      this.browser = new ContributionBrowser(this.store, this.contributionGraph);
      this.projects = new ProjectSpaceManager(this.store, this.contributionGraph);
      this.revenue = new RevenueDashboard(this.store, this.shapley, this.contributionGraph);
      this.graphViewer = new DependencyGraphViewer(this.contributionGraph);
      this.marketplace = new ShareMarketplace(this.store, this.contributionGraph, this.cst);
    }

    async initialize(userDID) {
      this.userDID = userDID;

      await this.projects.initialize(userDID);
      await this.revenue.initialize(userDID);
      await this.marketplace.initialize(userDID);

      console.log('✅ Commons Platform initialized');

      return {
        user: userDID,
        components: {
          browser: true,
          projects: true,
          revenue: true,
          graphViewer: true,
          marketplace: true
        }
      };
    }
  }

  // Export to global scope
  global.CommonsPlat form = CommonsPlatform;
  global.ContributionBrowser = ContributionBrowser;
  global.ProjectSpaceManager = ProjectSpaceManager;
  global.RevenueDashboard = RevenueDashboard;
  global.DependencyGraphViewer = DependencyGraphViewer;
  global.ShareMarketplace = ShareMarketplace;

  console.log('✅ SES Commons Platform module loaded');

})(typeof window !== 'undefined' ? window : this);
