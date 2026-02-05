/**
 * SES-LAYER3-UI.JS - Layer 3 UI Integration
 * 
 * Bridges the frozen Layer 3 core (pulse-schema, content-store, dcx-runtime, index)
 * with the existing SES UI components.
 * 
 * @version 1.0.0
 */

(function() {
  'use strict';

  // ============================================
  // INITIALIZATION
  // ============================================
  
  let layer3Env = null;
  let contentStore = null;
  
  // Wait for DOM and all modules to load
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Check if Layer 3 modules are available
      if (typeof SESLayer3 === 'undefined') {
        console.error('SESLayer3 not loaded - ensure index.js is included');
        return;
      }

      // Initialize Layer 3 environment
      initializeLayer3();
      
      // Wire up new UI controls
      wireUpControls();
      
      // Update status displays
      updateLayer3Status();
      
      log('Layer 3 Core initialized successfully', 'success');
      
    } catch (error) {
      console.error('Failed to initialize Layer 3 UI:', error);
      log(`Layer 3 initialization error: ${error.message}`, 'error');
    }
  });

  // ============================================
  // LAYER 3 INITIALIZATION
  // ============================================
  
  function initializeLayer3() {
    // Create DCX environment with content store
    layer3Env = SESLayer3.createDCXEnvironment({
      author: 'did:web:localhost',
      store: {
        useAsync: true
      }
    });
    
    contentStore = layer3Env.store;
    
    // Expose globally for debugging and integration
    window.SESLayer3Env = layer3Env;
    window.SESContentStore = contentStore;
    
    log(`Layer 3 initialized - Schema v${SESLayer3.VERSION}`, 'info');
  }

  // ============================================
  // UI CONTROL WIRING
  // ============================================
  
  function wireUpControls() {
    // Validate Pulse Schema button
    const validateBtn = document.getElementById('validate-pulse-btn');
    if (validateBtn) {
      validateBtn.addEventListener('click', handleValidatePulse);
    }

    // Inspect CID Store button
    const inspectBtn = document.getElementById('inspect-cid-btn');
    if (inspectBtn) {
      inspectBtn.addEventListener('click', handleInspectStore);
    }

    // Export Store button
    const exportBtn = document.getElementById('export-store-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', handleExportStore);
    }

    // Import Store button
    const importBtn = document.getElementById('import-store-btn');
    if (importBtn) {
      importBtn.addEventListener('click', handleImportStore);
    }

    // File input for import
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) {
      fileInput.addEventListener('change', handleFileSelected);
    }
  }

  // ============================================
  // EVENT HANDLERS
  // ============================================
  
  async function handleValidatePulse() {
    try {
      // Get current pulse from the UI (assumes window.currentPulse exists)
      const currentPulse = window.currentPulse;
      
      if (!currentPulse) {
        log('No pulse to validate - create a pulse first', 'warning');
        return;
      }

      // Validate using Layer 3 schema
      const validation = SESLayer3.validatePulse(currentPulse);
      
      // Display results
      const validationDisplay = document.getElementById('validation-display');
      if (validationDisplay) {
        if (validation.valid) {
          validationDisplay.innerHTML = `
            <div class="validation-success">
              <p><strong>✓ Pulse is valid</strong></p>
              <p>Conforms to SES Layer 3 Schema v${SESLayer3.VERSION}</p>
            </div>
          `;
          log('Pulse validation: PASSED', 'success');
        } else {
          validationDisplay.innerHTML = `
            <div class="validation-error">
              <p><strong>✗ Pulse validation failed</strong></p>
              <ul>
                ${validation.errors.map(err => `<li>${err}</li>`).join('')}
              </ul>
            </div>
          `;
          log(`Pulse validation: FAILED - ${validation.errors.length} errors`, 'error');
        }
      }
      
    } catch (error) {
      log(`Validation error: ${error.message}`, 'error');
    }
  }

  async function handleInspectStore() {
    try {
      if (!contentStore) {
        log('Content store not initialized', 'error');
        return;
      }

      // Get store statistics
      const keys = contentStore.keys();
      const size = contentStore.size();
      
      // Display store stats
      const statsDiv = document.getElementById('store-stats');
      if (statsDiv) {
        statsDiv.innerHTML = `
          <div class="store-stats-content">
            <p><strong>Content Store Statistics</strong></p>
            <p>Total Items: ${size}</p>
            <p>Storage Type: ${contentStore._useAsync ? 'SHA-256 (async)' : 'djb2 (sync)'}</p>
          </div>
        `;
      }

      // Display recent CIDs
      const contentsDiv = document.getElementById('store-contents');
      if (contentsDiv) {
        const recentKeys = keys.slice(-10).reverse();
        
        contentsDiv.innerHTML = `
          <div class="store-contents-list">
            <p><strong>Recent CIDs (last 10):</strong></p>
            <ul>
              ${recentKeys.map(cid => {
                const shortCid = cid.substring(0, 40) + '...';
                return `<li><code class="cid-display" title="${cid}">${shortCid}</code></li>`;
              }).join('')}
            </ul>
          </div>
        `;
      }

      log(`Content store inspection complete - ${size} items`, 'info');
      
    } catch (error) {
      log(`Store inspection error: ${error.message}`, 'error');
    }
  }

  async function handleExportStore() {
    try {
      if (!contentStore) {
        log('Content store not initialized', 'error');
        return;
      }

      // Export store contents
      const exported = contentStore.export();
      
      // Create downloadable JSON
      const blob = new Blob([JSON.stringify(exported, null, 2)], { 
        type: 'application/json' 
      });
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ses-content-store-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      log(`Content store exported - ${Object.keys(exported).length} items`, 'success');
      
    } catch (error) {
      log(`Export error: ${error.message}`, 'error');
    }
  }

  function handleImportStore() {
    const fileInput = document.getElementById('import-file-input');
    if (fileInput) {
      fileInput.click();
    }
  }

  async function handleFileSelected(event) {
    try {
      const file = event.target.files[0];
      if (!file) return;

      const text = await file.text();
      const imported = JSON.parse(text);
      
      if (!contentStore) {
        log('Content store not initialized', 'error');
        return;
      }

      // Import into store
      contentStore.import(imported);
      
      log(`Content store imported - ${Object.keys(imported).length} items`, 'success');
      
      // Update displays
      updateLayer3Status();
      handleInspectStore();
      
      // Clear file input
      event.target.value = '';
      
    } catch (error) {
      log(`Import error: ${error.message}`, 'error');
    }
  }

  // ============================================
  // STATUS UPDATES
  // ============================================
  
  function updateLayer3Status() {
    // Update schema version
    const schemaVersion = document.getElementById('schema-version');
    if (schemaVersion) {
      schemaVersion.textContent = SESLayer3.VERSION;
    }

    // Update store size
    const storeSize = document.getElementById('store-size');
    if (storeSize && contentStore) {
      storeSize.textContent = contentStore.size();
    }

    // Update runtime status
    const runtimeStatus = document.getElementById('runtime-status');
    if (runtimeStatus && layer3Env) {
      runtimeStatus.textContent = 'Active';
      runtimeStatus.style.color = '#4CAF50';
    }
  }

  // ============================================
  // INTEGRATION WITH EXISTING UI
  // ============================================
  
  // Intercept pulse creation to use Layer 3 runtime
  window.addEventListener('pulse-created', async (event) => {
    if (layer3Env && event.detail) {
      try {
        // Validate the pulse
        const validation = SESLayer3.validatePulse(event.detail.pulse);
        if (!validation.valid) {
          log(`Warning: Pulse does not conform to Layer 3 schema`, 'warning');
          console.warn('Pulse validation errors:', validation.errors);
        }
        
        updateLayer3Status();
      } catch (error) {
        console.error('Layer 3 pulse validation error:', error);
      }
    }
  });

  // Intercept pulse execution to track in content store
  window.addEventListener('pulse-executed', async (event) => {
    if (contentStore && event.detail) {
      try {
        updateLayer3Status();
      } catch (error) {
        console.error('Layer 3 execution tracking error:', error);
      }
    }
  });

  // ============================================
  // UTILITY FUNCTIONS
  // ============================================
  
  function log(message, level = 'info') {
    // Use existing log function if available
    if (typeof window.log === 'function') {
      window.log(message, level);
    } else {
      console.log(`[Layer 3 ${level.toUpperCase()}] ${message}`);
    }
  }

  // ============================================
  // EXPOSE API
  // ============================================
  
  window.SESLayer3UI = {
    getEnvironment: () => layer3Env,
    getContentStore: () => contentStore,
    validatePulse: handleValidatePulse,
    inspectStore: handleInspectStore,
    exportStore: handleExportStore,
    updateStatus: updateLayer3Status
  };

})();
