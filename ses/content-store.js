/**
 * CONTENT-STORE.JS - Content-Addressed Storage Interface
 * Sovereign Execution Substrate - Layer 3
 * 
 * Minimal interface with exactly two primitives:
 *   store(bytes) → CID
 *   fetch(CID) → bytes
 * 
 * Everything else stays outside Layer 3.
 * 
 * @version 1.0.0-frozen
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // CID GENERATION
  // SHA-256 based content addressing
  // ============================================
  
  /**
   * Generate CID using SHA-256 (async, browser-safe)
   * @param {any} data - Data to hash
   * @returns {Promise<string>} CID string
   */
  async function sha256(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const encoder = new TextEncoder();
    const buffer = encoder.encode(str);
    
    // Use Web Crypto API (browser + Node 15+)
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return 'cid:sha256:' + hashHex;
  }

  /**
   * Generate CID synchronously using djb2 hash
   * Fallback for synchronous contexts
   * @param {any} data - Data to hash  
   * @returns {string} CID string
   */
  function djb2(data) {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash >>> 0; // Convert to unsigned 32-bit
    }
    return 'cid:djb2:' + hash.toString(16).padStart(8, '0');
  }

  // ============================================
  // CONTENT STORE INTERFACE
  // ============================================
  
  /**
   * ContentStore - Minimal content-addressed storage
   * 
   * Invariants:
   * - store(x) always returns the same CID for the same x
   * - fetch(store(x)) === x
   * - fetch(unknownCID) returns null (never throws)
   */
  class ContentStore {
    constructor(options = {}) {
      // In-memory storage (can be swapped for IPFS, IndexedDB, etc.)
      this._storage = new Map();
      
      // Use async SHA-256 by default
      this._useAsync = options.useAsync !== false;
      
      // Optional persistence adapter
      this._adapter = options.adapter || null;
    }

    /**
     * Store data and return its CID
     * @param {any} data - Data to store
     * @returns {Promise<string>} CID of stored data
     */
    async store(data) {
      // Normalize data to canonical JSON
      const canonical = this._canonicalize(data);
      
      // Generate CID
      const cid = this._useAsync 
        ? await sha256(canonical)
        : djb2(canonical);
      
      // Store if not already present
      if (!this._storage.has(cid)) {
        this._storage.set(cid, canonical);
        
        // Persist if adapter available
        if (this._adapter && this._adapter.store) {
          await this._adapter.store(cid, canonical);
        }
      }
      
      return cid;
    }

    /**
     * Synchronous store (uses djb2 hash)
     * @param {any} data - Data to store
     * @returns {string} CID of stored data
     */
    storeSync(data) {
      const canonical = this._canonicalize(data);
      const cid = djb2(canonical);
      
      if (!this._storage.has(cid)) {
        this._storage.set(cid, canonical);
      }
      
      return cid;
    }

    /**
     * Fetch data by CID
     * @param {string} cid - Content identifier
     * @returns {Promise<any|null>} Stored data or null
     */
    async fetch(cid) {
      // Check memory first
      if (this._storage.has(cid)) {
        return this._parse(this._storage.get(cid));
      }
      
      // Try adapter if available
      if (this._adapter && this._adapter.fetch) {
        const data = await this._adapter.fetch(cid);
        if (data !== null) {
          this._storage.set(cid, data);
          return this._parse(data);
        }
      }
      
      return null;
    }

    /**
     * Synchronous fetch
     * @param {string} cid - Content identifier
     * @returns {any|null} Stored data or null
     */
    fetchSync(cid) {
      if (this._storage.has(cid)) {
        return this._parse(this._storage.get(cid));
      }
      return null;
    }

    /**
     * Check if CID exists
     * @param {string} cid - Content identifier
     * @returns {boolean}
     */
    has(cid) {
      return this._storage.has(cid);
    }

    /**
     * Get all stored CIDs
     * @returns {string[]}
     */
    keys() {
      return Array.from(this._storage.keys());
    }

    /**
     * Get store size
     * @returns {number}
     */
    size() {
      return this._storage.size;
    }

    /**
     * Clear all stored data
     */
    clear() {
      this._storage.clear();
    }

    /**
     * Export store contents (for persistence)
     * @returns {Object} Serializable store contents
     */
    export() {
      const entries = {};
      for (const [cid, data] of this._storage) {
        entries[cid] = data;
      }
      return entries;
    }

    /**
     * Import store contents
     * @param {Object} entries - Previously exported contents
     */
    import(entries) {
      for (const [cid, data] of Object.entries(entries)) {
        this._storage.set(cid, data);
      }
    }

    /**
     * Canonicalize data to JSON string
     * @private
     */
    _canonicalize(data) {
      if (typeof data === 'string') {
        return data;
      }
      // Stable JSON serialization (sorted keys)
      return JSON.stringify(data, this._sortedReplacer);
    }

    /**
     * Parse stored data back to object
     * @private
     */
    _parse(data) {
      if (typeof data !== 'string') {
        return data;
      }
      try {
        return JSON.parse(data);
      } catch (e) {
        return data; // Return as-is if not JSON
      }
    }

    /**
     * Sorted JSON replacer for canonical serialization
     * @private
     */
    _sortedReplacer(key, value) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.keys(value).sort().reduce((sorted, k) => {
          sorted[k] = value[k];
          return sorted;
        }, {});
      }
      return value;
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const ContentStoreModule = Object.freeze({
    ContentStore: ContentStore,
    sha256: sha256,
    djb2: djb2
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ContentStoreModule;
  } else if (typeof root !== 'undefined') {
    root.ContentStoreModule = ContentStoreModule;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
