/**
 * SES-AI.JS - Local Ollama AI Layer
 * 
 * Separate from DCX runtime. Never embedded in execution.
 * All inputs/outputs are CID-wrapped for reproducibility.
 * Graceful degradation when Ollama is unavailable.
 * 
 * Core Properties:
 * - AI is ABOVE the execution layer, never inside
 * - Every call produces CID-wrapped artifacts
 * - System works without AI (graceful degradation)
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // CONFIGURATION
  // ============================================
  const DEFAULT_CONFIG = {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2',
    timeout: 60000, // 60 seconds
    retries: 2,
    retryDelay: 1000
  };

  // ============================================
  // AI REQUEST/RESPONSE WRAPPERS
  // CID-wrapped for reproducibility
  // ============================================
  class AIRequest {
    constructor(options = {}) {
      this.id = null; // CID set after storage
      this.model = options.model || DEFAULT_CONFIG.model;
      this.prompt = options.prompt;
      this.context = options.context || null;
      this.options = options.options || {};
      this.timestamp = new Date().toISOString();
    }

    toJSON() {
      return {
        id: this.id,
        model: this.model,
        prompt: this.prompt,
        context: this.context,
        options: this.options,
        timestamp: this.timestamp
      };
    }
  }

  class AIResponse {
    constructor(options = {}) {
      this.id = null; // CID set after storage
      this.requestCid = options.requestCid;
      this.model = options.model;
      this.response = options.response;
      this.done = options.done || true;
      this.totalDuration = options.totalDuration || 0;
      this.loadDuration = options.loadDuration || 0;
      this.promptEvalDuration = options.promptEvalDuration || 0;
      this.evalDuration = options.evalDuration || 0;
      this.evalCount = options.evalCount || 0;
      this.timestamp = new Date().toISOString();
      this.offline = options.offline || false;
      this.error = options.error || null;
    }

    toJSON() {
      return {
        id: this.id,
        requestCid: this.requestCid,
        model: this.model,
        response: this.response,
        done: this.done,
        totalDuration: this.totalDuration,
        loadDuration: this.loadDuration,
        promptEvalDuration: this.promptEvalDuration,
        evalDuration: this.evalDuration,
        evalCount: this.evalCount,
        timestamp: this.timestamp,
        offline: this.offline,
        error: this.error
      };
    }
  }

  // ============================================
  // OLLAMA CLIENT
  // Local Ollama HTTP API client
  // ============================================
  class OllamaClient {
    constructor(store, config = {}) {
      this.store = store;
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.available = null; // null = unknown, true/false = checked
      this.lastCheck = null;
      this.listeners = [];
    }

    on(callback) {
      if (typeof callback === 'function') {
        this.listeners.push(callback);
      }
    }

    emit(event, data) {
      this.listeners.forEach(cb => {
        if (typeof cb === 'function') {
          try {
            cb(event, data);
          } catch (error) {
            console.error('Error in listener callback:', error);
          }
        }
      });
    }

    // Check if Ollama is available
    async checkAvailability() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(`${this.config.baseUrl}/api/tags`, {
          method: 'GET',
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        this.available = response.ok;
        this.lastCheck = Date.now();
        
        if (response.ok) {
          const data = await response.json();
          this.emit('available', { models: data.models || [] });
          return { available: true, models: data.models || [] };
        }

        this.emit('unavailable', { reason: 'Bad response' });
        return { available: false, reason: 'Bad response' };

      } catch (error) {
        this.available = false;
        this.lastCheck = Date.now();
        this.emit('unavailable', { reason: error.message });
        return { available: false, reason: error.message };
      }
    }

    // List available models
    async listModels() {
      const check = await this.checkAvailability();
      return check.models || [];
    }

    // Generate completion
    async generate(prompt, options = {}) {
      // Create and store request
      const request = new AIRequest({
        model: options.model || this.config.model,
        prompt,
        context: options.context,
        options: options.options || {}
      });

      const requestCid = await this.store.store(request.toJSON());
      request.id = requestCid;

      this.emit('request', { request: request.toJSON() });

      // Check availability
      if (this.available === null || Date.now() - this.lastCheck > 30000) {
        await this.checkAvailability();
      }

      if (!this.available) {
        // Graceful degradation - return offline response
        const offlineResponse = new AIResponse({
          requestCid,
          model: request.model,
          response: this.getOfflineResponse(prompt),
          offline: true,
          error: 'Ollama unavailable - using offline fallback'
        });

        const responseCid = await this.store.store(offlineResponse.toJSON());
        offlineResponse.id = responseCid;

        this.emit('response', { response: offlineResponse.toJSON(), offline: true });
        return offlineResponse;
      }

      // Make API call with retries
      let lastError = null;
      for (let attempt = 0; attempt <= this.config.retries; attempt++) {
        try {
          const response = await this.callAPI(request);
          
          const aiResponse = new AIResponse({
            requestCid,
            model: request.model,
            response: response.response,
            done: response.done,
            totalDuration: response.total_duration,
            loadDuration: response.load_duration,
            promptEvalDuration: response.prompt_eval_duration,
            evalDuration: response.eval_duration,
            evalCount: response.eval_count
          });

          const responseCid = await this.store.store(aiResponse.toJSON());
          aiResponse.id = responseCid;

          this.emit('response', { response: aiResponse.toJSON(), offline: false });
          return aiResponse;

        } catch (error) {
          lastError = error;
          if (attempt < this.config.retries) {
            await this.delay(this.config.retryDelay * (attempt + 1));
          }
        }
      }

      // All retries failed - graceful degradation
      this.available = false;
      
      const offlineResponse = new AIResponse({
        requestCid,
        model: request.model,
        response: this.getOfflineResponse(prompt),
        offline: true,
        error: lastError?.message || 'API call failed'
      });

      const responseCid = await this.store.store(offlineResponse.toJSON());
      offlineResponse.id = responseCid;

      this.emit('response', { response: offlineResponse.toJSON(), offline: true });
      return offlineResponse;
    }

    // Internal API call
    async callAPI(request) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(`${this.config.baseUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: request.model,
            prompt: request.prompt,
            stream: false,
            context: request.context,
            options: request.options
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();

      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Get offline fallback response
    getOfflineResponse(prompt) {
      return `[OFFLINE MODE] AI analysis unavailable. Prompt received: "${prompt.substring(0, 100)}..." - System continues to function without AI layer.`;
    }

    delay(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Analyze a Pulse result (high-level helper)
    async analyzePulse(pulse, output) {
      const prompt = `Analyze this computation result from the Sovereign Execution Substrate:

Pulse ID: ${pulse.pulseId}
Status: ${pulse.status}
Steps Executed: ${pulse.traceCid ? 'See trace' : 'Unknown'}
Bounds: Max ${pulse.bounds.maxSteps} steps, ${pulse.bounds.maxMemoryBytes} bytes

Output:
${JSON.stringify(output, null, 2)}

Provide a brief analysis of:
1. Computation efficiency (resource usage vs bounds)
2. Output validity and structure
3. Any potential issues or optimizations`;

      return this.generate(prompt, {
        options: {
          temperature: 0.3,
          num_predict: 500
        }
      });
    }

    // Analyze novelty of content
    async analyzeNovelty(content) {
      const prompt = `Rate the novelty of this content on a scale of 0.0 to 1.0:

Content:
${JSON.stringify(content, null, 2)}

Respond with ONLY a JSON object in this format:
{"novelty": 0.X, "reasoning": "brief explanation"}`;

      const response = await this.generate(prompt, {
        options: {
          temperature: 0.1,
          num_predict: 200
        }
      });

      // Try to parse JSON from response
      try {
        const match = response.response.match(/\{[^}]+\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
      } catch (e) {
        // Fallback
      }

      return { novelty: 0.5, reasoning: 'Unable to parse AI response', raw: response.response };
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESAI = {
    DEFAULT_CONFIG,
    AIRequest,
    AIResponse,
    OllamaClient
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESAI;
  } else {
    global.SESAI = SESAI;
  }

})(typeof window !== 'undefined' ? window : global);