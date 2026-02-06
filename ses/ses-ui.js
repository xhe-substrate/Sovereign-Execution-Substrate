/**
 * SES-UI.JS - User Interface for SES
 * 
 * Minimal architecture visualization showing:
 * - Pulse creation
 * - Real-time resource bounds
 * - CIDs for inputs/outputs/traces
 * - Deterministic replay
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // UI STATE
  // ============================================
  const UIState = {
    store: null,
    runtime: null,
    context: null,
    ai: null,
    pulses: [],
    currentPulse: null,
    executing: false,
    aiAvailable: false
  };

  // ============================================
  // INITIALIZATION
  // ============================================
  async function init() {
    // Create store (hybrid: memory + IndexedDB)
    UIState.store = await SESStore.createStore({ type: 'hybrid' });

    // Create DCX runtime
    UIState.runtime = new SESCore.DCXRuntime(UIState.store);

    // Create context stream
    UIState.context = new SESContext.ContextStream(UIState.store);

    // Create AI client
    UIState.ai = new SESAI.OllamaClient(UIState.store);

    // Setup event listeners
    setupRuntimeListeners();
    setupAIListeners();
    setupUIListeners();

    // Check AI availability
    const aiStatus = await UIState.ai.checkAvailability();
    UIState.aiAvailable = aiStatus.available;
    updateAIStatus(aiStatus);

    // Load stored pulses
    await loadStoredPulses();

    // Register demo functions
    await registerDemoFunctions();

    log('SES initialized', 'success');
    updateStatus('Ready');
  }

  // ============================================
  // DEMO FUNCTIONS
  // Pre-registered functions for demonstration
  // ============================================
  async function registerDemoFunctions() {
    // Fibonacci with step tracking
    const fibCid = await UIState.runtime.registerFunction(
      async function fibonacci(input, ctx) {
        const n = input?.n || 10;
        let a = 0, b = 1;
        const sequence = [a];
        
        ctx.step('init', { n }, { a, b });
        
        for (let i = 1; i < n; i++) {
          ctx.step('iterate', { i }, { current: b });
          sequence.push(b);
          const temp = a + b;
          a = b;
          b = temp;
          ctx.allocate(8); // Track memory for each number
        }
        
        ctx.step('complete', { length: sequence.length }, sequence);
        return { sequence, sum: sequence.reduce((a, b) => a + b, 0) };
      },
      { name: 'fibonacci', description: 'Generate Fibonacci sequence' }
    );

    // Prime checker with branch tracking
    const primeCid = await UIState.runtime.registerFunction(
      async function isPrime(input, ctx) {
        const num = input?.number || 17;
        ctx.step('start', { num }, null);
        
        if (num < 2) {
          ctx.step('trivial', { num }, false);
          return { number: num, isPrime: false, reason: 'Less than 2' };
        }
        
        ctx.enterBranch();
        for (let i = 2; i <= Math.sqrt(num); i++) {
          ctx.step('check_divisor', { i, num }, null);
          if (num % i === 0) {
            ctx.step('found_divisor', { i }, false);
            ctx.exitBranch();
            return { number: num, isPrime: false, divisor: i };
          }
        }
        ctx.exitBranch();
        
        ctx.step('is_prime', { num }, true);
        return { number: num, isPrime: true };
      },
      { name: 'isPrime', description: 'Check if number is prime' }
    );

    // Array sorter (deterministic)
    const sortCid = await UIState.runtime.registerFunction(
      async function sortArray(input, ctx) {
        const arr = input?.array || [5, 2, 8, 1, 9];
        const sorted = [...arr];
        const n = sorted.length;
        
        ctx.step('start', { length: n }, null);
        ctx.allocate(n * 8);
        
        // Bubble sort with full tracking
        for (let i = 0; i < n - 1; i++) {
          ctx.enterBranch();
          for (let j = 0; j < n - i - 1; j++) {
            ctx.step('compare', { i, j, a: sorted[j], b: sorted[j + 1] }, null);
            if (sorted[j] > sorted[j + 1]) {
              ctx.step('swap', { j }, { before: [sorted[j], sorted[j + 1]] });
              [sorted[j], sorted[j + 1]] = [sorted[j + 1], sorted[j]];
            }
          }
          ctx.exitBranch();
        }
        
        ctx.step('complete', {}, sorted);
        return { original: arr, sorted, comparisons: ctx.getUsage().steps };
      },
      { name: 'sortArray', description: 'Sort array with bubble sort' }
    );

    // Custom computation (from user input)
    const customCid = await UIState.runtime.registerFunction(
      async function customCompute(input, ctx) {
        ctx.step('start', { input }, null);
        
        // Echo input with metadata
        const result = {
          received: input,
          processed: true,
          timestamp: new Date().toISOString(),
          steps: 0
        };
        
        // Do some tracked work
        if (input?.iterations) {
          for (let i = 0; i < Math.min(input.iterations, 1000); i++) {
            ctx.step('iteration', { i }, null);
            result.steps++;
          }
        }
        
        ctx.step('complete', {}, result);
        return result;
      },
      { name: 'customCompute', description: 'Custom computation with input' }
    );

    // Store function CIDs for UI
    UIState.demoFunctions = {
      fibonacci: fibCid,
      isPrime: primeCid,
      sortArray: sortCid,
      customCompute: customCid
    };

    // Update function selector
    const select = document.getElementById('function-select');
    if (select) {
      select.innerHTML = `
        <option value="fibonacci">Fibonacci Sequence</option>
        <option value="isPrime">Prime Checker</option>
        <option value="sortArray">Array Sorter</option>
        <option value="customCompute">Custom Computation</option>
      `;
    }

    log('Demo functions registered', 'info');
  }

  // ============================================
  // RUNTIME EVENT LISTENERS
  // ============================================
  function setupRuntimeListeners() {
    UIState.runtime.on('step', (data) => {
      updateBoundsDisplay(data);
      addTraceStep(data);
    });

    UIState.runtime.on('boundViolation', (data) => {
      log(`Bound violation: ${data.reason}`, 'error');
      updateStatus(`VIOLATED: ${data.reason}`);
    });

    UIState.runtime.on('complete', (data) => {
      log('Pulse completed', 'success');
      updatePulseDisplay(data.pulse);
      UIState.pulses.push(data.pulse);
      updatePulseList();
    });

    UIState.runtime.on('error', (data) => {
      log(`Execution error: ${data.error?.message}`, 'error');
    });
  }

  // ============================================
  // AI EVENT LISTENERS
  // ============================================
  function setupAIListeners() {
    UIState.ai.on('available', (data) => {
      UIState.aiAvailable = true;
      updateAIStatus({ available: true, models: data.models });
    });

    UIState.ai.on('unavailable', (data) => {
      UIState.aiAvailable = false;
      updateAIStatus({ available: false, reason: data.reason });
    });

    UIState.ai.on('request', (data) => {
      log('AI request sent', 'info');
    });

    UIState.ai.on('response', (data) => {
      log(data.offline ? 'AI response (offline)' : 'AI response received', 
          data.offline ? 'warning' : 'success');
      updateAIResponse(data.response);
    });
  }

  // ============================================
  // UI EVENT LISTENERS
  // ============================================
  function setupUIListeners() {
    // Create Pulse button
    document.getElementById('create-pulse-btn')?.addEventListener('click', createPulse);

    // Execute Pulse button
    document.getElementById('execute-pulse-btn')?.addEventListener('click', executePulse);

    // Replay button
    document.getElementById('replay-btn')?.addEventListener('click', replayPulse);

    // Verify button
    document.getElementById('verify-btn')?.addEventListener('click', verifyPulse);

    // AI Analysis button
    document.getElementById('ai-analyze-btn')?.addEventListener('click', analyzeWithAI);

    // Clear button
    document.getElementById('clear-btn')?.addEventListener('click', clearAll);

    // Function selector change
    document.getElementById('function-select')?.addEventListener('change', updateInputPlaceholder);

    // Bounds sliders
    document.getElementById('max-steps')?.addEventListener('input', updateBoundsPreview);
    document.getElementById('max-memory')?.addEventListener('input', updateBoundsPreview);
    document.getElementById('max-branches')?.addEventListener('input', updateBoundsPreview);
    document.getElementById('max-time')?.addEventListener('input', updateBoundsPreview);

    // Initial bounds preview
    updateBoundsPreview();
    updateInputPlaceholder();
  }

  // ============================================
  // PULSE OPERATIONS
  // ============================================
  async function createPulse() {
    const funcName = document.getElementById('function-select')?.value || 'fibonacci';
    const inputText = document.getElementById('pulse-input')?.value || '{}';
    
    let input;
    try {
      input = JSON.parse(inputText);
    } catch (e) {
      log('Invalid JSON input', 'error');
      return;
    }

    const bounds = getBoundsFromUI();
    const functionCid = UIState.demoFunctions[funcName];

    if (!functionCid) {
      log('Function not found', 'error');
      return;
    }

    try {
      const pulse = await UIState.runtime.createPulse({
        input,
        functionCid,
        ...bounds,
        author: 'did:user:local'
      });

      UIState.currentPulse = pulse;
      updatePulseDisplay(pulse.toJSON());
      log('Pulse created', 'success');
      updateStatus('Pulse Created - Ready to Execute');
      
      // Enable execute button
      document.getElementById('execute-pulse-btn').disabled = false;
      
    } catch (e) {
      log(`Failed to create pulse: ${e.message}`, 'error');
    }
  }

  async function executePulse() {
    if (!UIState.currentPulse) {
      log('No pulse to execute', 'error');
      return;
    }

    UIState.executing = true;
    updateStatus('Executing...');
    clearTrace();

    try {
      const result = await UIState.runtime.execute(UIState.currentPulse);
      
      UIState.currentPulse = SESCore.Pulse.fromJSON(result.pulse);
      UIState.pulses.push(result.pulse);
      
      updatePulseDisplay(result.pulse);
      updateOutputDisplay(result.output);
      updatePulseList();
      
      // Update context
      await UIState.context.fromPulse(result.pulse, result.output);
      
      if (result.success) {
        log('Execution completed successfully', 'success');
        updateStatus('Completed');
      } else {
        log(`Execution failed: ${result.error?.message}`, 'error');
        updateStatus(`Failed: ${result.error?.reason || result.error?.message}`);
      }
      
      // Enable replay/verify buttons
      document.getElementById('replay-btn').disabled = false;
      document.getElementById('verify-btn').disabled = false;
      document.getElementById('ai-analyze-btn').disabled = false;
      
    } catch (e) {
      log(`Execution error: ${e.message}`, 'error');
      updateStatus('Error');
    } finally {
      UIState.executing = false;
    }
  }

  async function replayPulse() {
    if (!UIState.currentPulse) {
      log('No pulse to replay', 'error');
      return;
    }

    updateStatus('Replaying...');
    clearTrace();

    try {
      const pulseData = UIState.currentPulse.toJSON ? 
        UIState.currentPulse.toJSON() : UIState.currentPulse;
      
      const result = await UIState.runtime.replay(pulseData);
      
      updateReplayResult(result);
      
      if (result.valid) {
        log('Replay successful - results match!', 'success');
        updateStatus('Replay Verified ✓');
      } else {
        log('Replay mismatch detected', 'warning');
        updateStatus('Replay Mismatch!');
      }
      
    } catch (e) {
      log(`Replay error: ${e.message}`, 'error');
      updateStatus('Replay Error');
    }
  }

  async function verifyPulse() {
    if (!UIState.currentPulse) {
      log('No pulse to verify', 'error');
      return;
    }

    updateStatus('Verifying...');

    try {
      const pulseData = UIState.currentPulse.toJSON ? 
        UIState.currentPulse.toJSON() : UIState.currentPulse;
        
      const result = await UIState.runtime.verify(pulseData);
      
      updateVerifyResult(result);
      
      if (result.valid) {
        log('Verification passed - deterministic execution confirmed', 'success');
        updateStatus('Verified ✓');
      } else {
        log('Verification failed - non-deterministic behavior detected', 'error');
        updateStatus('Verification Failed!');
      }
      
    } catch (e) {
      log(`Verification error: ${e.message}`, 'error');
      updateStatus('Verification Error');
    }
  }

  async function analyzeWithAI() {
    if (!UIState.currentPulse) {
      log('No pulse to analyze', 'error');
      return;
    }

    const pulseData = UIState.currentPulse.toJSON ? 
      UIState.currentPulse.toJSON() : UIState.currentPulse;
    
    const output = pulseData.outputCid ? 
      await UIState.store.fetch(pulseData.outputCid) : null;

    updateStatus('AI Analyzing...');
    log('Sending to AI layer...', 'info');

    try {
      const response = await UIState.ai.analyzePulse(pulseData, output);
      
      updateAIResponse(response.toJSON());
      updateStatus(response.offline ? 'AI Analysis (Offline)' : 'AI Analysis Complete');
      
    } catch (e) {
      log(`AI analysis error: ${e.message}`, 'error');
      updateStatus('AI Analysis Error');
    }
  }

  // ============================================
  // UI UPDATE FUNCTIONS
  // ============================================
  function updateStatus(status) {
    const el = document.getElementById('status');
    if (el) el.textContent = status;
  }

  function updateAIStatus(status) {
    const el = document.getElementById('ai-status');
    if (el) {
      if (status.available) {
        el.innerHTML = `<span class="status-online">● Ollama Online</span> (${status.models?.length || 0} models)`;
      } else {
        el.innerHTML = `<span class="status-offline">○ Ollama Offline</span> <small>(${status.reason || 'System continues without AI'})</small>`;
      }
    }
  }

  function updateBoundsDisplay(data) {
    const usage = data.usage;
    const bounds = data.bounds;
    
    if (!usage || !bounds) return;

    // Update progress bars
    updateProgressBar('steps-progress', usage.steps, bounds.maxSteps);
    updateProgressBar('memory-progress', usage.memory, bounds.maxMemoryBytes);
    updateProgressBar('branch-progress', usage.branchDepth, bounds.maxBranchDepth);
    updateProgressBar('time-progress', usage.elapsed, bounds.maxExecutionMs);

    // Update text displays
    document.getElementById('steps-value').textContent = 
      `${usage.steps.toLocaleString()} / ${bounds.maxSteps.toLocaleString()}`;
    document.getElementById('memory-value').textContent = 
      `${formatBytes(usage.memory)} / ${formatBytes(bounds.maxMemoryBytes)}`;
    document.getElementById('branch-value').textContent = 
      `${usage.branchDepth} / ${bounds.maxBranchDepth}`;
    document.getElementById('time-value').textContent = 
      `${usage.elapsed}ms / ${bounds.maxExecutionMs}ms`;
  }

  function updateProgressBar(id, current, max) {
    const el = document.getElementById(id);
    if (!el) return;
    
    const percent = Math.min(100, (current / max) * 100);
    el.style.width = `${percent}%`;
    
    // Color based on usage
    if (percent >= 90) {
      el.className = 'progress-bar danger';
    } else if (percent >= 70) {
      el.className = 'progress-bar warning';
    } else {
      el.className = 'progress-bar';
    }
  }

  function updatePulseDisplay(pulse) {
    const el = document.getElementById('pulse-display');
    if (!el) return;

    el.innerHTML = `
      <div class="cid-display">
        <div class="cid-row">
          <span class="cid-label">Pulse ID:</span>
          <span class="cid-value" title="${pulse.pulseId || 'pending'}">${truncateCID(pulse.pulseId)}</span>
        </div>
        <div class="cid-row">
          <span class="cid-label">Input CID:</span>
          <span class="cid-value" title="${pulse.inputCid}">${truncateCID(pulse.inputCid)}</span>
        </div>
        <div class="cid-row">
          <span class="cid-label">Function CID:</span>
          <span class="cid-value" title="${pulse.functionCid}">${truncateCID(pulse.functionCid)}</span>
        </div>
        <div class="cid-row">
          <span class="cid-label">Output CID:</span>
          <span class="cid-value" title="${pulse.outputCid || 'pending'}">${truncateCID(pulse.outputCid)}</span>
        </div>
        <div class="cid-row">
          <span class="cid-label">Trace CID:</span>
          <span class="cid-value" title="${pulse.traceCid || 'pending'}">${truncateCID(pulse.traceCid)}</span>
        </div>
        <div class="cid-row">
          <span class="cid-label">Status:</span>
          <span class="status-badge status-${pulse.status}">${pulse.status}</span>
        </div>
      </div>
    `;
  }

  function updateOutputDisplay(output) {
    const el = document.getElementById('output-display');
    if (!el) return;

    el.innerHTML = `<pre>${JSON.stringify(output, null, 2)}</pre>`;
  }

  function addTraceStep(data) {
    const el = document.getElementById('trace-display');
    if (!el) return;

    const step = document.createElement('div');
    step.className = 'trace-step';
    step.innerHTML = `
      <span class="step-num">#${data.stepCount}</span>
      <span class="step-op">${data.operation}</span>
    `;
    el.appendChild(step);
    el.scrollTop = el.scrollHeight;
  }

  function clearTrace() {
    const el = document.getElementById('trace-display');
    if (el) el.innerHTML = '';
  }

  function updateReplayResult(result) {
    const el = document.getElementById('replay-result');
    if (!el) return;

    el.innerHTML = `
      <div class="replay-result ${result.valid ? 'valid' : 'invalid'}">
        <h4>${result.valid ? '✓ Replay Verified' : '✗ Replay Mismatch'}</h4>
        <div class="replay-detail">
          <span>Output Match:</span>
          <span>${result.outputMatch ? '✓' : '✗'}</span>
        </div>
        <div class="replay-detail">
          <span>Steps Match:</span>
          <span>${result.stepsMatch ? '✓' : '✗'} (${result.replaySteps} vs ${result.expectedSteps})</span>
        </div>
      </div>
    `;
  }

  function updateVerifyResult(result) {
    const el = document.getElementById('verify-result');
    if (!el) return;

    el.innerHTML = `
      <div class="verify-result ${result.valid ? 'valid' : 'invalid'}">
        <h4>${result.valid ? '✓ Determinism Verified' : '✗ Non-Deterministic'}</h4>
        <p>The execution is ${result.valid ? 'fully replayable' : 'NOT replayable'} from CIDs.</p>
      </div>
    `;
  }

  function updateAIResponse(response) {
    const el = document.getElementById('ai-response');
    if (!el) return;

    el.innerHTML = `
      <div class="ai-response ${response.offline ? 'offline' : ''}">
        <div class="ai-header">
          <span class="ai-model">${response.model}</span>
          ${response.offline ? '<span class="offline-badge">OFFLINE</span>' : ''}
        </div>
        <div class="ai-cids">
          <small>Request CID: ${truncateCID(response.requestCid)}</small>
          <small>Response CID: ${truncateCID(response.id)}</small>
        </div>
        <div class="ai-content">
          ${escapeHtml(response.response)}
        </div>
        ${response.error ? `<div class="ai-error">Note: ${response.error}</div>` : ''}
      </div>
    `;
  }

  function updatePulseList() {
    const el = document.getElementById('pulse-list');
    if (!el) return;

    el.innerHTML = UIState.pulses.slice(-10).reverse().map((pulse, i) => `
      <div class="pulse-item" data-index="${UIState.pulses.length - 1 - i}" onclick="SESUI.selectPulse(${UIState.pulses.length - 1 - i})">
        <span class="pulse-id">${truncateCID(pulse.pulseId)}</span>
        <span class="pulse-status status-${pulse.status}">${pulse.status}</span>
      </div>
    `).join('');
  }

  function updateBoundsPreview() {
    const bounds = getBoundsFromUI();
    
    document.getElementById('max-steps-label').textContent = bounds.maxSteps.toLocaleString();
    document.getElementById('max-memory-label').textContent = formatBytes(bounds.maxMemoryBytes);
    document.getElementById('max-branches-label').textContent = bounds.maxBranchDepth;
    document.getElementById('max-time-label').textContent = `${bounds.maxExecutionMs}ms`;
  }

  function updateInputPlaceholder() {
    const funcName = document.getElementById('function-select')?.value || 'fibonacci';
    const input = document.getElementById('pulse-input');
    if (!input) return;

    const placeholders = {
      fibonacci: '{"n": 15}',
      isPrime: '{"number": 97}',
      sortArray: '{"array": [5, 2, 8, 1, 9, 3]}',
      customCompute: '{"iterations": 100, "data": "test"}'
    };

    input.placeholder = placeholders[funcName] || '{}';
    input.value = placeholders[funcName] || '{}';
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  function getBoundsFromUI() {
    return {
      maxSteps: parseInt(document.getElementById('max-steps')?.value || '10000'),
      maxMemoryBytes: parseInt(document.getElementById('max-memory')?.value || '10485760'),
      maxBranchDepth: parseInt(document.getElementById('max-branches')?.value || '50'),
      maxExecutionMs: parseInt(document.getElementById('max-time')?.value || '10000')
    };
  }

  function truncateCID(cid) {
    if (!cid) return '(pending)';
    if (cid.length <= 24) return cid;
    return cid.slice(0, 12) + '...' + cid.slice(-8);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  function log(message, type = 'info') {
    const el = document.getElementById('log');
    if (!el) return;

    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `<span class="log-time">${new Date().toLocaleTimeString()}</span> ${message}`;
    el.appendChild(entry);
    el.scrollTop = el.scrollHeight;

    // Keep log bounded
    while (el.children.length > 100) {
      el.removeChild(el.firstChild);
    }
  }

  async function loadStoredPulses() {
    try {
      const cids = await UIState.store.list();
      for (const cid of cids.slice(-20)) {
        const data = await UIState.store.fetch(cid);
        if (data?.pulseId) {
          UIState.pulses.push(data);
        }
      }
      updatePulseList();
    } catch (e) {
      log('Error loading stored pulses', 'error');
    }
  }

  function selectPulse(index) {
    const pulse = UIState.pulses[index];
    if (!pulse) return;

    UIState.currentPulse = SESCore.Pulse.fromJSON(pulse);
    updatePulseDisplay(pulse);
    
    // Load output if available
    if (pulse.outputCid) {
      UIState.store.fetch(pulse.outputCid).then(output => {
        if (output) updateOutputDisplay(output);
      });
    }

    // Enable buttons
    document.getElementById('replay-btn').disabled = false;
    document.getElementById('verify-btn').disabled = false;
    document.getElementById('ai-analyze-btn').disabled = false;
    
    log(`Selected pulse: ${truncateCID(pulse.pulseId)}`, 'info');
  }

  async function clearAll() {
    if (confirm('Clear all stored data?')) {
      await UIState.store.clear();
      UIState.pulses = [];
      UIState.currentPulse = null;
      updatePulseList();
      document.getElementById('pulse-display').innerHTML = '';
      document.getElementById('output-display').innerHTML = '';
      document.getElementById('trace-display').innerHTML = '';
      document.getElementById('replay-result').innerHTML = '';
      document.getElementById('verify-result').innerHTML = '';
      document.getElementById('ai-response').innerHTML = '';
      log('All data cleared', 'info');
      updateStatus('Cleared');
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESUI = {
    init,
    createPulse,
    executePulse,
    replayPulse,
    verifyPulse,
    analyzeWithAI,
    selectPulse,
    clearAll,
    getState: () => UIState,
    log
  };

  global.SESUI = SESUI;

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(typeof window !== 'undefined' ? window : global);
