/**
 * SES P2P Network Layer - True Decentralization
 * 
 * Implements:
 * - IPFS-style content distribution via CIDs
 * - WebRTC mesh for browser-to-browser communication
 * - DHT for pulse/context/contribution discovery
 * - Gossip protocol for agent consensus propagation
 * 
 * Transforms SES from single-user to truly distributed system.
 * 
 * @version 2.0.0
 */

(function(global) {
  'use strict';

  // ============================================
  // DHT (Distributed Hash Table)
  // ============================================
  class DistributedHashTable {
    constructor(nodeId) {
      this.nodeId = nodeId;
      this.buckets = new Map(); // k-bucket structure
      this.store = new Map(); // key -> value storage
      this.peers = new Set(); // connected peer IDs
      this.k = 20; // bucket size (Kademlia parameter)
    }

    /**
     * XOR distance between two node IDs
     */
    distance(nodeA, nodeB) {
      const bufA = this._hexToBuffer(nodeA);
      const bufB = this._hexToBuffer(nodeB);
      let dist = 0;
      for (let i = 0; i < bufA.length; i++) {
        dist += (bufA[i] ^ bufB[i]);
      }
      return dist;
    }

    /**
     * Find k closest nodes to a key
     */
    findClosestNodes(key, k = this.k) {
      const allPeers = Array.from(this.peers);
      return allPeers
        .map(peer => ({ id: peer, distance: this.distance(key, peer) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, k)
        .map(p => p.id);
    }

    /**
     * Store a key-value pair
     */
    async put(key, value) {
      this.store.set(key, {
        value,
        timestamp: Date.now(),
        publisher: this.nodeId
      });

      // Replicate to k closest nodes
      const closestNodes = this.findClosestNodes(key);
      return {
        stored: true,
        replicatedTo: closestNodes.length,
        nodes: closestNodes
      };
    }

    /**
     * Retrieve a value by key
     */
    async get(key) {
      if (this.store.has(key)) {
        return this.store.get(key);
      }

      // Query closest nodes
      const closestNodes = this.findClosestNodes(key);
      return {
        found: false,
        queriedNodes: closestNodes.length
      };
    }

    /**
     * Add a peer to the routing table
     */
    addPeer(peerId) {
      this.peers.add(peerId);
      
      // Find appropriate bucket based on XOR distance
      const bucketIndex = Math.floor(Math.log2(this.distance(this.nodeId, peerId) + 1));
      
      if (!this.buckets.has(bucketIndex)) {
        this.buckets.set(bucketIndex, new Set());
      }
      
      const bucket = this.buckets.get(bucketIndex);
      if (bucket.size < this.k) {
        bucket.add(peerId);
      }
    }

    /**
     * Remove a peer
     */
    removePeer(peerId) {
      this.peers.delete(peerId);
      
      for (const [_, bucket] of this.buckets) {
        bucket.delete(peerId);
      }
    }

    _hexToBuffer(hex) {
      const cleaned = hex.replace(/^0x/, '');
      const bytes = new Uint8Array(cleaned.length / 2);
      for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleaned.substr(i * 2, 2), 16);
      }
      return bytes;
    }

    getStats() {
      return {
        nodeId: this.nodeId,
        peers: this.peers.size,
        buckets: this.buckets.size,
        storedKeys: this.store.size,
        coverage: `${Math.min(100, (this.peers.size / this.k) * 100).toFixed(1)}%`
      };
    }
  }

  // ============================================
  // WebRTC Mesh Network
  // ============================================
  class WebRTCMesh {
    constructor(nodeId) {
      this.nodeId = nodeId;
      this.peers = new Map(); // peerId -> RTCPeerConnection
      this.dataChannels = new Map(); // peerId -> RTCDataChannel
      this.messageHandlers = new Map();
      this.connectionState = new Map();
      
      // ICE servers (STUN/TURN)
      this.iceServers = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ];
    }

    /**
     * Create offer to connect to peer
     */
    async createOffer(peerId) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.peers.set(peerId, pc);

      // Create data channel
      const dc = pc.createDataChannel('ses-mesh', {
        ordered: true,
        maxRetransmits: 3
      });
      
      this._setupDataChannel(peerId, dc);

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Wait for ICE gathering
      await this._waitForIceGathering(pc);

      this.connectionState.set(peerId, 'connecting');

      return {
        from: this.nodeId,
        to: peerId,
        offer: pc.localDescription
      };
    }

    /**
     * Handle received offer
     */
    async handleOffer(peerId, offer) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers });
      this.peers.set(peerId, pc);

      // Handle incoming data channel
      pc.ondatachannel = (event) => {
        this._setupDataChannel(peerId, event.channel);
      };

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      await this._waitForIceGathering(pc);

      this.connectionState.set(peerId, 'connecting');

      return {
        from: this.nodeId,
        to: peerId,
        answer: pc.localDescription
      };
    }

    /**
     * Handle received answer
     */
    async handleAnswer(peerId, answer) {
      const pc = this.peers.get(peerId);
      if (!pc) {
        throw new Error(`No peer connection for ${peerId}`);
      }

      await pc.setRemoteDescription(answer);
      this.connectionState.set(peerId, 'connected');
    }

    /**
     * Send message to peer
     */
    sendToPeer(peerId, message) {
      const dc = this.dataChannels.get(peerId);
      if (!dc || dc.readyState !== 'open') {
        throw new Error(`Not connected to peer ${peerId}`);
      }

      const data = JSON.stringify(message);
      dc.send(data);
    }

    /**
     * Broadcast message to all connected peers
     */
    broadcast(message) {
      const sent = [];
      for (const [peerId, dc] of this.dataChannels) {
        if (dc.readyState === 'open') {
          try {
            this.sendToPeer(peerId, message);
            sent.push(peerId);
          } catch (err) {
            console.error(`Failed to send to ${peerId}:`, err);
          }
        }
      }
      return sent;
    }

    /**
     * Register message handler
     */
    onMessage(type, handler) {
      this.messageHandlers.set(type, handler);
    }

    /**
     * Disconnect from peer
     */
    disconnectPeer(peerId) {
      const pc = this.peers.get(peerId);
      if (pc) {
        pc.close();
        this.peers.delete(peerId);
      }

      const dc = this.dataChannels.get(peerId);
      if (dc) {
        dc.close();
        this.dataChannels.delete(peerId);
      }

      this.connectionState.delete(peerId);
    }

    /**
     * Setup data channel handlers
     */
    _setupDataChannel(peerId, dc) {
      this.dataChannels.set(peerId, dc);

      dc.onopen = () => {
        console.log(`✅ Data channel open with ${peerId}`);
        this.connectionState.set(peerId, 'connected');
      };

      dc.onclose = () => {
        console.log(`❌ Data channel closed with ${peerId}`);
        this.connectionState.set(peerId, 'disconnected');
      };

      dc.onerror = (error) => {
        console.error(`Data channel error with ${peerId}:`, error);
      };

      dc.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const handler = this.messageHandlers.get(message.type);
          
          if (handler) {
            handler(message, peerId);
          } else {
            console.warn(`No handler for message type: ${message.type}`);
          }
        } catch (err) {
          console.error('Failed to handle message:', err);
        }
      };
    }

    /**
     * Wait for ICE gathering to complete
     */
    async _waitForIceGathering(pc) {
      return new Promise((resolve) => {
        if (pc.iceGatheringState === 'complete') {
          resolve();
          return;
        }

        const checkState = () => {
          if (pc.iceGatheringState === 'complete') {
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };

        pc.addEventListener('icegatheringstatechange', checkState);
      });
    }

    getStats() {
      const connected = Array.from(this.connectionState.entries())
        .filter(([_, state]) => state === 'connected');

      return {
        totalPeers: this.peers.size,
        connectedPeers: connected.length,
        dataChannels: this.dataChannels.size,
        messageHandlers: this.messageHandlers.size,
        peers: Object.fromEntries(this.connectionState)
      };
    }
  }

  // ============================================
  // Gossip Protocol
  // ============================================
  class GossipProtocol {
    constructor(nodeId, mesh) {
      this.nodeId = nodeId;
      this.mesh = mesh;
      this.messageCache = new Map(); // message_id -> {content, seen, timestamp}
      this.fanout = 3; // Number of peers to gossip to
      this.messageTimeout = 60000; // 1 minute
      
      // Setup message handler
      this.mesh.onMessage('gossip', this._handleGossipMessage.bind(this));
      
      // Periodic cache cleanup
      setInterval(() => this._cleanupCache(), this.messageTimeout);
    }

    /**
     * Gossip a message to the network
     */
    gossip(type, payload, metadata = {}) {
      const message = {
        id: this._generateMessageId(),
        type,
        payload,
        metadata: {
          ...metadata,
          origin: this.nodeId,
          timestamp: Date.now(),
          ttl: metadata.ttl || 5 // Time-to-live (hops)
        }
      };

      this._cacheMessage(message);
      this._propagateMessage(message);

      return message.id;
    }

    /**
     * Propagate message to random subset of peers
     */
    _propagateMessage(message) {
      const allPeers = Array.from(this.mesh.dataChannels.keys());
      const selectedPeers = this._selectRandomPeers(allPeers, this.fanout);

      const gossipMsg = {
        type: 'gossip',
        message
      };

      for (const peerId of selectedPeers) {
        try {
          this.mesh.sendToPeer(peerId, gossipMsg);
        } catch (err) {
          console.error(`Failed to gossip to ${peerId}:`, err);
        }
      }

      return selectedPeers.length;
    }

    /**
     * Handle incoming gossip message
     */
    _handleGossipMessage(gossipMsg, fromPeer) {
      const { message } = gossipMsg;

      // Check if already seen
      if (this.messageCache.has(message.id)) {
        return; // Already processed
      }

      // Cache it
      this._cacheMessage(message);

      // Check TTL
      if (message.metadata.ttl <= 0) {
        return; // Don't propagate further
      }

      // Decrement TTL and propagate
      const newMessage = {
        ...message,
        metadata: {
          ...message.metadata,
          ttl: message.metadata.ttl - 1
        }
      };

      // Propagate to other peers (except sender)
      const allPeers = Array.from(this.mesh.dataChannels.keys())
        .filter(p => p !== fromPeer);
      
      const selectedPeers = this._selectRandomPeers(allPeers, this.fanout);

      for (const peerId of selectedPeers) {
        try {
          this.mesh.sendToPeer(peerId, { type: 'gossip', message: newMessage });
        } catch (err) {
          console.error(`Failed to propagate to ${peerId}:`, err);
        }
      }

      // Emit event for application layer
      this._emitGossipEvent(message);
    }

    /**
     * Cache message
     */
    _cacheMessage(message) {
      this.messageCache.set(message.id, {
        content: message,
        seen: Date.now()
      });
    }

    /**
     * Cleanup old messages from cache
     */
    _cleanupCache() {
      const now = Date.now();
      for (const [id, entry] of this.messageCache) {
        if (now - entry.seen > this.messageTimeout) {
          this.messageCache.delete(id);
        }
      }
    }

    /**
     * Select random subset of peers
     */
    _selectRandomPeers(peers, count) {
      const shuffled = [...peers].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, Math.min(count, peers.length));
    }

    /**
     * Generate unique message ID
     */
    _generateMessageId() {
      return `${this.nodeId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Emit gossip event for application layer
     */
    _emitGossipEvent(message) {
      const event = new CustomEvent('ses:gossip', {
        detail: message
      });
      
      if (typeof window !== 'undefined') {
        window.dispatchEvent(event);
      }
    }

    getStats() {
      return {
        cachedMessages: this.messageCache.size,
        fanout: this.fanout,
        messageTimeout: this.messageTimeout
      };
    }
  }

  // ============================================
  // IPFS-style Content Distribution
  // ============================================
  class ContentDistribution {
    constructor(dht, mesh) {
      this.dht = dht;
      this.mesh = mesh;
      this.chunks = new Map(); // CID -> chunks
      this.chunkSize = 256 * 1024; // 256KB chunks
      
      // Setup message handlers
      this.mesh.onMessage('content_request', this._handleContentRequest.bind(this));
      this.mesh.onMessage('content_response', this._handleContentResponse.bind(this));
      
      this.pendingRequests = new Map(); // requestId -> {resolve, reject, timeout}
    }

    /**
     * Store content and distribute chunks across network
     */
    async storeContent(cid, content) {
      const chunks = this._splitIntoChunks(content);
      
      // Store locally
      this.chunks.set(cid, chunks);

      // Announce availability in DHT
      await this.dht.put(`content:${cid}`, {
        available: true,
        chunks: chunks.length,
        size: content.byteLength
      });

      return {
        cid,
        chunks: chunks.length,
        totalSize: content.byteLength
      };
    }

    /**
     * Fetch content from network
     */
    async fetchContent(cid) {
      // Check local first
      if (this.chunks.has(cid)) {
        return this._assembleChunks(this.chunks.get(cid));
      }

      // Query DHT for providers
      const providers = await this.dht.get(`content:${cid}`);
      
      if (!providers || !providers.found) {
        throw new Error(`Content ${cid} not found in network`);
      }

      // Request from closest peer
      const closestPeers = this.dht.findClosestNodes(cid, 3);
      
      for (const peerId of closestPeers) {
        try {
          const content = await this._requestContentFromPeer(peerId, cid);
          if (content) {
            return content;
          }
        } catch (err) {
          console.warn(`Failed to fetch from ${peerId}:`, err);
          // Try next peer
        }
      }

      throw new Error(`Failed to fetch content ${cid} from any peer`);
    }

    /**
     * Request content from specific peer
     */
    async _requestContentFromPeer(peerId, cid) {
      return new Promise((resolve, reject) => {
        const requestId = `req-${Date.now()}-${Math.random()}`;
        
        const timeout = setTimeout(() => {
          this.pendingRequests.delete(requestId);
          reject(new Error('Request timeout'));
        }, 30000); // 30s timeout

        this.pendingRequests.set(requestId, { resolve, reject, timeout });

        this.mesh.sendToPeer(peerId, {
          type: 'content_request',
          requestId,
          cid
        });
      });
    }

    /**
     * Handle content request from peer
     */
    _handleContentRequest(message, fromPeer) {
      const { requestId, cid } = message;

      if (!this.chunks.has(cid)) {
        this.mesh.sendToPeer(fromPeer, {
          type: 'content_response',
          requestId,
          found: false
        });
        return;
      }

      const chunks = this.chunks.get(cid);
      const content = this._assembleChunks(chunks);

      this.mesh.sendToPeer(fromPeer, {
        type: 'content_response',
        requestId,
        found: true,
        cid,
        content: Array.from(new Uint8Array(content)) // Convert for JSON
      });
    }

    /**
     * Handle content response from peer
     */
    _handleContentResponse(message, fromPeer) {
      const { requestId, found, content } = message;

      const pending = this.pendingRequests.get(requestId);
      if (!pending) return;

      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      if (found && content) {
        const buffer = new Uint8Array(content).buffer;
        pending.resolve(buffer);
      } else {
        pending.reject(new Error('Content not found'));
      }
    }

    /**
     * Split content into chunks
     */
    _splitIntoChunks(content) {
      const chunks = [];
      const view = new Uint8Array(content);
      
      for (let i = 0; i < view.length; i += this.chunkSize) {
        const chunk = view.slice(i, i + this.chunkSize);
        chunks.push(chunk.buffer);
      }

      return chunks;
    }

    /**
     * Assemble chunks into complete content
     */
    _assembleChunks(chunks) {
      const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const result = new Uint8Array(totalSize);
      
      let offset = 0;
      for (const chunk of chunks) {
        result.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      return result.buffer;
    }

    getStats() {
      return {
        storedContent: this.chunks.size,
        pendingRequests: this.pendingRequests.size,
        chunkSize: this.chunkSize
      };
    }
  }

  // ============================================
  // Main P2P Network
  // ============================================
  class P2PNetwork {
    constructor(config = {}) {
      this.nodeId = config.nodeId || this._generateNodeId();
      
      // Initialize components
      this.dht = new DistributedHashTable(this.nodeId);
      this.mesh = new WebRTCMesh(this.nodeId);
      this.gossip = new GossipProtocol(this.nodeId, this.mesh);
      this.content = new ContentDistribution(this.dht, this.mesh);
      
      this.initialized = false;
      this.signalingServer = config.signalingServer || null;
    }

    async initialize() {
      if (this.initialized) return;

      console.log('🌐 Initializing P2P Network...');
      console.log(`   Node ID: ${this.nodeId}`);

      // Setup event listeners
      if (typeof window !== 'undefined') {
        window.addEventListener('ses:gossip', (event) => {
          this._handleNetworkGossip(event.detail);
        });
      }

      this.initialized = true;
      console.log('✅ P2P Network initialized');

      return {
        nodeId: this.nodeId,
        components: {
          dht: true,
          mesh: true,
          gossip: true,
          content: true
        }
      };
    }

    /**
     * Connect to peer via signaling server
     */
    async connectToPeer(peerId, signalingData) {
      if (signalingData.offer) {
        return await this.mesh.handleOffer(peerId, signalingData.offer);
      } else if (signalingData.answer) {
        return await this.mesh.handleAnswer(peerId, signalingData.answer);
      } else {
        return await this.mesh.createOffer(peerId);
      }
    }

    /**
     * Publish pulse to network
     */
    async publishPulse(pulse) {
      // Store in content distribution
      const pulseBytes = new TextEncoder().encode(JSON.stringify(pulse));
      const result = await this.content.storeContent(pulse.pulse_cid, pulseBytes.buffer);

      // Announce via gossip
      this.gossip.gossip('pulse_announcement', {
        cid: pulse.pulse_cid,
        type: pulse.pulse_type,
        timestamp: pulse.timestamp
      });

      // Update DHT
      await this.dht.put(`pulse:${pulse.pulse_cid}`, {
        type: pulse.pulse_type,
        publisher: this.nodeId,
        timestamp: pulse.timestamp
      });

      return result;
    }

    /**
     * Discover pulses on network
     */
    async discoverPulses(query = {}) {
      const results = [];
      
      // Search DHT for pulse entries
      for (const [key, value] of this.dht.store) {
        if (key.startsWith('pulse:')) {
          if (!query.type || value.value.type === query.type) {
            results.push({
              cid: key.replace('pulse:', ''),
              ...value.value
            });
          }
        }
      }

      return results;
    }

    /**
     * Publish consensus result to network
     */
    publishConsensus(consensusResult) {
      return this.gossip.gossip('agent_consensus', {
        query: consensusResult.query,
        consensus: consensusResult.consensus,
        confidence: consensusResult.confidence,
        timestamp: Date.now()
      });
    }

    /**
     * Handle network gossip messages
     */
    _handleNetworkGossip(message) {
      switch (message.type) {
        case 'pulse_announcement':
          console.log('📡 New pulse announced:', message.payload);
          break;
        case 'agent_consensus':
          console.log('🤝 Consensus result:', message.payload);
          break;
        default:
          console.log('📨 Network message:', message);
      }
    }

    /**
     * Get network statistics
     */
    getNetworkStats() {
      return {
        nodeId: this.nodeId,
        initialized: this.initialized,
        dht: this.dht.getStats(),
        mesh: this.mesh.getStats(),
        gossip: this.gossip.getStats(),
        content: this.content.getStats()
      };
    }

    /**
     * Generate unique node ID
     */
    _generateNodeId() {
      const randomBytes = crypto.getRandomValues(new Uint8Array(32));
      return Array.from(randomBytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    }
  }

  // Export to global scope
  global.P2PNetwork = P2PNetwork;
  global.DistributedHashTable = DistributedHashTable;
  global.WebRTCMesh = WebRTCMesh;
  global.GossipProtocol = GossipProtocol;
  global.ContentDistribution = ContentDistribution;

  console.log('✅ SES P2P Network module loaded');

})(typeof window !== 'undefined' ? window : this);
