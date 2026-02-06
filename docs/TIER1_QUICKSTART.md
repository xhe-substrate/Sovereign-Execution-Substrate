# SES TIER 1: Quick Start Guide

## 🎯 What is TIER 1?

TIER 1 transforms SES from a single-user browser app into a **truly distributed, production-ready platform** with:

1. **P2P Network** - Decentralized content distribution and discovery
2. **Commons Platform** - Full-featured contribution economy UI
3. **Desktop Integration** - OS-level context capture for zero-cost context switching

## 🚀 Quick Start (5 minutes)

### Option 1: Browser-Only (Try Immediately)

```bash
# No installation needed!
# Just open index.html in your browser

# The P2P network will initialize automatically
# Commons platform features available in console
```

### Option 2: Desktop App (Full Experience)

```bash
# Install dependencies
npm install

# Run desktop app
npm run dev

# Or build for your platform
npm run build:mac      # macOS
npm run build:win      # Windows  
npm run build:linux    # Linux
```

### Option 3: VS Code Extension (For Developers)

```bash
cd vscode-extension
npm install

# Open vscode-extension folder in VS Code
# Press F5 to launch Extension Development Host

# Or package for installation
npx vsce package
```

## 📡 Using the P2P Network

### Initialize Network

```javascript
// Automatically initialized when you load the page
// Or manually:
const p2p = new P2PNetwork();
await p2p.initialize();

console.log('Node ID:', p2p.nodeId);
```

### Connect to Peers

```javascript
// Create connection offer
const offer = await p2p.mesh.createOffer('peer-id-here');

// Share offer via your signaling mechanism
// (email, chat, QR code, etc.)

// Receive answer and complete connection
await p2p.mesh.handleAnswer('peer-id-here', answer);
```

### Share Pulses

```javascript
// Publish a pulse to the network
const pulse = await sesRuntime.executePulse(/* ... */);
await p2p.publishPulse(pulse);

// Discover pulses on network
const pulses = await p2p.discoverPulses({
  type: 'computation'
});

console.log(`Found ${pulses.length} pulses`);
```

### Share Consensus Results

```javascript
// Agent consensus results automatically propagate
p2p.publishConsensus({
  query: 'Is this code correct?',
  consensus: 'yes',
  confidence: 0.85
});

// Listen for network consensus
window.addEventListener('ses:gossip', (event) => {
  if (event.detail.type === 'agent_consensus') {
    console.log('Network consensus:', event.detail.payload);
  }
});
```

### Network Stats

```javascript
const stats = p2p.getNetworkStats();
console.log(`Connected to ${stats.mesh.connectedPeers} peers`);
console.log(`Network coverage: ${stats.dht.coverage}`);
```

## 🏛️ Using the Commons Platform

### Initialize Platform

```javascript
const commons = new CommonsPlatform({
  store: sesStore,
  contributionGraph: contributionGraph,
  shapley: shapleyEngine,
  cst: cstManager
});

await commons.initialize(userDID);
```

### Browse Contributions

```javascript
// Search for contributions
const results = await commons.browser.search('machine learning', {
  type: 'code',
  author: 'did:ses:alice',
  tags: ['ml', 'python'],
  minValue: 100
});

console.log(`Found ${results.count} contributions`);

// Get trending contributions
const trending = await commons.browser.getTrending('7d');
```

### Create Project Spaces

```javascript
// Create a project
const project = await commons.projects.createSpace(
  'ML Pipeline',
  'Production ML infrastructure',
  {
    visibility: 'public',
    allowContributions: true,
    revenueSharing: 'shapley'
  }
);

// Add contributions to project
await commons.projects.addContributionToSpace(
  project.id,
  contributionCid
);

// Get project stats
const stats = await commons.projects.getSpaceStats(project.id);
console.log(`Total value: ${stats.totalValue} CST`);
```

### Track Revenue

```javascript
// Record revenue from contribution
await commons.revenue.recordRevenue(
  contributionCid,
  1000, // amount in CST
  'API usage'
);

// Get your total revenue
const myRevenue = await commons.revenue.getUserRevenue();
console.log(`Total revenue: ${myRevenue} CST`);

// Get revenue timeline
const timeline = await commons.revenue.getRevenueTimeline('30d');

// Get top earning contributions
const topEarners = await commons.revenue.getTopEarners(10);
```

### Visualize Dependencies

```javascript
// Generate graph data for visualization
const graphData = await commons.graphViewer.generateGraphData(
  rootCid,
  3 // depth
);

console.log(`Graph has ${graphData.nodes.length} nodes`);
console.log(`and ${graphData.edges.length} edges`);

// Find critical path
const criticalPath = await commons.graphViewer.getCriticalPath(rootCid);
console.log(`Critical path value: ${criticalPath.totalValue} CST`);
```

### Trade Shares

```javascript
// Create listing
const listing = await commons.marketplace.createListing(
  contributionCid,
  100, // shares to sell
  10   // price per share in CST
);

// Buy shares
const trade = await commons.marketplace.buyShares(
  listingId,
  50 // number of shares
);

// View marketplace
const activeListings = await commons.marketplace.getActiveListings();
const stats = await commons.marketplace.getMarketplaceStats();
```

## 🖥️ Desktop Integration

### Electron App

```javascript
// Available in renderer process via window.electronAPI

// Read file
const result = await window.electronAPI.fs.readFile('/path/to/file.txt');
console.log(result.content);

// Watch for file changes
window.electronAPI.on.fileModified((filepath) => {
  console.log('File changed:', filepath);
});

// Monitor clipboard
window.electronAPI.clipboard.onChange((data) => {
  console.log('Clipboard:', data.text);
});

// Get system info
const info = await window.electronAPI.system.getInfo();
console.log('Home dir:', info.home);
```

### VS Code Extension

```
Use Command Palette (Cmd/Ctrl + Shift + P):

- "SES: Capture Current Context"
- "SES: Switch Context"  
- "SES: Save Workspace"
- "SES: View All Contexts"

Or use keyboard shortcuts:
- Cmd/Ctrl + Shift + S: Capture context
- Cmd/Ctrl + Shift + C: Switch context
```

### Browser Extension

```
Click extension icon to:
- Capture current browser state (tabs, history)
- Save context with custom name
- Switch between saved contexts
- View context history

Global shortcuts:
- Cmd/Ctrl + Shift + S: Quick capture
- Cmd/Ctrl + Shift + C: Quick switch
```

## 🎯 Common Workflows

### Workflow 1: Distributed Development

```javascript
// 1. Start local node
const p2p = new P2PNetwork();
await p2p.initialize();

// 2. Connect to team member
const offer = await p2p.connectToPeer(teammatePeerId);
// Share offer via chat

// 3. Create and share contribution
const contribution = await contributionGraph.addContribution({
  name: 'Auth Module',
  type: 'code',
  // ...
});

await p2p.publishPulse(contribution.pulse);

// 4. Teammate discovers and uses it
const pulses = await p2p.discoverPulses({ type: 'code' });
```

### Workflow 2: Revenue Tracking

```javascript
// 1. Create project
const project = await commons.projects.createSpace('API v2');

// 2. Add contributions
await commons.projects.addContributionToSpace(project.id, cid1);
await commons.projects.addContributionToSpace(project.id, cid2);

// 3. Record revenue as it comes in
await commons.revenue.recordRevenue(cid1, 500, 'API calls');

// 4. View attribution
const breakdown = await commons.revenue.getRevenueByContribution();
// Shapley values automatically calculated!

// 5. Pay contributors
// Revenue automatically split based on Shapley values
```

### Workflow 3: Zero-Cost Context Switching

```javascript
// In VS Code:

// Working on Feature A
// Cmd+Shift+S to capture "Feature A Context"

// Switch to urgent bugfix
// Cmd+Shift+C, select "Bugfix Context"
// All files, breakpoints, terminal state restored!

// Return to Feature A
// Cmd+Shift+C, select "Feature A Context"
// Exactly where you left off, zero overhead
```

## 📊 Monitoring & Stats

### Network Health

```javascript
// Check P2P network status
const p2pStats = p2p.getNetworkStats();

console.log(`
Connected Peers: ${p2pStats.mesh.connectedPeers}
DHT Coverage: ${p2pStats.dht.coverage}
Stored Content: ${p2pStats.content.storedContent}
Gossip Messages: ${p2pStats.gossip.cachedMessages}
`);
```

### Platform Activity

```javascript
// Commons platform stats
const trending = await commons.browser.getTrending('7d');
const marketStats = await commons.marketplace.getMarketplaceStats();

console.log(`
Trending Contributions: ${trending.length}
Active Listings: ${marketStats.activeListings}
Total Volume: ${marketStats.totalVolume} CST
Recent Trades: ${marketStats.recentTrades}
`);
```

### Context OS Status

```javascript
// Desktop integration status
const desktop = new DesktopIntegration();
await desktop.initialize();

const status = desktop.getStatus();
console.log(`
OS Integration: ${status.components.os}
IDE Integration: ${status.components.ide}
Browser Integration: ${status.components.browser}
`);
```

## 🐛 Troubleshooting

### P2P Connection Issues

```javascript
// Check if peers are connected
const stats = p2p.mesh.getStats();
if (stats.connectedPeers === 0) {
  console.log('No peers connected');
  console.log('Connection states:', stats.peers);
}

// Verify DHT is working
const dhtStats = p2p.dht.getStats();
console.log(`DHT has ${dhtStats.peers} peers`);
```

### Desktop App Issues

```bash
# Run with dev tools
npm run dev

# Check console for errors
# Check Network tab for WebRTC connections
```

### VS Code Extension Issues

```
1. Open Command Palette
2. "Developer: Reload Window"
3. Check "Output" panel > "SES Context OS"
4. File issue with logs
```

## 📚 Next Steps

Now that you have TIER 1 running:

1. **Connect with others** - Form a P2P network with team members
2. **Track contributions** - Let Shapley values attribute value automatically
3. **Use Context OS** - Experience true zero-cost context switching
4. **Explore TIER 2** - Flow Marketplace, Scaffold IDE, Pulse Debugger

## 🤝 Getting Help

- Check `TIER1_IMPLEMENTATION.md` for detailed documentation
- Review code comments in `ses-p2p-network.js`, `ses-commons-platform.js`
- Open issues on GitHub
- Join community discussions

## ✅ Quick Verification

Run this in browser console to verify everything works:

```javascript
// Should all return without errors
const p2p = new P2PNetwork();
await p2p.initialize();

const commons = new CommonsPlatform({ /* ... */ });
await commons.initialize('did:ses:test');

const desktop = new DesktopIntegration();
await desktop.initialize();

console.log('✅ All TIER 1 components initialized!');
```

---

**You're now running the complete TIER 1 infrastructure!** 🎉

The transformation from single-user to distributed platform is complete.
