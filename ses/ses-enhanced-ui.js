/**
 * SES-ENHANCED-UI.JS - Enhanced UI for Layer 3/4 Features
 * 
 * Integrates:
 * - Trace Analyzer
 * - Symbolic Codec
 * - Proof of Execution
 * - Claims System
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // STATE
  // ============================================
  const EnhancedState = {
    traceAnalyzer: null,
    symbolicCodec: null,
    proofOfExecution: null,
    claimEngine: null,
    currentClaim: null,
    initialized: false
  };

  // ============================================
  // INITIALIZATION
  // ============================================
  async function init() {
    if (EnhancedState.initialized) return;

    try {
      // Wait for other modules to load
      await waitForModules();

      // Initialize Trace Analyzer
      if (typeof TraceAnalyzerModule !== 'undefined') {
        EnhancedState.traceAnalyzer = TraceAnalyzerModule.create();
        log('Trace Analyzer initialized', 'success');
      }

      // Initialize Symbolic Codec
      if (typeof SymbolicCodecModule !== 'undefined') {
        EnhancedState.symbolicCodec = SymbolicCodecModule.create();
        log('Symbolic Codec initialized', 'success');
      }

      // Initialize Proof of Execution
      if (typeof SESProofOfExecution !== 'undefined' && global.SESUI?.getState()?.store) {
        EnhancedState.proofOfExecution = SESProofOfExecution.create(global.SESUI.getState().store);
        log('Proof of Execution initialized', 'success');
      }

      // Initialize Claims Engine
      if (typeof SESClaims !== 'undefined' && global.SESUI?.getState()?.store) {
        const state = global.SESUI.getState();
        EnhancedState.claimEngine = SESClaims.createEngine(state.store, state.identity);
        
        // Listen for claim events
        EnhancedState.claimEngine.on((event, data) => {
          if (event === 'claimCreated') {
            log(`Claim created: ${truncateCID(data.claim.claimId)}`, 'success');
            updateClaimsDisplay();
          } else if (event === 'attestationCreated') {
            log(`Attestation added: ${data.attestation.verdict}`, 'info');
            updateClaimsDisplay();
          }
        });
        
        log('Claims Engine initialized', 'success');
      }

      // Wire up UI
      wireUpUI();

      EnhancedState.initialized = true;
      log('Enhanced UI initialized', 'success');

    } catch (error) {
      console.error('Enhanced UI init error:', error);
      log('Enhanced UI init error: ' + error.message, 'error');
    }
  }

  function waitForModules() {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        if (global.SESUI && global.SESUI.getState) {
          resolve();
        } else if (attempts < 50) {
          setTimeout(check, 100);
        } else {
          resolve(); // Give up after 5 seconds
        }
      };
      check();
    });
  }

  // ============================================
  // UI WIRING
  // ============================================
  function wireUpUI() {
    // Trace Analysis buttons
    const analyzeTraceBtn = document.getElementById('analyze-trace-btn');
    if (analyzeTraceBtn) {
      analyzeTraceBtn.addEventListener('click', handleAnalyzeTrace);
    }

    const detectAnomaliesBtn = document.getElementById('detect-anomalies-btn');
    if (detectAnomaliesBtn) {
      detectAnomaliesBtn.addEventListener('click', handleDetectAnomalies);
    }

    const generateProofBtn = document.getElementById('generate-proof-btn');
    if (generateProofBtn) {
      generateProofBtn.addEventListener('click', handleGenerateProof);
    }

    // Claims buttons
    const createClaimBtn = document.getElementById('create-claim-btn');
    if (createClaimBtn) {
      createClaimBtn.addEventListener('click', handleCreateClaim);
    }

    const attestClaimBtn = document.getElementById('attest-claim-btn');
    if (attestClaimBtn) {
      attestClaimBtn.addEventListener('click', handleAttestClaim);
    }

    const viewConsensusBtn = document.getElementById('view-consensus-btn');
    if (viewConsensusBtn) {
      viewConsensusBtn.addEventListener('click', handleViewConsensus);
    }

    // Listen for pulse execution to enable buttons
    if (global.SESUI?.getState()?.runtime) {
      global.SESUI.getState().runtime.on('complete', enableAnalysisButtons);
    }
  }

  function enableAnalysisButtons() {
    const buttons = ['analyze-trace-btn', 'detect-anomalies-btn', 'generate-proof-btn', 'create-claim-btn'];
    buttons.forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.disabled = false;
    });
  }

  // ============================================
  // TRACE ANALYSIS HANDLERS
  // ============================================
  async function handleAnalyzeTrace() {
    if (!EnhancedState.traceAnalyzer) {
      log('Trace Analyzer not initialized', 'error');
      return;
    }

    const state = global.SESUI?.getState();
    if (!state?.currentPulse) {
      log('No pulse to analyze', 'error');
      return;
    }

    try {
      const pulse = state.currentPulse.toJSON ? state.currentPulse.toJSON() : state.currentPulse;
      const trace = pulse.traceCid ? await state.store.fetch(pulse.traceCid) : null;

      if (!trace) {
        log('No trace available for analysis', 'error');
        return;
      }

      const analysis = EnhancedState.traceAnalyzer.analyze(pulse, trace);
      displayTraceAnalysis(analysis);
      log('Trace analysis complete', 'success');

    } catch (error) {
      log('Analysis error: ' + error.message, 'error');
    }
  }

  async function handleDetectAnomalies() {
    if (!EnhancedState.traceAnalyzer) {
      log('Trace Analyzer not initialized', 'error');
      return;
    }

    const state = global.SESUI?.getState();
    if (!state?.currentPulse) {
      log('No pulse to analyze', 'error');
      return;
    }

    try {
      const pulse = state.currentPulse.toJSON ? state.currentPulse.toJSON() : state.currentPulse;
      const trace = pulse.traceCid ? await state.store.fetch(pulse.traceCid) : null;

      if (!trace) {
        log('No trace available', 'error');
        return;
      }

      const anomalies = EnhancedState.traceAnalyzer.detectAnomalies(trace);
      displayAnomalies(anomalies);

    } catch (error) {
      log('Anomaly detection error: ' + error.message, 'error');
    }
  }

  async function handleGenerateProof() {
    if (!EnhancedState.proofOfExecution) {
      log('Proof of Execution not initialized', 'error');
      return;
    }

    const state = global.SESUI?.getState();
    if (!state?.currentPulse) {
      log('No pulse for proof', 'error');
      return;
    }

    try {
      const pulse = state.currentPulse.toJSON ? state.currentPulse.toJSON() : state.currentPulse;
      const trace = pulse.traceCid ? await state.store.fetch(pulse.traceCid) : null;

      if (!trace) {
        log('No trace available', 'error');
        return;
      }

      const proof = await EnhancedState.proofOfExecution.generateProof(pulse, trace);
      displayProof(proof);
      log(`Proof generated: ${truncateCID(proof.proofId)}`, 'success');

    } catch (error) {
      log('Proof generation error: ' + error.message, 'error');
    }
  }

  // ============================================
  // CLAIMS HANDLERS
  // ============================================
  async function handleCreateClaim() {
    if (!EnhancedState.claimEngine) {
      log('Claims Engine not initialized', 'error');
      return;
    }

    const state = global.SESUI?.getState();
    if (!state?.currentPulse) {
      log('No pulse to create claim about', 'error');
      return;
    }

    try {
      const pulse = state.currentPulse.toJSON ? state.currentPulse.toJSON() : state.currentPulse;
      
      // Create a claim that the pulse output is valid
      const claim = await EnhancedState.claimEngine.createClaim(
        pulse.outputCid || pulse.pulseId,
        SESClaims.PREDICATES.VALID,
        {
          confidence: 0.8,
          evidenceCids: [pulse.traceCid].filter(Boolean),
          metadata: {
            pulseId: pulse.pulseId,
            status: pulse.status
          }
        }
      );

      EnhancedState.currentClaim = claim;
      updateClaimsDisplay();

      // Enable attest and consensus buttons
      document.getElementById('attest-claim-btn').disabled = false;
      document.getElementById('view-consensus-btn').disabled = false;

    } catch (error) {
      log('Claim creation error: ' + error.message, 'error');
    }
  }

  async function handleAttestClaim() {
    if (!EnhancedState.claimEngine || !EnhancedState.currentClaim) {
      log('No claim to attest', 'error');
      return;
    }

    try {
      // Attest to accept the claim
      await EnhancedState.claimEngine.attestClaim(
        EnhancedState.currentClaim.claimId,
        SESClaims.VERDICTS.ACCEPT,
        {
          confidence: 0.9,
          reasoning: 'Verified execution through trace analysis'
        }
      );

      updateClaimsDisplay();

    } catch (error) {
      log('Attestation error: ' + error.message, 'error');
    }
  }

  async function handleViewConsensus() {
    if (!EnhancedState.claimEngine || !EnhancedState.currentClaim) {
      log('No claim to view consensus', 'error');
      return;
    }

    try {
      const consensus = await EnhancedState.claimEngine.calculateConsensus(
        EnhancedState.currentClaim.claimId
      );
      displayConsensus(consensus);

    } catch (error) {
      log('Consensus error: ' + error.message, 'error');
    }
  }

  // ============================================
  // DISPLAY FUNCTIONS
  // ============================================
  function displayTraceAnalysis(analysis) {
    const el = document.getElementById('trace-analysis-result');
    if (!el) return;

    const efficiency = analysis.efficiency;
    const gradeColor = {
      'A': '#00d4aa', 'B': '#88cc00', 'C': '#ffaa00', 'D': '#ff8800', 'F': '#ff4466'
    }[efficiency.grade] || '#666';

    el.innerHTML = `
      <div class="analysis-result">
        <div class="analysis-header">
          <span class="efficiency-grade" style="color: ${gradeColor}">Grade: ${efficiency.grade}</span>
          <span class="efficiency-score">Score: ${efficiency.overallScore.toFixed(1)}</span>
        </div>
        <div class="analysis-metrics">
          <div class="metric">
            <span class="metric-label">Steps</span>
            <div class="metric-bar">
              <div class="metric-fill" style="width: ${Math.min(100, efficiency.stepEfficiency)}%"></div>
            </div>
            <span class="metric-value">${efficiency.stepEfficiency.toFixed(1)}%</span>
          </div>
          <div class="metric">
            <span class="metric-label">Memory</span>
            <div class="metric-bar">
              <div class="metric-fill" style="width: ${Math.min(100, efficiency.memoryEfficiency)}%"></div>
            </div>
            <span class="metric-value">${efficiency.memoryEfficiency.toFixed(1)}%</span>
          </div>
          <div class="metric">
            <span class="metric-label">Branches</span>
            <div class="metric-bar">
              <div class="metric-fill" style="width: ${Math.min(100, efficiency.branchEfficiency)}%"></div>
            </div>
            <span class="metric-value">${efficiency.branchEfficiency.toFixed(1)}%</span>
          </div>
        </div>
        ${efficiency.recommendations.length > 0 ? `
          <div class="recommendations">
            <strong>Recommendations:</strong>
            <ul>
              ${efficiency.recommendations.map(r => `
                <li class="recommendation-${r.severity}">${r.message}</li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  function displayAnomalies(anomalies) {
    const el = document.getElementById('trace-analysis-result');
    if (!el) return;

    if (anomalies.length === 0) {
      el.innerHTML = `
        <div class="analysis-result success">
          <p>✓ No anomalies detected</p>
          <p class="detail">Execution appears deterministic and well-behaved.</p>
        </div>
      `;
      return;
    }

    el.innerHTML = `
      <div class="analysis-result warning">
        <p>⚠ ${anomalies.length} anomalies detected</p>
        <ul class="anomaly-list">
          ${anomalies.map(a => `
            <li class="anomaly-${a.severity}">
              <strong>${a.type}</strong>
              ${a.tick !== undefined ? ` at tick ${a.tick}` : ''}
              <span class="severity-badge">${a.severity}</span>
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  function displayProof(proof) {
    const el = document.getElementById('trace-analysis-result');
    if (!el) return;

    el.innerHTML = `
      <div class="analysis-result">
        <h4>Proof of Execution Generated</h4>
        <div class="proof-details">
          <div class="proof-row">
            <span>Proof ID:</span>
            <code>${truncateCID(proof.proofId)}</code>
          </div>
          <div class="proof-row">
            <span>Input Commitment:</span>
            <code>${truncateCID(proof.inputCommitment)}</code>
          </div>
          <div class="proof-row">
            <span>Output Commitment:</span>
            <code>${truncateCID(proof.outputCommitment)}</code>
          </div>
          <div class="proof-row">
            <span>Merkle Root:</span>
            <code>${truncateCID(proof.traceMerkleRoot)}</code>
          </div>
          <div class="proof-row">
            <span>Steps:</span>
            <span>${proof.executionSummary.totalSteps}</span>
          </div>
          <div class="proof-row">
            <span>Bounds Respected:</span>
            <span class="${proof.verificationData.boundsRespected ? 'valid' : 'invalid'}">
              ${proof.verificationData.boundsRespected ? '✓' : '✗'}
            </span>
          </div>
        </div>
      </div>
    `;
  }

  function updateClaimsDisplay() {
    const el = document.getElementById('claims-display');
    if (!el || !EnhancedState.claimEngine) return;

    const stats = EnhancedState.claimEngine.getStats();
    const claims = EnhancedState.claimEngine.listClaims().slice(-5);

    el.innerHTML = `
      <div class="claims-stats">
        <span>Claims: ${stats.totalClaims}</span>
        <span>Attestations: ${stats.totalAttestations}</span>
        <span>Agents: ${stats.uniqueAgents}</span>
      </div>
      ${claims.length > 0 ? `
        <div class="claims-list">
          ${claims.reverse().map(c => `
            <div class="claim-item ${EnhancedState.currentClaim?.claimId === c.claimId ? 'selected' : ''}"
                 onclick="SESEnhancedUI.selectClaim('${c.claimId}')">
              <div class="claim-header">
                <code>${truncateCID(c.claimId)}</code>
                <span class="claim-predicate">${c.predicate}</span>
              </div>
              <div class="claim-meta">
                Confidence: ${(c.confidence * 100).toFixed(0)}%
              </div>
            </div>
          `).join('')}
        </div>
      ` : '<p class="placeholder">No claims yet</p>'}
    `;
  }

  function displayConsensus(consensus) {
    const el = document.getElementById('claims-display');
    if (!el) return;

    const verdictColors = {
      'accept': '#00d4aa',
      'reject': '#ff4466',
      'abstain': '#666'
    };

    el.innerHTML = `
      <div class="consensus-result">
        <h4>Consensus: <span style="color: ${verdictColors[consensus.consensus]}">${consensus.consensus?.toUpperCase() || 'NONE'}</span></h4>
        <div class="consensus-scores">
          <div class="score-bar">
            <span>Accept</span>
            <div class="score-fill accept" style="width: ${(consensus.acceptScore || 0) * 100}%"></div>
            <span>${((consensus.acceptScore || 0) * 100).toFixed(1)}%</span>
          </div>
          <div class="score-bar">
            <span>Reject</span>
            <div class="score-fill reject" style="width: ${(consensus.rejectScore || 0) * 100}%"></div>
            <span>${((consensus.rejectScore || 0) * 100).toFixed(1)}%</span>
          </div>
        </div>
        <div class="consensus-meta">
          <span>Total Attestations: ${consensus.totalAttestations}</span>
          <span>Total Weight: ${consensus.totalWeight?.toFixed(2) || 0}</span>
        </div>
      </div>
    `;
  }

  // ============================================
  // UTILITIES
  // ============================================
  function truncateCID(cid) {
    if (!cid) return '(none)';
    if (cid.length <= 24) return cid;
    return cid.slice(0, 12) + '...' + cid.slice(-8);
  }

  function log(message, type = 'info') {
    if (typeof global.SESUI?.log === 'function') {
      global.SESUI.log(message, type);
    } else {
      console.log(`[Enhanced UI ${type.toUpperCase()}] ${message}`);
    }
  }

  function selectClaim(claimId) {
    if (EnhancedState.claimEngine) {
      EnhancedState.claimEngine.getClaim(claimId).then(claim => {
        if (claim) {
          EnhancedState.currentClaim = claim;
          updateClaimsDisplay();
          document.getElementById('attest-claim-btn').disabled = false;
          document.getElementById('view-consensus-btn').disabled = false;
        }
      });
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESEnhancedUI = {
    init,
    getState: () => EnhancedState,
    selectClaim,
    handleAnalyzeTrace,
    handleDetectAnomalies,
    handleGenerateProof,
    handleCreateClaim,
    handleAttestClaim,
    handleViewConsensus
  };

  global.SESEnhancedUI = SESEnhancedUI;

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 500));
  } else {
    setTimeout(init, 500);
  }

})(typeof window !== 'undefined' ? window : global);
