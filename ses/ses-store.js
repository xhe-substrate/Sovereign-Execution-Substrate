(function(global) {
  'use strict';

  if (global.SESStore) return;

  const DB_NAME = 'ses-substrate';
  const DB_VERSION = 1;

  const STORES = {
    OBJECTS: 'objects',
    PULSES: 'pulses',
    IDENTITIES: 'identities',
    CLAIMS: 'claims',
    ATTESTATIONS: 'attestations',
    REPUTATION: 'reputation',
    CONTRIBUTIONS: 'contributions',
    CONTEXTS: 'contexts'
  };

  class SESStore {
    constructor() {
      this.db = null;
      this.ready = false;
      this.initPromise = null;
    }

    async init() {
      if (this.ready) return this;
      if (this.initPromise) return this.initPromise;

      this.initPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(new Error('IndexedDB open failed: ' + request.error));
        request.onsuccess = () => {
          this.db = request.result;
          this.ready = true;
          resolve(this);
        };
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          Object.values(STORES).forEach(storeName => {
            if (!db.objectStoreNames.contains(storeName)) {
              const store = db.createObjectStore(storeName, { keyPath: 'cid' });
              switch(storeName) {
                case STORES.PULSES:
                  store.createIndex('author', 'data.author', { unique: false });
                  store.createIndex('status', 'data.status', { unique: false });
                  store.createIndex('parentPulseId', 'data.parentPulseId', { unique: false });
                  store.createIndex('createdAt', 'data.createdAt', { unique: false });
                  break;
                case STORES.CLAIMS:
                  store.createIndex('subject', 'data.subject', { unique: false });
                  store.createIndex('author', 'data.author', { unique: false });
                  store.createIndex('status', 'data.status', { unique: false });
                  break;
                case STORES.ATTESTATIONS:
                  store.createIndex('claimId', 'data.claimId', { unique: false });
                  store.createIndex('agent', 'data.agent', { unique: false });
                  break;
                case STORES.REPUTATION:
                  store.createIndex('did', 'data.did', { unique: true });
                  break;
                case STORES.CONTRIBUTIONS:
                  store.createIndex('author', 'data.author', { unique: false });
                  store.createIndex('type', 'data.type', { unique: false });
                  break;
                case STORES.IDENTITIES:
                  store.createIndex('did', 'data.did', { unique: true });
                  break;
              }
            }
          });
        };
      });

      return this.initPromise;
    }

    async generateCID(data) {
      if (global.SESCore && global.SESCore.generateCID) {
        return global.SESCore.generateCID(data);
      }
      const encoder = new TextEncoder();
      const str = typeof data === 'string' ? data : JSON.stringify(data);
      const hash = await crypto.subtle.digest('SHA-256', encoder.encode(str));
      return 'cid:sha256:' + Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
    }

    async store(data, storeName = STORES.OBJECTS) {
      await this.init();
      const cid = await this.generateCID(data);
      const record = { cid, data, storedAt: new Date().toISOString() };
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(record);
        req.onsuccess = () => resolve(cid);
        req.onerror = () => reject(new Error('Store failed: ' + req.error));
      });
    }

    async fetch(cid, storeName = STORES.OBJECTS) {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(cid);
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => reject(new Error('Fetch failed: ' + req.error));
      });
    }

    async exists(cid, storeName = STORES.OBJECTS) {
      return (await this.fetch(cid, storeName)) !== null;
    }

    async queryByIndex(storeName, indexName, value) {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const req = index.getAll(value);
        req.onsuccess = () => resolve(req.result.map(r => r.data));
        req.onerror = () => reject(new Error('Query failed: ' + req.error));
      });
    }

    async getAll(storeName) {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result.map(r => r.data));
        req.onerror = () => reject(new Error('GetAll failed: ' + req.error));
      });
    }

    async count(storeName) {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new Error('Count failed: ' + req.error));
      });
    }

    async delete(cid, storeName = STORES.OBJECTS) {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(cid);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(new Error('Delete failed: ' + req.error));
      });
    }

    async clear(storeName) {
      await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(new Error('Clear failed: ' + req.error));
      });
    }

    async getStats() {
      await this.init();
      const stats = {};
      for (const s of Object.values(STORES)) stats[s] = await this.count(s);
      return stats;
    }

    async exportAll() {
      await this.init();
      const exportData = {};
      for (const s of Object.values(STORES)) exportData[s] = await this.getAll(s);
      return { version: DB_VERSION, exportedAt: new Date().toISOString(), stores: exportData };
    }

    async importAll(exportData) {
      await this.init();
      const results = {};
      for (const [storeName, records] of Object.entries(exportData.stores)) {
        results[storeName] = { imported: 0, skipped: 0 };
        for (const record of records) {
          const cid = await this.generateCID(record);
          if (!(await this.exists(cid, storeName))) {
            await this.store(record, storeName);
            results[storeName].imported++;
          } else {
            results[storeName].skipped++;
          }
        }
      }
      return results;
    }
  }

  const SESStoreModule = { 
    Store: SESStore, 
    STORES, 
    DB_NAME, 
    DB_VERSION, 
    instance: null, 
    getInstance: async function() { 
      if (!this.instance) { 
        this.instance = new SESStore(); 
        await this.instance.init(); 
      } 
      return this.instance; 
    },
    createStore: async function(options = {}) {
      // For compatibility with ses-ui.js
      const store = new SESStore();
      await store.init();
      return store;
    }
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESStoreModule;
  } else {
    global.SESStore = SESStoreModule;
  }

})(typeof window !== 'undefined' ? window : global);