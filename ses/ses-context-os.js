/**
 * SES Context OS - Layer 7 Cognitive Operating System
 * 
 * External RAM for your brain. Automatically captures and organizes everything
 * you're working on so you can switch contexts with zero overhead.
 * 
 * Core Principles:
 * - Automatic capture of all cognitive context
 * - Zero-cost context switching
 * - Persistent working memory
 * - AI-powered context summarization
 * - Timeline-based context reconstruction
 * 
 * Eliminates context-switch penalty by externalizing your working memory.
 */

class ContextSnapshot {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.created_at = data.created_at || Date.now();
    this.last_active = data.last_active || Date.now();
    
    // Captured state
    this.working_files = data.working_files || [];
    this.browser_tabs = data.browser_tabs || [];
    this.editor_state = data.editor_state || {};
    this.terminal_history = data.terminal_history || [];
    this.notes = data.notes || '';
    
    // Cognitive state
    this.goals = data.goals || [];
    this.questions = data.questions || [];
    this.decisions = data.decisions || [];
    this.blockers = data.blockers || [];
    
    // Relationships
    this.related_contexts = data.related_contexts || [];
    this.parent_context = data.parent_context || null;
    this.tags = data.tags || [];
    
    // AI-generated
    this.summary = data.summary || '';
    this.key_insights = data.key_insights || [];
    this.next_steps = data.next_steps || [];
  }
  
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      created_at: this.created_at,
      last_active: this.last_active,
      working_files: this.working_files,
      browser_tabs: this.browser_tabs,
      editor_state: this.editor_state,
      terminal_history: this.terminal_history,
      notes: this.notes,
      goals: this.goals,
      questions: this.questions,
      decisions: this.decisions,
      blockers: this.blockers,
      related_contexts: this.related_contexts,
      parent_context: this.parent_context,
      tags: this.tags,
      summary: this.summary,
      key_insights: this.key_insights,
      next_steps: this.next_steps
    };
  }
}

class ContextOS {
  constructor(config = {}) {
    this.store = config.store;
    this.aiInterface = config.aiInterface;
    this.contextGraph = config.contextGraph; // From ses-context.js
    
    this.contexts = new Map(); // context_id -> ContextSnapshot
    this.activeContext = null;
    this.captureInterval = config.captureInterval || 60000; // 1 minute
    this.autoCapture = config.autoCapture !== false;
    
    this.captureTimer = null;
    this.initialized = false;
  }
  
  async initialize(userDID) {
    if (this.initialized) return;
    
    this.userDID = userDID;
    
    try {
      const stored = await this.store.get(`context_os_${userDID}`);
      if (stored) {
        const data = JSON.parse(stored);
        
        data.contexts.forEach(c => {
          const context = new ContextSnapshot(c);
          this.contexts.set(context.id, context);
        });
        
        if (data.activeContext) {
          this.activeContext = this.contexts.get(data.activeContext);
        }
      }
    } catch (error) {
      console.warn('[ContextOS] Failed to load from store:', error);
    }
    
    this.initialized = true;
    
    // Start auto-capture if enabled
    if (this.autoCapture) {
      this.startAutoCapture();
    }
    
    console.log(`[ContextOS] Initialized with ${this.contexts.size} contexts`);
  }
  
  /**
   * Create a new context
   */
  async createContext(name, initialData = {}) {
    const contextId = `ctx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const context = new ContextSnapshot({
      id: contextId,
      name,
      ...initialData
    });
    
    this.contexts.set(contextId, context);
    await this._persist();
    
    console.log(`[ContextOS] Created context: ${name}`);
    
    return context;
  }
  
  /**
   * Switch to a different context
   */
  async switchContext(contextId) {
    // Save current context
    if (this.activeContext) {
      await this.captureCurrentContext();
    }
    
    // Load new context
    const newContext = this.contexts.get(contextId);
    if (!newContext) {
      throw new Error(`Context ${contextId} not found`);
    }
    
    this.activeContext = newContext;
    newContext.last_active = Date.now();
    
    // Restore context state
    await this._restoreContext(newContext);
    
    await this._persist();
    
    console.log(`[ContextOS] Switched to context: ${newContext.name}`);
    
    return newContext;
  }
  
  /**
   * Capture current working state
   */
  async captureCurrentContext() {
    if (!this.activeContext) {
      // Create default context
      this.activeContext = await this.createContext('Default Context');
    }
    
    const context = this.activeContext;
    context.last_active = Date.now();
    
    // Capture browser state (simplified - would integrate with actual browser)
    context.browser_tabs = this._captureOpenTabs();
    
    // Capture editor state (simplified - would integrate with actual editor)
    context.working_files = this._captureOpenFiles();
    
    // Update with AI summary if enough time has passed
    const shouldSummarize = Date.now() - context.created_at > 300000; // 5 minutes
    if (shouldSummarize && this.aiInterface) {
      await this._generateContextSummary(context);
    }
    
    await this._persist();
    
    return context;
  }
  
  /**
   * Resume a previously saved context
   */
  async resumeContext(nameOrId) {
    let context;
    
    // Try to find by ID first
    context = this.contexts.get(nameOrId);
    
    // If not found, try by name
    if (!context) {
      context = Array.from(this.contexts.values()).find(c => c.name === nameOrId);
    }
    
    if (!context) {
      throw new Error(`Context not found: ${nameOrId}`);
    }
    
    await this.switchContext(context.id);
    
    return context;
  }
  
  /**
   * Query context history
   */
  async query(queryText) {
    const results = [];
    
    for (const context of this.contexts.values()) {
      // Simple text matching (would use semantic search in production)
      const matchScore = this._calculateMatchScore(context, queryText);
      
      if (matchScore > 0.3) {
        results.push({
          context,
          score: matchScore,
          matches: this._findMatches(context, queryText)
        });
      }
    }
    
    // Sort by score
    results.sort((a, b) => b.score - a.score);
    
    return results;
  }
  
  /**
   * Add a note to current context
   */
  async addNote(note) {
    if (!this.activeContext) {
      await this.createContext('Default Context');
    }
    
    const timestamp = new Date().toISOString();
    this.activeContext.notes += `\n[${timestamp}] ${note}`;
    
    await this._persist();
  }
  
  /**
   * Add a goal to current context
   */
  async addGoal(goal) {
    if (!this.activeContext) {
      await this.createContext('Default Context');
    }
    
    this.activeContext.goals.push({
      text: goal,
      created: Date.now(),
      completed: false
    });
    
    await this._persist();
  }
  
  /**
   * Add a decision to current context
   */
  async addDecision(decision, rationale) {
    if (!this.activeContext) {
      await this.createContext('Default Context');
    }
    
    this.activeContext.decisions.push({
      decision,
      rationale,
      timestamp: Date.now()
    });
    
    await this._persist();
  }
  
  /**
   * Add a blocker to current context
   */
  async addBlocker(blocker) {
    if (!this.activeContext) {
      await this.createContext('Default Context');
    }
    
    this.activeContext.blockers.push({
      description: blocker,
      added: Date.now(),
      resolved: false
    });
    
    await this._persist();
  }
  
  /**
   * Get context summary
   */
  getContextSummary(contextId) {
    const context = contextId ? this.contexts.get(contextId) : this.activeContext;
    if (!context) return null;
    
    return {
      name: context.name,
      summary: context.summary || this._generateBasicSummary(context),
      last_active: new Date(context.last_active).toLocaleString(),
      duration: this._formatDuration(Date.now() - context.created_at),
      goals: context.goals.filter(g => !g.completed).length,
      decisions: context.decisions.length,
      blockers: context.blockers.filter(b => !b.resolved).length,
      next_steps: context.next_steps
    };
  }
  
  /**
   * Get recent contexts
   */
  getRecentContexts(limit = 10) {
    return Array.from(this.contexts.values())
      .sort((a, b) => b.last_active - a.last_active)
      .slice(0, limit)
      .map(c => ({
        id: c.id,
        name: c.name,
        summary: c.summary || this._generateBasicSummary(c),
        last_active: new Date(c.last_active).toLocaleString()
      }));
  }
  
  /**
   * Start automatic context capture
   */
  startAutoCapture() {
    if (this.captureTimer) return;
    
    this.captureTimer = setInterval(async () => {
      try {
        await this.captureCurrentContext();
      } catch (error) {
        console.error('[ContextOS] Auto-capture failed:', error);
      }
    }, this.captureInterval);
    
    console.log('[ContextOS] Auto-capture started');
  }
  
  /**
   * Stop automatic context capture
   */
  stopAutoCapture() {
    if (this.captureTimer) {
      clearInterval(this.captureTimer);
      this.captureTimer = null;
      console.log('[ContextOS] Auto-capture stopped');
    }
  }
  
  /**
   * Generate AI summary of context
   */
  async _generateContextSummary(context) {
    if (!this.aiInterface) return;
    
    const prompt = `Summarize this work context:

Name: ${context.name}
Goals: ${context.goals.map(g => g.text).join(', ')}
Decisions: ${context.decisions.map(d => d.decision).join(', ')}
Notes: ${context.notes.substring(0, 500)}

Provide:
1. A brief summary (2-3 sentences)
2. Key insights
3. Suggested next steps`;
    
    try {
      const response = await this.aiInterface.generate({ prompt });
      
      // Parse response (simplified)
      context.summary = response.text.split('\n')[0];
      context.key_insights = response.text.split('\n').filter(line => line.startsWith('-'));
      context.next_steps = response.text.split('Next steps:')[1]?.split('\n').filter(Boolean) || [];
    } catch (error) {
      console.error('[ContextOS] Failed to generate summary:', error);
    }
  }
  
  /**
   * Restore a context (browser tabs, editor state, etc.)
   */
  async _restoreContext(context) {
    // Would integrate with actual browser/editor
    console.log(`[ContextOS] Restoring context state:`, {
      tabs: context.browser_tabs.length,
      files: context.working_files.length,
      goals: context.goals.length
    });
  }
  
  /**
   * Capture open browser tabs
   */
  _captureOpenTabs() {
    // Simplified - would integrate with actual browser
    return [];
  }
  
  /**
   * Capture open editor files
   */
  _captureOpenFiles() {
    // Simplified - would integrate with actual editor
    return [];
  }
  
  /**
   * Calculate match score for query
   */
  _calculateMatchScore(context, query) {
    const queryLower = query.toLowerCase();
    let score = 0;
    
    if (context.name.toLowerCase().includes(queryLower)) score += 0.5;
    if (context.summary.toLowerCase().includes(queryLower)) score += 0.3;
    if (context.notes.toLowerCase().includes(queryLower)) score += 0.2;
    if (context.tags.some(tag => tag.toLowerCase().includes(queryLower))) score += 0.3;
    
    return Math.min(1.0, score);
  }
  
  /**
   * Find matching text in context
   */
  _findMatches(context, query) {
    const matches = [];
    const queryLower = query.toLowerCase();
    
    if (context.summary.toLowerCase().includes(queryLower)) {
      matches.push({ field: 'summary', text: context.summary });
    }
    
    if (context.notes.toLowerCase().includes(queryLower)) {
      const noteLines = context.notes.split('\n');
      const matchingLines = noteLines.filter(line => line.toLowerCase().includes(queryLower));
      matches.push({ field: 'notes', text: matchingLines.join('\n') });
    }
    
    return matches;
  }
  
  /**
   * Generate basic summary
   */
  _generateBasicSummary(context) {
    const activeGoals = context.goals.filter(g => !g.completed).length;
    const parts = [];
    
    if (activeGoals > 0) parts.push(`${activeGoals} active goals`);
    if (context.decisions.length > 0) parts.push(`${context.decisions.length} decisions made`);
    if (context.blockers.filter(b => !b.resolved).length > 0) {
      parts.push(`${context.blockers.filter(b => !b.resolved).length} blockers`);
    }
    
    return parts.length > 0 ? parts.join(', ') : 'New context';
  }
  
  /**
   * Format duration
   */
  _formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
  
  /**
   * Persist context data
   */
  async _persist() {
    if (!this.userDID) return;
    
    try {
      const data = {
        contexts: Array.from(this.contexts.values()).map(c => c.toJSON()),
        activeContext: this.activeContext?.id,
        version: '1.0.0'
      };
      
      await this.store.set(`context_os_${this.userDID}`, JSON.stringify(data));
    } catch (error) {
      console.error('[ContextOS] Failed to persist:', error);
    }
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const contexts = Array.from(this.contexts.values());
    
    return {
      total_contexts: contexts.length,
      active_context: this.activeContext?.name || 'None',
      auto_capture: this.autoCapture ? 'enabled' : 'disabled',
      total_goals: contexts.reduce((sum, c) => sum + c.goals.length, 0),
      total_decisions: contexts.reduce((sum, c) => sum + c.decisions.length, 0),
      total_blockers: contexts.reduce((sum, c) => sum + c.blockers.length, 0)
    };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ContextOS, ContextSnapshot };
}
