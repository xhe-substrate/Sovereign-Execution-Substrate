/**
 * SES Identity & Network UI Integration (Browser-Safe Vanilla JS)
 * 
 * Adds identity management and content-addressed networking to the SES UI.
 * Integrates with existing ses-ui.js and ses-layer3-ui.js
 */

(function(global) {
  'use strict';

  /**
   * Identity UI Manager
   */
  class IdentityUI {
    constructor() {
      this.registry = new IdentityRegistry();
      this.currentIdentity = null;
    }

    async init() {
      // Try to load existing identities
      const loaded = await this.registry.loadFromStorage();
      
      if (loaded) {
        this.currentIdentity = this.registry.getDefault();
        console.log('✅ Loaded identity:', this.currentIdentity.did);
      } else {
        // Generate new identity
        console.log('Generating new identity...');
        this.currentIdentity = await SESIdentity.generate();
        this.registry.register(this.currentIdentity, true);
        await this.registry.saveToStorage();
        console.log('✅ Created new identity:', this.currentIdentity.did);
      }

      this.renderIdentityInfo();
    }

    renderIdentityInfo() {
      // Add identity display to header if not exists
      let identityDisplay = document.getElementById('identity-display');
      if (!identityDisplay) {
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
          identityDisplay = document.createElement('div');
          identityDisplay.id = 'identity-display';
          identityDisplay.className = 'identity-display';
          headerRight.insertBefore(identityDisplay, headerRight.firstChild);
        }
      }

      if (identityDisplay && this.currentIdentity) {
        const shortDID = this.currentIdentity.did.substring(0, 20) + '...';
        identityDisplay.innerHTML = `
          <div class="identity-badge" title="${this.currentIdentity.did}">
            <span class="identity-icon">🔑</span>
            <span class="identity-did">${shortDID}</span>
          </div>
        `;
      }
    }

    async signPulse(pulse) {
      if (!this.currentIdentity) {
        throw new Error('No identity available');
      }
      return await this.currentIdentity.signObject(pulse);
    }

    async verifyPulse(signedPulse) {
      return await SESIdentity.verifyObject(signedPulse);
    }
  }

  /**
   * Network UI Manager
   */
  class NetworkUI {
    constructor() {
      this.network = new SESNetwork();
      this.initialized = false;
    }

    async init() {
      await this.network.init();
      this.initialized = true;
      console.log('✅ Network initialized');
      
      this.renderNetworkStats();
      
      // Update stats periodically
      setInterval(() => this.renderNetworkStats(), 5000);
    }

    async renderNetworkStats() {
      const stats = await this.network.getStats();
      
      // Update store size in Layer 3 status
      const storeSizeEl = document.getElementById('store-size');
      if (storeSizeEl) {
        storeSizeEl.textContent = `${stats.totalItems} (${stats.totalSizeMB} MB)`;
      }

      // Update network status badge
      let networkStatus = document.getElementById('network-status');
      if (!networkStatus) {
        const headerRight = document.querySelector('.header-right');
        if (headerRight) {
          networkStatus = document.createElement('div');
          networkStatus.id = 'network-status';
          networkStatus.className = 'network-status';
          headerRight.appendChild(networkStatus);
        }
      }

      if (networkStatus) {
        networkStatus.innerHTML = `
          <div class="status-badge status-online" title="Network Stats">
            <span>📦 ${stats.totalItems} items</span>
            <span class="status-detail">${stats.totalSizeMB} MB</span>
          </div>
        `;
      }
    }

    async storePulse(pulse) {
      return await this.network.storePulse(pulse);
    }

    async fetchPulse(cid) {
      return await this.network.fetchPulse(cid);
    }

    async exportNetwork() {
      return await this.network.export();
    }

    async importNetwork(data) {
      await this.network.import(data);
      await this.renderNetworkStats();
    }
  }

  /**
   * Integrated SES Stack UI
   */
  class SESStackUI {
    constructor() {
      this.identityUI = new IdentityUI();
      this.networkUI = new NetworkUI();
    }

    async init() {
      console.log('Initializing SES Stack UI...');
      
      await this.identityUI.init();
      await this.networkUI.init();
      
      this.setupEventListeners();
      
      console.log('✅ SES Stack UI initialized');
    }

    setupEventListeners() {
      // Enhance existing create pulse button
      const createPulseBtn = document.getElementById('create-pulse-btn');
      if (createPulseBtn) {
        createPulseBtn.addEventListener('click', async () => {
          await this.handleCreateSignedPulse();
        });
      }

      // Add export/import handlers
      const exportBtn = document.getElementById('export-store-btn');
      if (exportBtn) {
        exportBtn.addEventListener('click', () => this.handleExportNetwork());
      }

      const importBtn = document.getElementById('import-store-btn');
      if (importBtn) {
        importBtn.addEventListener('click', () => this.handleImportNetwork());
      }

      // Add network inspector
      this.setupNetworkInspector();
    }

    async handleCreateSignedPulse() {
      try {
        // Get pulse data from UI (assumes global SES object exists)
        if (!window.SES || !window.SES.currentPulse) {
          console.log('No pulse to sign yet');
          return;
        }

        const pulse = window.SES.currentPulse;
        
        // Sign the pulse
        const signedPulse = await this.identityUI.signPulse(pulse);
        console.log('✅ Pulse signed');
        
        // Store in network
        const cid = await this.networkUI.storePulse(signedPulse);
        console.log('✅ Pulse stored:', cid);
        
        // Update pulse with CID
        signedPulse.cid = cid;
        
        // Store signed pulse back to SES
        if (window.SES) {
          window.SES.currentPulse = signedPulse;
        }
        
        this.logToUI(`Signed and stored pulse: ${cid}`);
        
      } catch (error) {
        console.error('Failed to create signed pulse:', error);
        this.logToUI(`Error: ${error.message}`, 'error');
      }
    }

    async handleExportNetwork() {
      try {
        const exported = await this.networkUI.exportNetwork();
        const blob = new Blob([JSON.stringify(exported, null, 2)], 
                             { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ses-network-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.logToUI('Network exported successfully');
      } catch (error) {
        console.error('Export failed:', error);
        this.logToUI(`Export error: ${error.message}`, 'error');
      }
    }

    handleImportNetwork() {
      const input = document.getElementById('import-file-input');
      if (!input) return;

      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
          const text = await file.text();
          const data = JSON.parse(text);
          await this.networkUI.importNetwork(data);
          this.logToUI('Network imported successfully');
        } catch (error) {
          console.error('Import failed:', error);
          this.logToUI(`Import error: ${error.message}`, 'error');
        }
      };

      input.click();
    }

    setupNetworkInspector() {
      const inspectorBtn = document.getElementById('inspect-cid-btn');
      if (inspectorBtn) {
        inspectorBtn.addEventListener('click', async () => {
          await this.showNetworkInspector();
        });
      }
    }

    async showNetworkInspector() {
      const storeInspector = document.getElementById('store-inspector');
      if (!storeInspector) return;

      const cids = await this.networkUI.network.list();
      const pins = await this.networkUI.network.listPins();
      const stats = await this.networkUI.network.getStats();

      let html = `
        <div class="store-stats">
          <h4>Network Statistics</h4>
          <p>Total Items: ${stats.totalItems}</p>
          <p>Total Size: ${stats.totalSizeMB} MB</p>
          <p>Pinned Items: ${stats.pinnedItems}</p>
          <p>Cached Objects: ${stats.cachedObjects}</p>
        </div>
        <div class="store-contents">
          <h4>Content (${cids.length} items)</h4>
          <ul class="cid-list">
      `;

      for (const cid of cids.slice(0, 20)) { // Show first 20
        const isPinned = pins.includes(cid);
        const shortCID = cid.substring(0, 40) + '...';
        html += `
          <li class="cid-item ${isPinned ? 'pinned' : ''}">
            <span class="cid-hash" title="${cid}">${shortCID}</span>
            ${isPinned ? '<span class="pin-badge">📌</span>' : ''}
          </li>
        `;
      }

      if (cids.length > 20) {
        html += `<li class="cid-item">... and ${cids.length - 20} more</li>`;
      }

      html += `</ul></div>`;

      storeInspector.innerHTML = html;
    }

    logToUI(message, type = 'info') {
      const log = document.getElementById('log');
      if (!log) return;

      const entry = document.createElement('div');
      entry.className = `log-entry log-${type}`;
      entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
      log.appendChild(entry);
      log.scrollTop = log.scrollHeight;
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSESStack);
  } else {
    initSESStack();
  }

  async function initSESStack() {
    try {
      // Wait a bit for other modules to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const stackUI = new SESStackUI();
      await stackUI.init();
      
      // Export to global for access
      global.SESStackUI = stackUI;
      
    } catch (error) {
      console.error('Failed to initialize SES Stack UI:', error);
    }
  }

  // Export classes
  global.IdentityUI = IdentityUI;
  global.NetworkUI = NetworkUI;
  global.SESStackUI = SESStackUI;

  console.log('✅ SES Stack UI module loaded');

})(typeof window !== 'undefined' ? window : this);
