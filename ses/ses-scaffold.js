/**
 * SES Scaffold - Layer 7 AI Dependency Prevention
 * 
 * Wraps AI interactions to prevent cognitive dependency by:
 * - Breaking tasks into learning steps
 * - Asking guiding questions instead of giving answers
 * - Tracking skill development over time
 * - Gradually reducing assistance as competence grows
 * 
 * The goal is AI that teaches, not replaces human capability.
 * 
 * Core Principles:
 * - Never do for the user what they can do themselves
 * - Socratic method over direct answers
 * - Track autonomy and gradually fade support
 * - Build long-term capability, not short-term convenience
 */

class SkillNode {
  constructor(data) {
    this.skill_id = data.skill_id;
    this.name = data.name;
    this.domain = data.domain;
    this.description = data.description;
    
    // Proficiency tracking
    this.current_level = data.current_level || 0; // 0-1 scale
    this.target_level = data.target_level || 0.8;
    this.attempts = data.attempts || 0;
    this.successes = data.successes || 0;
    this.last_attempt = data.last_attempt || null;
    
    // Learning path
    this.prerequisites = data.prerequisites || [];
    this.related_skills = data.related_skills || [];
    this.learning_resources = data.learning_resources || [];
    
    // Scaffolding state
    this.current_scaffold_level = data.current_scaffold_level || 1.0; // 1.0 = full support, 0.0 = no support
    this.independence_threshold = data.independence_threshold || 0.7;
    
    this.history = data.history || [];
  }
  
  toJSON() {
    return {
      skill_id: this.skill_id,
      name: this.name,
      domain: this.domain,
      description: this.description,
      current_level: this.current_level,
      target_level: this.target_level,
      attempts: this.attempts,
      successes: this.successes,
      last_attempt: this.last_attempt,
      prerequisites: this.prerequisites,
      related_skills: this.related_skills,
      learning_resources: this.learning_resources,
      current_scaffold_level: this.current_scaffold_level,
      independence_threshold: this.independence_threshold,
      history: this.history
    };
  }
}

class ScaffoldSystem {
  constructor(store, aiInterface) {
    this.store = store;
    this.aiInterface = aiInterface;
    this.skills = new Map(); // skill_id -> SkillNode
    this.userProfile = null;
    this.initialized = false;
  }
  
  async initialize(userDID) {
    if (this.initialized) return;
    
    try {
      const stored = await this.store.get(`scaffold_${userDID}`);
      if (stored) {
        const data = JSON.parse(stored);
        this.userProfile = data.userProfile;
        
        data.skills.forEach(s => {
          const skill = new SkillNode(s);
          this.skills.set(skill.skill_id, skill);
        });
      } else {
        this.userProfile = {
          user_did: userDID,
          created_at: Date.now(),
          overall_autonomy: 0.0
        };
      }
    } catch (error) {
      console.warn('[Scaffold] Failed to load from store:', error);
    }
    
    this.initialized = true;
    console.log(`[Scaffold] Initialized with ${this.skills.size} skills`);
  }
  
  /**
   * Wrap an AI request with pedagogical scaffolding
   */
  async scaffoldedRequest(request, options = {}) {
    const skill = await this._identifySkill(request);
    const scaffoldLevel = this._determineScaffoldLevel(skill);
    
    console.log(`[Scaffold] Request for skill "${skill.name}" at scaffold level ${scaffoldLevel.toFixed(2)}`);
    
    if (scaffoldLevel < 0.3 && skill.current_level > 0.7) {
      // User is proficient, minimal scaffolding
      return this._minimalScaffold(request, skill);
    } else if (scaffoldLevel < 0.7) {
      // Moderate scaffolding - guided assistance
      return this._guidedScaffold(request, skill);
    } else {
      // Full scaffolding - Socratic method
      return this._fullScaffold(request, skill);
    }
  }
  
  /**
   * Minimal scaffolding for proficient users
   */
  async _minimalScaffold(request, skill) {
    // Just execute, but track that they're working independently
    const response = await this.aiInterface.generate({
      prompt: request,
      mode: 'direct'
    });
    
    skill.attempts++;
    skill.successes++;
    skill.current_level = Math.min(1.0, skill.current_level + 0.01);
    skill.current_scaffold_level = Math.max(0.0, skill.current_scaffold_level - 0.05);
    skill.last_attempt = Date.now();
    
    await this._persist();
    
    return {
      type: 'direct',
      response: response.text,
      skill_updated: skill.name,
      autonomy_level: skill.current_level
    };
  }
  
  /**
   * Guided scaffolding - break into steps
   */
  async _guidedScaffold(request, skill) {
    // Break the task into steps and guide through each
    const steps = await this._breakIntoSteps(request, skill);
    
    const guidance = {
      type: 'guided',
      skill: skill.name,
      message: `Let's break this into steps. Here's the approach:`,
      steps: steps.map((step, i) => ({
        step: i + 1,
        description: step.description,
        hint: step.hint,
        key_concept: step.key_concept
      })),
      next_action: "Start with step 1. What would you do first?"
    };
    
    skill.attempts++;
    skill.last_attempt = Date.now();
    
    await this._persist();
    
    return guidance;
  }
  
  /**
   * Full scaffolding - Socratic method
   */
  async _fullScaffold(request, skill) {
    // Don't give the answer, ask guiding questions
    const questions = await this._generateSocraticQuestions(request, skill);
    
    const scaffolding = {
      type: 'socratic',
      skill: skill.name,
      message: `Let's think through this together. I'll ask you some questions to guide your thinking.`,
      questions: questions,
      encouragement: this._getEncouragement(skill),
      hint: "Try thinking about the core challenge first."
    };
    
    skill.attempts++;
    skill.last_attempt = Date.now();
    
    await this._persist();
    
    return scaffolding;
  }
  
  /**
   * Record user's attempt at a task
   */
  async recordAttempt(skillId, success, userSolution, feedback = null) {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    
    skill.attempts++;
    if (success) {
      skill.successes++;
    }
    
    // Update proficiency
    const successRate = skill.successes / skill.attempts;
    skill.current_level = successRate;
    
    // Adjust scaffold level
    if (success) {
      // Reduce scaffolding on success
      skill.current_scaffold_level = Math.max(0.0, skill.current_scaffold_level - 0.1);
    } else {
      // Increase scaffolding on failure
      skill.current_scaffold_level = Math.min(1.0, skill.current_scaffold_level + 0.1);
    }
    
    // Add to history
    skill.history.push({
      timestamp: Date.now(),
      success,
      solution: userSolution,
      feedback,
      proficiency_after: skill.current_level,
      scaffold_level_after: skill.current_scaffold_level
    });
    
    await this._persist();
    
    return {
      skill: skill.name,
      new_level: skill.current_level,
      scaffold_level: skill.current_scaffold_level,
      progress: skill.current_level >= skill.target_level ? 'proficient' : 'learning'
    };
  }
  
  /**
   * Identify which skill a request relates to
   */
  async _identifySkill(request) {
    // Simplified - would use AI to classify request
    const requestLower = request.toLowerCase();
    
    // Check existing skills
    for (const skill of this.skills.values()) {
      if (requestLower.includes(skill.name.toLowerCase()) || 
          requestLower.includes(skill.domain.toLowerCase())) {
        return skill;
      }
    }
    
    // Create new skill if not found
    const domain = await this._inferDomain(request);
    const skillId = `skill_${Date.now()}`;
    
    const newSkill = new SkillNode({
      skill_id: skillId,
      name: domain,
      domain: domain,
      description: `Skill inferred from: ${request.substring(0, 50)}...`
    });
    
    this.skills.set(skillId, newSkill);
    await this._persist();
    
    return newSkill;
  }
  
  /**
   * Determine appropriate scaffold level for a skill
   */
  _determineScaffoldLevel(skill) {
    // Base on current proficiency and past performance
    if (skill.current_level < 0.3) {
      return 1.0; // Full scaffolding
    } else if (skill.current_level < 0.6) {
      return 0.6; // Moderate scaffolding
    } else {
      return 0.2; // Minimal scaffolding
    }
  }
  
  /**
   * Break a task into learning steps
   */
  async _breakIntoSteps(request, skill) {
    // Simplified - would use AI to generate pedagogically sound steps
    const steps = [
      {
        description: "Understand the problem",
        hint: "What is being asked? What do you already know?",
        key_concept: "Problem decomposition"
      },
      {
        description: "Identify the approach",
        hint: "What strategy or algorithm fits this problem?",
        key_concept: "Pattern recognition"
      },
      {
        description: "Implement the solution",
        hint: "Start with a simple version, then refine",
        key_concept: "Iterative development"
      },
      {
        description: "Verify and test",
        hint: "Check edge cases and validate logic",
        key_concept: "Testing and validation"
      }
    ];
    
    return steps;
  }
  
  /**
   * Generate Socratic questions to guide learning
   */
  async _generateSocraticQuestions(request, skill) {
    // Simplified - would use AI to generate contextual questions
    return [
      "What is the core challenge in this task?",
      "What similar problems have you solved before?",
      "What do you think the first step should be?",
      "What assumptions are you making?"
    ];
  }
  
  /**
   * Get encouraging message based on skill progress
   */
  _getEncouragement(skill) {
    if (skill.attempts === 0) {
      return "Everyone starts somewhere. Let's learn together!";
    } else if (skill.current_level < 0.3) {
      return "You're making progress! Keep practicing.";
    } else if (skill.current_level < 0.7) {
      return "You're getting better at this!";
    } else {
      return "You're becoming proficient! Soon you won't need my help.";
    }
  }
  
  /**
   * Infer domain from request
   */
  async _inferDomain(request) {
    const requestLower = request.toLowerCase();
    
    if (requestLower.includes('algorithm') || requestLower.includes('code')) {
      return 'programming';
    } else if (requestLower.includes('design') || requestLower.includes('ui')) {
      return 'design';
    } else if (requestLower.includes('write') || requestLower.includes('document')) {
      return 'writing';
    } else if (requestLower.includes('math') || requestLower.includes('calculate')) {
      return 'mathematics';
    }
    
    return 'general';
  }
  
  /**
   * Get skill progress report
   */
  getSkillReport(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) return null;
    
    const successRate = skill.attempts > 0 ? (skill.successes / skill.attempts * 100).toFixed(1) : 0;
    const isIndependent = skill.current_level >= skill.independence_threshold;
    
    return {
      skill: skill.name,
      domain: skill.domain,
      proficiency: (skill.current_level * 100).toFixed(1) + '%',
      attempts: skill.attempts,
      successes: skill.successes,
      success_rate: successRate + '%',
      scaffold_level: (skill.current_scaffold_level * 100).toFixed(1) + '%',
      independent: isIndependent,
      last_attempt: skill.last_attempt ? new Date(skill.last_attempt).toLocaleString() : 'Never'
    };
  }
  
  /**
   * Get overall user progress
   */
  getOverallProgress() {
    const skills = Array.from(this.skills.values());
    
    if (skills.length === 0) {
      return {
        total_skills: 0,
        average_proficiency: 0,
        independent_skills: 0,
        overall_autonomy: 0
      };
    }
    
    const totalProficiency = skills.reduce((sum, s) => sum + s.current_level, 0);
    const avgProficiency = totalProficiency / skills.length;
    const independentSkills = skills.filter(s => s.current_level >= s.independence_threshold).length;
    
    return {
      total_skills: skills.length,
      average_proficiency: (avgProficiency * 100).toFixed(1) + '%',
      independent_skills: independentSkills,
      learning_skills: skills.length - independentSkills,
      overall_autonomy: (avgProficiency * 100).toFixed(1) + '%',
      skills: skills.map(s => ({
        name: s.name,
        proficiency: (s.current_level * 100).toFixed(1) + '%',
        attempts: s.attempts
      }))
    };
  }
  
  /**
   * Persist scaffold data
   */
  async _persist() {
    if (!this.userProfile) return;
    
    try {
      const data = {
        userProfile: this.userProfile,
        skills: Array.from(this.skills.values()).map(s => s.toJSON()),
        version: '1.0.0'
      };
      
      await this.store.set(`scaffold_${this.userProfile.user_did}`, JSON.stringify(data));
    } catch (error) {
      console.error('[Scaffold] Failed to persist:', error);
    }
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ScaffoldSystem, SkillNode };
}
