/**
 * SES-CONTEXT.JS - Minimal Context Layer
 * 
 * Stores everything as content-addressed objects.
 * Links contexts to Pulses for traceability.
 * 
 * Core Properties:
 * - Every context change is a CID-wrapped artifact
 * - Contexts are immutable snapshots
 * - Full history is preserved
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // CONTEXT NODE
  // A single node in the context graph
  // ============================================
  class ContextNode {
    constructor(options = {}) {
      this.id = null; // CID set after storage
      this.type = options.type || 'observation';
      this.content = options.content;
      this.timestamp = new Date().toISOString();
      this.parentId = options.parentId || null;
      this.pulseId = options.pulseId || null; // Link to originating pulse
      this.metadata = options.metadata || {};
    }

    toJSON() {
      return {
        id: this.id,
        type: this.type,
        content: this.content,
        timestamp: this.timestamp,
        parentId: this.parentId,
        pulseId: this.pulseId,
        metadata: this.metadata
      };
    }

    static fromJSON(json) {
      const node = new ContextNode(json);
      node.id = json.id;
      node.timestamp = json.timestamp;
      return node;
    }
  }

  // ============================================
  // CONTEXT TYPES
  // ============================================
  const CONTEXT_TYPES = {
    OBSERVATION: 'observation',
    HYPOTHESIS: 'hypothesis',
    TEST: 'test',
    CONCLUSION: 'conclusion',
    LEARNING: 'learning',
    DECISION: 'decision',
    INPUT: 'input',
    OUTPUT: 'output',
    ERROR: 'error'
  };

  // ============================================
  // CONTEXT STREAM
  // Manages the flow of context nodes
  // ============================================
  class ContextStream {
    constructor(store) {
      this.store = store;
      this.currentContextId = null;
      this.contextName = 'default';
      this.history = []; // Local cache of recent CIDs
      this.listeners = [];
    }

    // Event handling
    on(callback) {
      this.listeners.push(callback);
    }

    emit(event, data) {
      this.listeners.forEach(cb => cb(event, data));
    }

    // Push a new context node
    async push(options) {
      const node = new ContextNode({
        ...options,
        parentId: this.currentContextId
      });

      // Store the node content
      const nodeCid = await this.store.store(node.toJSON());
      node.id = nodeCid;

      // Update current context
      this.currentContextId = nodeCid;
      this.history.push(nodeCid);

      // Keep history bounded
      if (this.history.length > 1000) {
        this.history = this.history.slice(-500);
      }

      this.emit('push', { node: node.toJSON(), cid: nodeCid });
      return nodeCid;
    }

    // Create context from a Pulse result
    async fromPulse(pulse, output) {
      // Store input context
      if (pulse.inputCid) {
        await this.push({
          type: CONTEXT_TYPES.INPUT,
          content: { cid: pulse.inputCid },
          pulseId: pulse.pulseId,
          metadata: { bounds: pulse.bounds }
        });
      }

      // Store output context
      if (pulse.outputCid) {
        await this.push({
          type: CONTEXT_TYPES.OUTPUT,
          content: output,
          pulseId: pulse.pulseId,
          metadata: {
            status: pulse.status,
            traceCid: pulse.traceCid
          }
        });
      }

      // Store error context if failed
      if (pulse.error) {
        await this.push({
          type: CONTEXT_TYPES.ERROR,
          content: pulse.error,
          pulseId: pulse.pulseId
        });
      }

      return this.currentContextId;
    }

    // Get context node by CID
    async get(cid) {
      const data = await this.store.fetch(cid);
      if (!data) return null;
      return ContextNode.fromJSON(data);
    }

    // Get recent context history
    async getRecent(limit = 10) {
      const recentCids = this.history.slice(-limit);
      const nodes = [];
      
      for (const cid of recentCids) {
        const node = await this.get(cid);
        if (node) nodes.push(node);
      }
      
      return nodes;
    }

    // Walk the context chain backwards
    async walkBack(startCid, limit = 100) {
      const chain = [];
      let currentCid = startCid || this.currentContextId;
      let count = 0;

      while (currentCid && count < limit) {
        const node = await this.get(currentCid);
        if (!node) break;
        
        chain.push(node);
        currentCid = node.parentId;
        count++;
      }

      return chain;
    }

    // Save context state (for switching)
    async saveState() {
      const state = {
        name: this.contextName,
        currentContextId: this.currentContextId,
        history: this.history.slice(-100), // Save recent history
        savedAt: new Date().toISOString()
      };
      
      return await this.store.store(state);
    }

    // Load context state
    async loadState(stateCid) {
      const state = await this.store.fetch(stateCid);
      if (!state) return false;

      this.contextName = state.name;
      this.currentContextId = state.currentContextId;
      this.history = state.history || [];
      
      this.emit('load', { state });
      return true;
    }

    // Switch to a named context
    async switch(name) {
      // Save current state
      const currentStateCid = await this.saveState();
      
      // Create new context
      this.contextName = name;
      this.currentContextId = null;
      this.history = [];
      
      this.emit('switch', { name, previousStateCid: currentStateCid });
      return currentStateCid;
    }

    // Get context summary (for display)
    async getSummary() {
      const recent = await this.getRecent(5);
      return {
        name: this.contextName,
        currentId: this.currentContextId,
        historyLength: this.history.length,
        recentNodes: recent.map(n => ({
          id: n.id,
          type: n.type,
          timestamp: n.timestamp
        }))
      };
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESContext = {
    ContextNode,
    ContextStream,
    CONTEXT_TYPES
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESContext;
  } else {
    global.SESContext = SESContext;
  }

})(typeof window !== 'undefined' ? window : global);
