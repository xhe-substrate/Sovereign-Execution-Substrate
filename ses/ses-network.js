/**
 * SES Network Module (Browser-Safe Vanilla JS)
 * 
 * Content-addressed storage and networking.
 * Uses IndexedDB for persistence, no external dependencies.
 * 
 * Core Properties:
 * - Content-addressable storage (CID-based)
 * - Browser-native IndexedDB persistence
 * - Offline-first design
 * - Pin management
 * - Pure vanilla JavaScript
 */

(function(global) {
  'use strict';

  /**
   * Simple CID generator using SHA-256
   * Format: ses:<base64url-hash>
   */
  class CIDGenerator {
    static async generate(bytes) {
      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return `ses:${hashHex}`;
    }

    static async generateFromString(str) {
      const bytes = new TextEncoder().encode(str);
      return await CIDGenerator.generate(bytes);
    }
  }

  /**
   * IndexedDB Storage Backend
   */
  class IndexedDBStore {
    constructor(dbName = 'ses-network') {
      this.dbName = dbName;
      this.db = null;
    }

    async init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, 1);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
          resolve(true);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;

          // Content store
          if (!db.objectStoreNames.contains('content')) {
            const contentStore = db.createObjectStore('content', { keyPath: 'cid' });
            contentStore.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // Pins store
          if (!db.objectStoreNames.contains('pins')) {
            db.createObjectStore('pins', { keyPath: 'cid' });
          }
        };
      });
    }

    async store(cid, bytes, metadata = {}) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['content'], 'readwrite');
        const store = transaction.objectStore('content');

        const record = {
          cid,
          bytes: Array.from(new Uint8Array(bytes)), // Store as array for IndexedDB
          timestamp: Date.now(),
          size: bytes.byteLength,
          ...metadata
        };

        const request = store.put(record);
        request.onsuccess = () => resolve(cid);
        request.onerror = () => reject(request.error);
      });
    }

    async fetch(cid) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['content'], 'readonly');
        const store = transaction.objectStore('content');
        const request = store.get(cid);

        request.onsuccess = () => {
          if (request.result) {
            // Convert array back to Uint8Array
            const bytes = new Uint8Array(request.result.bytes);
            resolve(bytes.buffer);
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    async has(cid) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['content'], 'readonly');
        const store = transaction.objectStore('content');
        const request = store.get(cid);

        request.onsuccess = () => resolve(!!request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async pin(cid) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['pins'], 'readwrite');
        const store = transaction.objectStore('pins');
        const request = store.put({ cid, timestamp: Date.now() });

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    async unpin(cid) {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['pins'], 'readwrite');
        const store = transaction.objectStore('pins');
        const request = store.delete(cid);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      });
    }

    async listPins() {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['pins'], 'readonly');
        const store = transaction.objectStore('pins');
        const request = store.getAllKeys();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async list() {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['content'], 'readonly');
        const store = transaction.objectStore('content');
        const request = store.getAllKeys();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async getStats() {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['content'], 'readonly');
        const store = transaction.objectStore('content');
        const request = store.getAll();

        request.onsuccess = () => {
          const items = request.result;
          const totalSize = items.reduce((sum, item) => sum + item.size, 0);
          resolve({
            count: items.length,
            totalSize,
            totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2)
          });
        };
        request.onerror = () => reject(request.error);
      });
    }

    async clear() {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['content', 'pins'], 'readwrite');
        
        transaction.objectStore('content').clear();
        transaction.objectStore('pins').clear();

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
      });
    }
  }

  /**
   * SES Network - Content-addressed storage and networking
   */
  class SESNetwork {
    constructor() {
      this.store = new IndexedDBStore();
      this.initialized = false;
      this.objectCache = new Map(); // In-memory cache
    }

    async init() {
      if (this.initialized) {
        console.log('Network already initialized');
        return true;
      }

      try {
        await this.store.init();
        this.initialized = true;
        console.log('✅ SES Network initialized (IndexedDB)');
        return true;
      } catch (error) {
        console.error('Failed to initialize network:', error);
        return false;
      }
    }

    /**
     * Store raw bytes, get CID
     * @param {ArrayBuffer | Uint8Array} bytes
     * @returns {Promise<string>} CID
     */
    async storeBytes(bytes) {
      if (!this.initialized) {
        throw new Error('Network not initialized. Call init() first.');
      }

      // Ensure we have ArrayBuffer
      const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
      
      // Generate CID
      const cid = await CIDGenerator.generate(buffer);
      
      // Store in IndexedDB
      await this.store.store(cid, buffer);
      
      return cid;
    }

    /**
     * Fetch raw bytes by CID
     * @param {string} cid
     * @returns {Promise<ArrayBuffer|null>}
     */
    async fetchBytes(cid) {
      if (!this.initialized) {
        throw new Error('Network not initialized');
      }

      return await this.store.fetch(cid);
    }

    /**
     * Store JSON object, get CID
     * @param {object} obj
     * @returns {Promise<string>} CID
     */
    async storeObject(obj) {
      const json = JSON.stringify(obj);
      const bytes = new TextEncoder().encode(json);
      const cid = await this.storeBytes(bytes);
      
      // Cache the decoded object
      this.objectCache.set(cid, obj);
      
      return cid;
    }

    /**
     * Fetch and parse JSON object
     * @param {string} cid
     * @returns {Promise<object|null>}
     */
    async fetchObject(cid) {
      // Check cache first
      if (this.objectCache.has(cid)) {
        return this.objectCache.get(cid);
      }

      const bytes = await this.fetchBytes(cid);
      if (!bytes) return null;

      try {
        const json = new TextDecoder().decode(bytes);
        const obj = JSON.parse(json);
        
        // Cache it
        this.objectCache.set(cid, obj);
        
        return obj;
      } catch (error) {
        console.error('Failed to parse object:', error);
        return null;
      }
    }

    /**
     * Check if CID exists
     * @param {string} cid
     * @returns {Promise<boolean>}
     */
    async has(cid) {
      return await this.store.has(cid);
    }

    /**
     * Pin content for availability
     * @param {string} cid
     * @returns {Promise<boolean>}
     */
    async pin(cid) {
      return await this.store.pin(cid);
    }

    /**
     * Unpin content
     * @param {string} cid
     * @returns {Promise<boolean>}
     */
    async unpin(cid) {
      return await this.store.unpin(cid);
    }

    /**
     * List all pinned CIDs
     * @returns {Promise<string[]>}
     */
    async listPins() {
      return await this.store.listPins();
    }

    /**
     * List all CIDs
     * @returns {Promise<string[]>}
     */
    async list() {
      return await this.store.list();
    }

    /**
     * Store a pulse and pin it
     * @param {object} pulse - Pulse object
     * @returns {Promise<string>} Pulse CID
     */
    async storePulse(pulse) {
      const cid = await this.storeObject(pulse);
      await this.pin(cid);
      return cid;
    }

    /**
     * Fetch a pulse by CID
     * @param {string} pulseCID
     * @returns {Promise<object|null>}
     */
    async fetchPulse(pulseCID) {
      return await this.fetchObject(pulseCID);
    }

    /**
     * Get network statistics
     * @returns {Promise<object>}
     */
    async getStats() {
      const dbStats = await this.store.getStats();
      const pins = await this.listPins();
      
      return {
        initialized: this.initialized,
        storage: 'IndexedDB',
        totalItems: dbStats.count,
        totalSize: dbStats.totalSize,
        totalSizeMB: dbStats.totalSizeMB,
        pinnedItems: pins.length,
        cachedObjects: this.objectCache.size
      };
    }

    /**
     * Export all content as JSON
     * @returns {Promise<object>}
     */
    async export() {
      const cids = await this.list();
      const pins = await this.listPins();
      const exported = {
        version: '1.0',
        timestamp: Date.now(),
        pins: pins,
        content: {}
      };

      for (const cid of cids) {
        const bytes = await this.fetchBytes(cid);
        if (bytes) {
          // Convert to base64 for JSON export
          const base64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
          exported.content[cid] = base64;
        }
      }

      return exported;
    }

    /**
     * Import content from export
     * @param {object} exported
     */
    async import(exported) {
      if (exported.version !== '1.0') {
        throw new Error(`Unsupported export version: ${exported.version}`);
      }

      for (const [cid, base64] of Object.entries(exported.content)) {
        // Convert base64 back to bytes
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        
        await this.store.store(cid, bytes.buffer);
      }

      // Restore pins
      for (const cid of exported.pins) {
        await this.pin(cid);
      }
    }

    /**
     * Clear all data
     */
    async clear() {
      await this.store.clear();
      this.objectCache.clear();
    }

    /**
     * Close network
     */
    async close() {
      this.objectCache.clear();
      this.initialized = false;
      console.log('✅ SES Network closed');
    }
  }

  // Export to global scope
  global.CIDGenerator = CIDGenerator;
  global.SESNetwork = SESNetwork;

  console.log('✅ SES Network module loaded (browser-safe, IndexedDB)');

})(typeof window !== 'undefined' ? window : this);
