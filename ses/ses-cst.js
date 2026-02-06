/**
 * SES Capsule Sovereign Tokens (CST) - Layer 5 Programmable Store-of-Value
 * 
 * Implements programmable digital tokens with policy governance, conditional
 * unlocking, delegation, and revocation. Each token is a "capsule" with its
 * own governance rules.
 * 
 * Core Principles:
 * - Tokens are indivisible (decimals: 0)
 * - Each token has policy keys for governance
 * - Conditional unlocking based on proofs
 * - Delegation and revocation support
 * - Integration with contribution economy and ceremonies
 * - All operations are content-addressed and replayable
 */

class PolicyKey {
  constructor(data) {
    this.id = data.id;
    this.type = data.type; // "transfer" | "delegate" | "revoke" | "unlock"
    this.holder = data.holder; // DID
    this.conditions = data.conditions || [];
    this.expiresAt = data.expiresAt || null;
  }
}

class CapsuleToken {
  constructor(data) {
    this.token_id = data.token_id;
    this.owner = data.owner; // DID
    this.created_at = data.created_at || Date.now();
    this.created_by = data.created_by;
    
    // Governance
    this.policy_keys = (data.policy_keys || []).map(k => new PolicyKey(k));
    this.transfer_policy = data.transfer_policy || { type: 'unrestricted' };
    this.revocation_rights = data.revocation_rights || [];
    this.delegation_rights = data.delegation_rights || [];
    
    // Conditional Logic
    this.unlock_conditions = data.unlock_conditions || [];
    this.timelocks = data.timelocks || [];
    this.inheritance_path = data.inheritance_path || [];
    
    // State
    this.locked = data.locked !== false; // Default locked
    this.delegated_to = data.delegated_to || null;
    this.delegate_policy = data.delegate_policy || null;
    
    // Metadata
    this.metadata = data.metadata || {};
    this.history = data.history || [];
  }
  
  toJSON() {
    return {
      token_id: this.token_id,
      owner: this.owner,
      created_at: this.created_at,
      created_by: this.created_by,
      policy_keys: this.policy_keys,
      transfer_policy: this.transfer_policy,
      revocation_rights: this.revocation_rights,
      delegation_rights: this.delegation_rights,
      unlock_conditions: this.unlock_conditions,
      timelocks: this.timelocks,
      inheritance_path: this.inheritance_path,
      locked: this.locked,
      delegated_to: this.delegated_to,
      delegate_policy: this.delegate_policy,
      metadata: this.metadata,
      history: this.history
    };
  }
}

class CSTLedger {
  constructor(store) {
    this.store = store;
    this.tokens = new Map(); // token_id -> CapsuleToken
    this.ownerIndex = new Map(); // DID -> token_id[]
    this.delegateIndex = new Map(); // DID -> token_id[]
    this.nextTokenId = 1;
    this.totalSupply = 100_000_000_000_000_000; // 100 quadrillion
    this.circulatingSupply = 0;
    this.initialized = false;
  }
  
  async initialize() {
    if (this.initialized) return;
    
    try {
      const stored = await this.store.get('cst_ledger');
      if (stored) {
        const data = JSON.parse(stored);
        this.nextTokenId = data.nextTokenId || 1;
        this.circulatingSupply = data.circulatingSupply || 0;
        
        data.tokens.forEach(t => {
          const token = new CapsuleToken(t);
          this.tokens.set(token.token_id, token);
          this._indexToken(token);
        });
      }
    } catch (error) {
      console.warn('[CST] Failed to load from store:', error);
    }
    
    this.initialized = true;
    console.log(`[CST] Initialized with ${this.tokens.size} tokens`);
  }
  
  /**
   * Mint new tokens
   */
  async mint(data) {
    await this.initialize();
    
    const count = data.count || 1;
    const tokens = [];
    
    for (let i = 0; i < count; i++) {
      const token_id = `CST-${this.nextTokenId++}`;
      
      const token = new CapsuleToken({
        token_id,
        owner: data.owner,
        created_by: data.creator || data.owner,
        policy_keys: data.policy_keys || [],
        transfer_policy: data.transfer_policy,
        unlock_conditions: data.unlock_conditions || [],
        metadata: data.metadata || {}
      });
      
      this.tokens.set(token_id, token);
      this._indexToken(token);
      this.circulatingSupply++;
      
      this._addHistory(token, 'mint', {
        minted_by: data.creator || data.owner,
        timestamp: Date.now()
      });
      
      tokens.push(token);
    }
    
    await this._persist();
    
    console.log(`[CST] Minted ${count} tokens for ${data.owner}`);
    
    return tokens;
  }
  
  /**
   * Transfer token ownership
   */
  async transfer(from, to, token_id, signature) {
    await this.initialize();
    
    const token = this.tokens.get(token_id);
    if (!token) {
      throw new Error(`Token ${token_id} not found`);
    }
    
    if (token.owner !== from) {
      throw new Error(`Only owner can transfer token`);
    }
    
    if (token.locked) {
      throw new Error(`Token is locked`);
    }
    
    // Check transfer policy
    if (!this._checkTransferPolicy(token, from, to)) {
      throw new Error(`Transfer not allowed by policy`);
    }
    
    // Verify signature (simplified)
    // In production, verify Ed25519 signature
    
    // Update indices
    this._removeFromOwnerIndex(from, token_id);
    
    // Transfer
    token.owner = to;
    this._indexToken(token);
    
    this._addHistory(token, 'transfer', {
      from,
      to,
      timestamp: Date.now(),
      signature
    });
    
    await this._persist();
    
    console.log(`[CST] Transferred ${token_id} from ${from} to ${to}`);
    
    return token;
  }
  
  /**
   * Delegate token to another DID
   */
  async delegate(token_id, owner, delegate, policy, signature) {
    await this.initialize();
    
    const token = this.tokens.get(token_id);
    if (!token) {
      throw new Error(`Token ${token_id} not found`);
    }
    
    if (token.owner !== owner) {
      throw new Error(`Only owner can delegate`);
    }
    
    if (!token.delegation_rights.includes(owner) && token.delegation_rights.length > 0) {
      throw new Error(`Owner does not have delegation rights`);
    }
    
    token.delegated_to = delegate;
    token.delegate_policy = policy;
    
    // Index for delegate
    const delegateTokens = this.delegateIndex.get(delegate) || [];
    if (!delegateTokens.includes(token_id)) {
      delegateTokens.push(token_id);
      this.delegateIndex.set(delegate, delegateTokens);
    }
    
    this._addHistory(token, 'delegate', {
      delegate,
      policy,
      timestamp: Date.now(),
      signature
    });
    
    await this._persist();
    
    console.log(`[CST] Delegated ${token_id} to ${delegate}`);
    
    return token;
  }
  
  /**
   * Revoke a token
   */
  async revoke(token_id, revoker, reason, signature) {
    await this.initialize();
    
    const token = this.tokens.get(token_id);
    if (!token) {
      throw new Error(`Token ${token_id} not found`);
    }
    
    if (!token.revocation_rights.includes(revoker)) {
      throw new Error(`${revoker} does not have revocation rights`);
    }
    
    // Remove from circulation
    this._removeFromOwnerIndex(token.owner, token_id);
    this.tokens.delete(token_id);
    this.circulatingSupply--;
    
    this._addHistory(token, 'revoke', {
      revoked_by: revoker,
      reason,
      timestamp: Date.now(),
      signature
    });
    
    // Store revocation in separate index for audit
    await this.store.set(`cst_revoked_${token_id}`, JSON.stringify(token.toJSON()));
    
    await this._persist();
    
    console.log(`[CST] Revoked ${token_id}: ${reason}`);
    
    return { revoked: true, token_id, reason };
  }
  
  /**
   * Unlock a token based on proof
   */
  async unlock(token_id, proof) {
    await this.initialize();
    
    const token = this.tokens.get(token_id);
    if (!token) {
      throw new Error(`Token ${token_id} not found`);
    }
    
    if (!token.locked) {
      return { unlocked: true, already: true };
    }
    
    // Check unlock conditions
    const satisfied = this._checkUnlockConditions(token, proof);
    if (!satisfied) {
      throw new Error(`Unlock conditions not satisfied`);
    }
    
    token.locked = false;
    
    this._addHistory(token, 'unlock', {
      proof_cid: proof.cid,
      timestamp: Date.now()
    });
    
    await this._persist();
    
    console.log(`[CST] Unlocked ${token_id}`);
    
    return { unlocked: true, token_id };
  }
  
  /**
   * Conditional unlock based on consensus
   */
  async conditionalUnlock(recipient, amount, condition) {
    await this.initialize();
    
    // Mint locked tokens
    const tokens = await this.mint({
      owner: recipient,
      count: amount,
      unlock_conditions: [condition],
      metadata: { conditional: true }
    });
    
    console.log(`[CST] Created ${amount} conditional tokens for ${recipient}`);
    
    return tokens;
  }
  
  /**
   * Get tokens owned by a DID
   */
  getByOwner(did) {
    const token_ids = this.ownerIndex.get(did) || [];
    return token_ids.map(id => this.tokens.get(id)).filter(Boolean);
  }
  
  /**
   * Get tokens delegated to a DID
   */
  getByDelegate(did) {
    const token_ids = this.delegateIndex.get(did) || [];
    return token_ids.map(id => this.tokens.get(id)).filter(Boolean);
  }
  
  /**
   * Get token by ID
   */
  get(token_id) {
    return this.tokens.get(token_id);
  }
  
  /**
   * Get balance for a DID
   */
  getBalance(did) {
    const owned = this.getByOwner(did);
    return {
      total: owned.length,
      locked: owned.filter(t => t.locked).length,
      unlocked: owned.filter(t => !t.locked).length,
      delegated: owned.filter(t => t.delegated_to).length
    };
  }
  
  /**
   * Get ledger statistics
   */
  getStats() {
    const totalTokens = this.tokens.size;
    const lockedTokens = Array.from(this.tokens.values()).filter(t => t.locked).length;
    const delegatedTokens = Array.from(this.tokens.values()).filter(t => t.delegated_to).length;
    const uniqueOwners = this.ownerIndex.size;
    
    return {
      total_supply: this.totalSupply,
      circulating_supply: this.circulatingSupply,
      total_tokens: totalTokens,
      locked_tokens: lockedTokens,
      unlocked_tokens: totalTokens - lockedTokens,
      delegated_tokens: delegatedTokens,
      unique_owners: uniqueOwners,
      utilization: (this.circulatingSupply / this.totalSupply * 100).toFixed(6) + '%'
    };
  }
  
  /**
   * Check if transfer is allowed by policy
   */
  _checkTransferPolicy(token, from, to) {
    const policy = token.transfer_policy;
    
    if (policy.type === 'unrestricted') {
      return true;
    }
    
    if (policy.type === 'whitelist') {
      return policy.allowed && policy.allowed.includes(to);
    }
    
    if (policy.type === 'require_approval') {
      // Would check if approval exists
      return false; // Simplified
    }
    
    return true;
  }
  
  /**
   * Check if unlock conditions are satisfied
   */
  _checkUnlockConditions(token, proof) {
    if (token.unlock_conditions.length === 0) {
      return true;
    }
    
    for (const condition of token.unlock_conditions) {
      if (condition.type === 'consensus_accepted') {
        if (proof.consensus_result && proof.consensus_result.verdict === 'accept') {
          return true;
        }
      }
      
      if (condition.type === 'timelock') {
        if (Date.now() >= condition.unlock_timestamp) {
          return true;
        }
      }
      
      if (condition.type === 'contribution_threshold') {
        if (proof.contribution_score >= condition.threshold) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Add history entry to token
   */
  _addHistory(token, action, data) {
    token.history.push({
      action,
      ...data
    });
  }
  
  /**
   * Index a token for fast lookups
   */
  _indexToken(token) {
    // Owner index
    const ownerTokens = this.ownerIndex.get(token.owner) || [];
    if (!ownerTokens.includes(token.token_id)) {
      ownerTokens.push(token.token_id);
      this.ownerIndex.set(token.owner, ownerTokens);
    }
  }
  
  /**
   * Remove from owner index
   */
  _removeFromOwnerIndex(owner, token_id) {
    const ownerTokens = this.ownerIndex.get(owner) || [];
    const index = ownerTokens.indexOf(token_id);
    if (index > -1) {
      ownerTokens.splice(index, 1);
      if (ownerTokens.length === 0) {
        this.ownerIndex.delete(owner);
      } else {
        this.ownerIndex.set(owner, ownerTokens);
      }
    }
  }
  
  /**
   * Persist ledger to store
   */
  async _persist() {
    try {
      const data = {
        tokens: Array.from(this.tokens.values()).map(t => t.toJSON()),
        nextTokenId: this.nextTokenId,
        circulatingSupply: this.circulatingSupply,
        version: '1.0.0'
      };
      await this.store.set('cst_ledger', JSON.stringify(data));
    } catch (error) {
      console.error('[CST] Failed to persist:', error);
    }
  }
  
  /**
   * Export ledger
   */
  async exportLedger() {
    await this.initialize();
    
    return {
      version: '1.0.0',
      timestamp: Date.now(),
      tokens: Array.from(this.tokens.values()).map(t => t.toJSON()),
      stats: this.getStats()
    };
  }
  
  /**
   * Import ledger
   */
  async importLedger(data) {
    await this.initialize();
    
    let imported = 0;
    
    for (const tokenData of data.tokens) {
      if (!this.tokens.has(tokenData.token_id)) {
        const token = new CapsuleToken(tokenData);
        this.tokens.set(token.token_id, token);
        this._indexToken(token);
        imported++;
      }
    }
    
    if (imported > 0) {
      this.circulatingSupply += imported;
      await this._persist();
      console.log(`[CST] Imported ${imported} new tokens`);
    }
    
    return { imported, total: this.tokens.size };
  }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CSTLedger, CapsuleToken, PolicyKey };
}
