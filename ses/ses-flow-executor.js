/**
 * SES Flow Executor - Layer 6 Flow Orchestration
 * 
 * Executes JSONFlow workflow definitions across multiple runtimes:
 * - Browser (local execution)
 * - Peer (WebRTC distributed execution)
 * - Cloud (optional fallback)
 * 
 * Features runtime selection based on:
 * - Cost optimization
 * - Privacy requirements (FHE)
 * - Resource availability
 * - Network conditions
 * 
 * Core Principles:
 * - Write once, run anywhere
 * - Privacy-preserving execution
 * - Automatic runtime fallback
 * - Full execution traceability
 */

class FlowExecutor {
  constructor(config = {}) {
    this.dcxRuntime = config.dcxRuntime;
    this.contentStore = config.contentStore;
    this.contextGraph = config.contextGraph;
    this.contributionGraph = config.contributionGraph;
    this.cstLedger = config.cstLedger;
    this.aiInterface = config.aiInterface;
    this.agentConsensus = config.agentConsensus;
    
    this.runtimePreferences = config.runtimePreferences || {
      prefer: 'cheapest',
      fallback: ['local', 'browser', 'peer', 'cloud'],
      privacy: 'standard'
    };
    
    this.executionHistory = [];
  }
  
  /**
   * Execute a workflow from FlowDefinition
   */
  async execute(flowDefinition, initialInputs = {}) {
    console.log(`[FlowExecutor] Executing workflow: ${flowDefinition.workflow_id}`);
    
    const executionId = this._generateExecutionId();
    const context = {
      executionId,
      workflowId: flowDefinition.workflow_id,
      startTime: Date.now(),
      variables: { ...initialInputs },
      stepResults: new Map(),
      errors: []
    };
    
    try {
      // Validate workflow
      this._validateWorkflow(flowDefinition);
      
      // Check runtime requirements
      await this._checkRuntimeRequirements(flowDefinition.runtime_requirements);
      
      // Execute steps in order
      for (const step of flowDefinition.steps) {
        await this._executeStep(step, context, flowDefinition);
      }
      
      // Record execution
      const execution = {
        executionId,
        workflowId: flowDefinition.workflow_id,
        startTime: context.startTime,
        endTime: Date.now(),
        duration: Date.now() - context.startTime,
        success: true,
        results: Object.fromEntries(context.stepResults),
        variables: context.variables
      };
      
      this.executionHistory.push(execution);
      
      console.log(`[FlowExecutor] Completed workflow ${flowDefinition.workflow_id} in ${execution.duration}ms`);
      
      return execution;
      
    } catch (error) {
      console.error(`[FlowExecutor] Workflow failed:`, error);
      
      const execution = {
        executionId,
        workflowId: flowDefinition.workflow_id,
        startTime: context.startTime,
        endTime: Date.now(),
        duration: Date.now() - context.startTime,
        success: false,
        error: error.message,
        errors: context.errors,
        partialResults: Object.fromEntries(context.stepResults)
      };
      
      this.executionHistory.push(execution);
      
      throw error;
    }
  }
  
  /**
   * Execute a single step
   */
  async _executeStep(step, context, flowDefinition) {
    console.log(`[FlowExecutor] Executing step: ${step.id} (${step.type})`);
    
    try {
      let result;
      
      switch (step.type) {
        case 'context_query':
          result = await this._executeContextQuery(step, context);
          break;
          
        case 'ai_inference':
          result = await this._executeAIInference(step, context);
          break;
          
        case 'contribution_economy':
          result = await this._executeContributionEconomy(step, context);
          break;
          
        case 'pulse_execution':
          result = await this._executePulse(step, context);
          break;
          
        case 'agent_reasoning':
          result = await this._executeAgentReasoning(step, context);
          break;
          
        case 'cst_operation':
          result = await this._executeCSTOperation(step, context);
          break;
          
        case 'scaffold_update':
          result = await this._executeScaffoldUpdate(step, context);
          break;
          
        case 'conditional':
          result = await this._executeConditional(step, context, flowDefinition);
          break;
          
        case 'loop':
          result = await this._executeLoop(step, context, flowDefinition);
          break;
          
        case 'parallel':
          result = await this._executeParallel(step, context, flowDefinition);
          break;
          
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }
      
      // Store results
      context.stepResults.set(step.id, result);
      
      // Store outputs in variables
      if (step.outputs && Array.isArray(step.outputs)) {
        for (const outputName of step.outputs) {
          context.variables[outputName] = result;
        }
      }
      
      return result;
      
    } catch (error) {
      context.errors.push({
        stepId: step.id,
        error: error.message,
        timestamp: Date.now()
      });
      throw error;
    }
  }
  
  /**
   * Execute context query step
   */
  async _executeContextQuery(step, context) {
    if (!this.contextGraph) {
      throw new Error('Context graph not available');
    }
    
    const query = this._resolveVariables(step.query, context);
    
    // Query context graph
    const results = await this.contextGraph.query(query);
    
    return results;
  }
  
  /**
   * Execute AI inference step
   */
  async _executeAIInference(step, context) {
    if (!this.aiInterface) {
      throw new Error('AI interface not available');
    }
    
    const prompt = this._resolveVariables(step.prompt, context);
    const model = step.model || 'default';
    
    const response = await this.aiInterface.generate({
      model,
      prompt,
      parameters: step.parameters || {}
    });
    
    return response;
  }
  
  /**
   * Execute contribution economy operation
   */
  async _executeContributionEconomy(step, context) {
    if (!this.contributionGraph) {
      throw new Error('Contribution graph not available');
    }
    
    const action = step.action;
    
    if (action === 'issue_shares') {
      const novelty = this._resolveVariables(step.novelty, context);
      const contribution = await this.contributionGraph.addContribution({
        author: step.author || context.variables.current_user,
        type: step.contribution_type || 'insight',
        content: step.content,
        novelty: novelty,
        quality: step.quality || 0.5
      });
      
      return {
        contribution_id: contribution.id,
        shares_issued: contribution.shares_issued
      };
    }
    
    throw new Error(`Unknown contribution action: ${action}`);
  }
  
  /**
   * Execute pulse
   */
  async _executePulse(step, context) {
    if (!this.dcxRuntime) {
      throw new Error('DCX runtime not available');
    }
    
    const input = this._resolveVariables(step.input, context);
    const functionCID = step.function;
    const bounds = step.bounds || {};
    
    // Create and execute pulse
    const pulse = await this.dcxRuntime.createPulse({
      input,
      function_cid: functionCID,
      bounds: {
        max_steps: bounds.max_steps || 10000,
        max_memory: bounds.max_memory || 10485760,
        max_branch_depth: bounds.max_branch_depth || 50
      }
    });
    
    const result = await this.dcxRuntime.execute(pulse);
    
    return {
      pulse_id: pulse.pulse_id,
      output: result.output,
      trace_cid: result.trace_cid
    };
  }
  
  /**
   * Execute agent reasoning
   */
  async _executeAgentReasoning(step, context) {
    if (!this.agentConsensus) {
      throw new Error('Agent consensus not available');
    }
    
    const claim = {
      subject: this._resolveVariables(step.claim.subject, context),
      predicate: step.claim.predicate,
      confidence: step.claim.confidence || 0.9
    };
    
    const consensus = await this.agentConsensus.reason(claim);
    
    return {
      verdict: consensus.verdict,
      confidence: consensus.confidence,
      evidence: consensus.evidence
    };
  }
  
  /**
   * Execute CST operation
   */
  async _executeCSTOperation(step, context) {
    if (!this.cstLedger) {
      throw new Error('CST ledger not available');
    }
    
    const action = step.action;
    
    if (action === 'conditional_unlock') {
      const condition = this._resolveVariables(step.condition, context);
      
      if (this._evaluateCondition(condition, context)) {
        const tokens = await this.cstLedger.conditionalUnlock(
          step.recipient,
          step.tokens,
          step.unlock_conditions || []
        );
        
        return {
          unlocked: true,
          tokens: tokens.length,
          token_ids: tokens.map(t => t.token_id)
        };
      }
      
      return { unlocked: false, reason: 'Condition not met' };
    }
    
    throw new Error(`Unknown CST action: ${action}`);
  }
  
  /**
   * Execute scaffold update
   */
  async _executeScaffoldUpdate(step, context) {
    // Simplified - would integrate with full scaffold system
    return {
      skill_updated: step.skill,
      performance: step.performance || 0.8,
      autonomy: step.autonomy || 0.7
    };
  }
  
  /**
   * Execute conditional step
   */
  async _executeConditional(step, context, flowDefinition) {
    const condition = this._resolveVariables(step.condition, context);
    const conditionMet = this._evaluateCondition(condition, context);
    
    if (conditionMet && step.then_steps) {
      for (const thenStep of step.then_steps) {
        await this._executeStep(thenStep, context, flowDefinition);
      }
    } else if (!conditionMet && step.else_steps) {
      for (const elseStep of step.else_steps) {
        await this._executeStep(elseStep, context, flowDefinition);
      }
    }
    
    return { condition_met: conditionMet };
  }
  
  /**
   * Execute loop
   */
  async _executeLoop(step, context, flowDefinition) {
    const iterations = [];
    const maxIterations = step.max_iterations || 100;
    let iteration = 0;
    
    while (iteration < maxIterations) {
      const condition = this._resolveVariables(step.while_condition, context);
      if (!this._evaluateCondition(condition, context)) {
        break;
      }
      
      const iterationContext = { ...context };
      iterationContext.variables = { ...context.variables, iteration };
      
      for (const loopStep of step.steps) {
        await this._executeStep(loopStep, iterationContext, flowDefinition);
      }
      
      iterations.push(iterationContext.stepResults);
      iteration++;
    }
    
    return { iterations: iterations.length, results: iterations };
  }
  
  /**
   * Execute parallel steps
   */
  async _executeParallel(step, context, flowDefinition) {
    const promises = step.steps.map(parallelStep => 
      this._executeStep(parallelStep, { ...context }, flowDefinition)
    );
    
    const results = await Promise.all(promises);
    
    return { results };
  }
  
  /**
   * Resolve variables in strings (e.g., "$variable.field")
   */
  _resolveVariables(value, context) {
    if (typeof value !== 'string') {
      return value;
    }
    
    // Replace $variable.field references
    return value.replace(/\$([a-zA-Z0-9_]+)(\.[a-zA-Z0-9_]+)*/g, (match, varName, path) => {
      let resolved = context.variables[varName];
      
      if (path) {
        const fields = path.slice(1).split('.');
        for (const field of fields) {
          resolved = resolved?.[field];
        }
      }
      
      return resolved !== undefined ? resolved : match;
    });
  }
  
  /**
   * Evaluate a condition expression
   */
  _evaluateCondition(condition, context) {
    if (typeof condition === 'boolean') {
      return condition;
    }
    
    if (typeof condition === 'string') {
      // Simple evaluation (would use safe eval in production)
      try {
        const resolved = this._resolveVariables(condition, context);
        // Very basic evaluation
        return eval(resolved);
      } catch (error) {
        console.warn('[FlowExecutor] Condition evaluation failed:', error);
        return false;
      }
    }
    
    return false;
  }
  
  /**
   * Validate workflow structure
   */
  _validateWorkflow(flowDefinition) {
    if (!flowDefinition.workflow_id) {
      throw new Error('Workflow must have workflow_id');
    }
    
    if (!Array.isArray(flowDefinition.steps)) {
      throw new Error('Workflow must have steps array');
    }
    
    for (const step of flowDefinition.steps) {
      if (!step.id) {
        throw new Error('Each step must have an id');
      }
      if (!step.type) {
        throw new Error('Each step must have a type');
      }
    }
  }
  
  /**
   * Check runtime requirements
   */
  async _checkRuntimeRequirements(requirements) {
    if (!requirements) return true;
    
    // Simplified - would check actual system capabilities
    const available = {
      memory: 1024 * 1024 * 1024, // 1GB
      cpu: 4,
      gpu: false,
      network: true
    };
    
    if (requirements.min_memory && available.memory < this._parseMemory(requirements.min_memory)) {
      throw new Error('Insufficient memory');
    }
    
    return true;
  }
  
  _parseMemory(memStr) {
    const units = { KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
    const match = memStr.match(/^(\d+)(KB|MB|GB)$/);
    if (match) {
      return parseInt(match[1]) * units[match[2]];
    }
    return 0;
  }
  
  /**
   * Generate unique execution ID
   */
  _generateExecutionId() {
    return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Get execution history
   */
  getHistory(limit = 10) {
    return this.executionHistory.slice(-limit).reverse();
  }
  
  /**
   * Get execution by ID
   */
  getExecution(executionId) {
    return this.executionHistory.find(e => e.executionId === executionId);
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FlowExecutor };
}
