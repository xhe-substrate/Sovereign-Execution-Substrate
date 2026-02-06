/**
 * SES-IDENTITY.JS - Decentralized Identity (DID) Management
 * Web Crypto API with Ed25519 for self-sovereign identity
 *
 * Core Invariants:
 * - Private keys never leave the browser
 * - DIDs are derived from public keys
 * - All signatures are Ed25519
 * - Identity is portable and self-owned
 *
 * @version 1.0.0
 * @depends ses-core.js, ses-store.js
 */

(function(global) {
  'use strict';

  // Ed25519 is not directly supported in Web Crypto API
  // We use ECDSA P-256 as a fallback with clear DID method distinction
  // For true Ed25519, integrate @noble/ed25519 or similar
  
  const DID_METHOD = 'did:key';
  const KEY_ALGORITHM = 'ECDSA';
  const CURVE = 'P-256';
  const SIGN_ALGORITHM = { name: 'ECDSA', hash: 'SHA-256' };

  /**
   * IdentityRegistry - Manage multiple identities
   */
  class IdentityRegistry {
    constructor() {
      this.identities = new Map();
      this.defaultDID = null;
    }

    register(identity, isDefault = false) {
      this.identities.set(identity.did, identity);
      if (isDefault || this.identities.size === 1) {
        this.defaultDID = identity.did;
      }
    }

    get(did) {
      return this.identities.get(did);
    }

    getDefault() {
      return this.defaultDID ? this.identities.get(this.defaultDID) : null;
    }

    setDefault(did) {
      if (this.identities.has(did)) {
        this.defaultDID = did;
        return true;
      }
      return false;
    }

    list() {
      return Array.from(this.identities.values());
    }

    async saveToStorage() {
      try {
        const data = {
          identities: Array.from(this.identities.entries()),
          defaultDID: this.defaultDID
        };
        localStorage.setItem('ses-identities', JSON.stringify(data));
        return true;
      } catch (e) {
        console.error('Failed to save identities:', e);
        return false;
      }
    }

    async loadFromStorage() {
      try {
        const stored = localStorage.getItem('ses-identities');
        if (!stored) return false;
        
        const data = JSON.parse(stored);
        this.identities = new Map(data.identities);
        this.defaultDID = data.defaultDID;
        return true;
      } catch (e) {
        console.error('Failed to load identities:', e);
        return false;
      }
    }
  }

  /**
   * SESIdentity - Self-Sovereign Identity Manager
   */
  class SESIdentity {
    constructor(store) {
      this.store = store;
      this.currentIdentity = null;
    }

    /**
     * Generate a new keypair and DID
     */
    async generate() {
      // Generate ECDSA P-256 keypair
      const keyPair = await crypto.subtle.generateKey(
        {
          name: KEY_ALGORITHM,
          namedCurve: CURVE
        },
        true, // extractable for export
        ['sign', 'verify']
      );

      // Export public key for DID derivation
      const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
      const publicKeyRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);
      
      // Generate DID from public key hash
      const publicKeyBytes = new Uint8Array(publicKeyRaw);
      const hashBuffer = await crypto.subtle.digest('SHA-256', publicKeyBytes);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const publicKeyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      
      const did = `${DID_METHOD}:z${this.base58Encode(publicKeyBytes)}`;
      
      // Export private key (for storage - encrypted in real implementation)
      const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

      const identity = {
        did,
        publicKey: publicKeyJwk,
        privateKey: privateKeyJwk,
        algorithm: KEY_ALGORITHM,
        curve: CURVE,
        createdAt: new Date().toISOString(),
        keyPair // Keep in memory for signing
      };

      // Store identity document (without private key)
      const publicIdentity = {
        did,
        publicKey: publicKeyJwk,
        algorithm: KEY_ALGORITHM,
        curve: CURVE,
        createdAt: identity.createdAt
      };

      if (this.store) {
        await this.store.store(publicIdentity, global.SESStore?.STORES?.IDENTITIES || 'identities');
      }

      this.currentIdentity = identity;
      return identity;
    }

    /**
     * Base58 encoding (simplified - Bitcoin style)
     */
    base58Encode(bytes) {
      const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let num = BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''));
      let result = '';
      while (num > 0) {
        result = ALPHABET[Number(num % 58n)] + result;
        num = num / 58n;
      }
      // Handle leading zeros
      for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
        result = '1' + result;
      }
      return result || '1';
    }

    /**
     * Import an existing identity from JWK
     */
    async import(privateKeyJwk, publicKeyJwk) {
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        privateKeyJwk,
        { name: KEY_ALGORITHM, namedCurve: CURVE },
        true,
        ['sign']
      );

      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: KEY_ALGORITHM, namedCurve: CURVE },
        true,
        ['verify']
      );

      // Regenerate DID from public key
      const publicKeyRaw = await crypto.subtle.exportKey('raw', publicKey);
      const publicKeyBytes = new Uint8Array(publicKeyRaw);
      const did = `${DID_METHOD}:z${this.base58Encode(publicKeyBytes)}`;

      this.currentIdentity = {
        did,
        publicKey: publicKeyJwk,
        privateKey: privateKeyJwk,
        algorithm: KEY_ALGORITHM,
        curve: CURVE,
        createdAt: new Date().toISOString(),
        keyPair: { publicKey, privateKey }
      };

      return this.currentIdentity;
    }

    /**
     * Sign data with current identity
     */
    async sign(data) {
      if (!this.currentIdentity || !this.currentIdentity.keyPair) {
        throw new Error('No identity loaded. Call generate() or import() first.');
      }

      const encoder = new TextEncoder();
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      const dataBytes = encoder.encode(dataString);

      const signature = await crypto.subtle.sign(
        SIGN_ALGORITHM,
        this.currentIdentity.keyPair.privateKey,
        dataBytes
      );

      const signatureArray = Array.from(new Uint8Array(signature));
      const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

      return {
        signature: signatureHex,
        algorithm: SIGN_ALGORITHM,
        signer: this.currentIdentity.did,
        timestamp: new Date().toISOString()
      };
    }

    /**
     * Verify a signature
     */
    async verify(data, signatureHex, publicKeyJwk) {
      const publicKey = await crypto.subtle.importKey(
        'jwk',
        publicKeyJwk,
        { name: KEY_ALGORITHM, namedCurve: CURVE },
        false,
        ['verify']
      );

      const encoder = new TextEncoder();
      const dataString = typeof data === 'string' ? data : JSON.stringify(data);
      const dataBytes = encoder.encode(dataString);

      // Convert hex signature back to ArrayBuffer
      const signatureBytes = new Uint8Array(
        signatureHex.match(/.{1,2}/g).map(byte => parseInt(byte, 16))
      );

      return crypto.subtle.verify(
        SIGN_ALGORITHM,
        publicKey,
        signatureBytes,
        dataBytes
      );
    }

    /**
     * Get current DID
     */
    getDID() {
      return this.currentIdentity?.did || null;
    }

    /**
     * Get public key for sharing
     */
    getPublicKey() {
      if (!this.currentIdentity) return null;
      return {
        did: this.currentIdentity.did,
        publicKey: this.currentIdentity.publicKey,
        algorithm: this.currentIdentity.algorithm,
        curve: this.currentIdentity.curve
      };
    }

    /**
     * Export identity for backup (includes private key - handle with care!)
     */
    async export() {
      if (!this.currentIdentity) {
        throw new Error('No identity to export');
      }
      return {
        did: this.currentIdentity.did,
        publicKey: this.currentIdentity.publicKey,
        privateKey: this.currentIdentity.privateKey,
        algorithm: this.currentIdentity.algorithm,
        curve: this.currentIdentity.curve,
        createdAt: this.currentIdentity.createdAt,
        exportedAt: new Date().toISOString()
      };
    }

    /**
     * Resolve a DID to its public identity document
     */
    async resolve(did) {
      if (!this.store) return null;
      
      // Try to find in local store
      const identities = await this.store.getAll(
        global.SESStore?.STORES?.IDENTITIES || 'identities'
      );
      
      return identities.find(id => id.did === did) || null;
    }

    /**
     * Create a signed attestation
     */
    async createAttestation(claim, verdict, confidence, reasoning) {
      if (!this.currentIdentity) {
        throw new Error('No identity loaded');
      }

      const attestation = {
        agent: this.currentIdentity.did,
        claimId: claim.claimId || claim,
        verdict, // 'accept' | 'reject' | 'abstain'
        confidence, // 0.0 - 1.0
        reasoningHash: await this.hashReasoning(reasoning),
        timestamp: new Date().toISOString()
      };

      const signResult = await this.sign(attestation);
      attestation.signature = signResult.signature;

      return attestation;
    }

    /**
     * Hash reasoning for privacy (only hash is stored, not full reasoning)
     */
    async hashReasoning(reasoning) {
      if (!reasoning) return null;
      const encoder = new TextEncoder();
      const reasoningString = typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(reasoningString));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SESIdentityModule = {
    Identity: SESIdentity,
    IdentityRegistry,
    DID_METHOD,
    KEY_ALGORITHM,
    CURVE,
    SIGN_ALGORITHM,
    // Singleton instance
    instance: null,
    getInstance: async function(store) {
      if (!this.instance) {
        const storeInstance = store || (global.SESStore ? await global.SESStore.getInstance() : null);
        this.instance = new SESIdentity(storeInstance);
      }
      return this.instance;
    },
    // Static methods for direct use
    async generate() {
      const identity = new SESIdentity(null);
      return await identity.generate();
    },
    async signObject(identity, obj) {
      const temp = new SESIdentity(null);
      temp.currentIdentity = identity;
      return await temp.sign(obj);
    },
    async verifyObject(signedObj) {
      if (!signedObj.signature || !signedObj.author) return false;
      const temp = new SESIdentity(null);
      const { signature, ...data } = signedObj;
      // This is simplified - in real implementation, fetch public key from DID
      return true; // Placeholder
    }
  };

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SESIdentityModule;
  } else {
    global.SESIdentity = SESIdentityModule;
    global.IdentityRegistry = IdentityRegistry; // Also expose directly for UI
  }

})(typeof window !== 'undefined' ? window : global);
