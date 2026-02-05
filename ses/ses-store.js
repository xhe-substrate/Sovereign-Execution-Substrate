/**
 * SES-STORE.JS - Content-Addressed Storage
 * 
 * Provides content-addressed storage using SHA-256 CIDs.
 * Works in browser (IndexedDB) and Node.js (in-memory/file).
 * 
 * Core Properties:
 * - All objects are immutable once stored
 * - Every object is addressed by its content hash
 * - Storage is transport-agnostic
 * 
 * @version 1.0.0
 */

(function(global) {
  'use strict';

  const STORE_NAME = 'ses-content-store';
  const DB_VERSION = 1;

  // ============================================
  // CID GENERATION (shared with core)
  // ============================================
  async function generateCID(data) {
    const encoder = new TextEncoder();
    const dataString = typeof data === 'string' ? data : JSON.stringify(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dataString));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return 'cid:sha256:' + hashHex;
  }

  // ============================================
  // BASE STORE INTERFACE
  // ============================================
  class BaseStore {
    async store(data) {
      throw new Error('Not implemented');
    }

    async fetch(cid) {
      throw new Error('Not implemented');
    }

    async has(cid) {
      throw new Error('Not implemented');
    }

    async list() {
      throw new Error('Not implemented');
    }

    async clear() {
      throw new Error('Not implemented');
    }
  }

  // ============================================
  // IN-MEMORY STORE
  // For testing and Node.js without persistence
  // ============================================
  class MemoryStore extends BaseStore {
    constructor() {
      super();
      this.data = new Map();
    }

    async store(data) {
      const cid = await generateCID(data);
      const serialized = JSON.stringify(data);
      this.data.set(cid, serialized);
      return cid;
    }

    async fetch(cid) {
      const serialized = this.data.get(cid);
      if (!serialized) return null;
      return JSON.parse(serialized);
    }

    async has(cid) {
      return this.data.has(cid);
    }

    async list() {
      return Array.from(this.data.keys());
    }

    async clear() {
      this.data.clear();
    }

    async size() {
      return this.data.size;
    }

    async export() {
      const entries = [];
      for (const [cid, data] of this.data) {
        entries.push({ cid, data: JSON.parse(data) });
      }
      return entries;
    }

    async import(entries) {
      for (const entry of entries) {
        this.data.set(entry.cid, JSON.stringify(entry.data));
      }
    }
  }

  // ============================================
  // INDEXEDDB STORE
  // Browser-native persistent storage
  // ============================================
  class IndexedDBStore extends BaseStore {
    constructor(dbName = 'ses-db') {
      super();
      this.dbName = dbName;
      this.db = null;
      this.initPromise = null;
    }

    async init() {
      if (this.db) return this.db;
      if (this.initPromise) return this.initPromise;

      this.initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, DB_VERSION);

        request.onerror = () => reject(request.error);
        
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME, { keyPath: 'cid' });
          }
        };
      });

      return this.initPromise;
    }

    async store(data) {
      await this.init();
      const cid = await generateCID(data);
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        
        const request = store.put({
          cid,
          data: JSON.stringify(data),
          timestamp: Date.now()
        });

        request.onsuccess = () => resolve(cid);
        request.onerror = () => reject(request.error);
      });
    }

    async fetch(cid) {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(cid);

        request.onsuccess = () => {
          if (request.result) {
            resolve(JSON.parse(request.result.data));
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    async has(cid) {
      const data = await this.fetch(cid);
      return data !== null;
    }

    async list() {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAllKeys();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async clear() {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    async size() {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.count();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async export() {
      await this.init();
      
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const entries = request.result.map(item => ({
            cid: item.cid,
            data: JSON.parse(item.data)
          }));
          resolve(entries);
        };
        request.onerror = () => reject(request.error);
      });
    }

    async import(entries) {
      for (const entry of entries) {
        await this.store(entry.data);
      }
    }
  }

  // ============================================
  // HYBRID STORE
  // Memory cache + persistent backing store
  // ============================================
  class HybridStore extends BaseStore {
    constructor(backingStore) {
      super();
      this.cache = new MemoryStore();
      this.backing = backingStore;
    }

    async store(data) {
      const cid = await this.cache.store(data);
      await this.backing.store(data);
      return cid;
    }

    async fetch(cid) {
      // Try cache first
      let data = await this.cache.fetch(cid);
      if (data !== null) return data;

      // Fall back to backing store
      data = await this.backing.fetch(cid);
      if (data !== null) {
        // Populate cache
        await this.cache.store(data);
      }
      return data;
    }

    async has(cid) {
      return (await this.cache.has(cid)) || (await this.backing.has(cid));
    }

    async list() {
      return this.backing.list();
    }

    async clear() {
      await this.cache.clear();
      await this.backing.clear();
    }
  }

  // ============================================
  // STORE FACTORY
  // Creates appropriate store for environment
  // ============================================
  function createStore(options = {}) {
    const { type = 'auto', dbName = 'ses-db' } = options;

    if (type === 'memory') {
      return new MemoryStore();
    }

    if (type === 'indexeddb') {
      return new IndexedDBStore(dbName);
    }

    if (type === 'hybrid') {
      return new HybridStore(new IndexedDBStore(dbName));
    }

    // Auto-detect
    if (typeof indexedDB !== 'undefined') {
      return new HybridStore(new IndexedDBStore(dbName));
    }

    return new MemoryStore();
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESStore = {
    BaseStore,
    MemoryStore,
    IndexedDBStore,
    HybridStore,
    createStore,
    generateCID
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESStore;
  } else {
    global.SESStore = SESStore;
  }

})(typeof window !== 'undefined' ? window : global);
