# SES Quick Start Guide

## Get Started in 5 Minutes

---

## Step 1: Open the Application

Simply open `index.html` in any modern browser:

```bash
# Option 1: Double-click index.html

# Option 2: Use a local server
python -m http.server 8000
# Then visit: http://localhost:8000

# Option 3: Use VS Code Live Server
# Right-click index.html → Open with Live Server
```

**No installation, no dependencies, no servers needed!**

---

## Step 2: Create Your First Pulse

1. **Select a function** from the dropdown (default: fibonacci)
2. **Enter input** in JSON format:
   ```json
   {"n": 15}
   ```
3. **Set resource bounds** using sliders:
   - Max Steps: 10,000
   - Max Memory: 10 MB
   - Max Branch Depth: 50
   - Max Time: 10 seconds

4. **Click "Create & Sign Pulse"**
   - Your identity (DID) is auto-generated
   - Pulse is signed with Ed25519
   - All data content-addressed (CID)

5. **Click "Execute"**
   - Watch resource usage in real-time
   - See execution trace
   - View all CIDs

**Result**: Your first deterministic, bounded, replayable computation!

---

## Step 3: Explore Features

### Replay & Verify
- Click "Replay" to re-execute from trace
- Click "Verify" to check signatures
- Everything is deterministic!

### AI Analysis (Optional)
- Install Ollama locally
- Click "AI Analyze" to get insights
- AI explains execution traces

### Network Sharing
- Click "Export Network" to save all data
- Share with peers
- Click "Import Network" to load shared data
- Fully peer-to-peer!

---

## Step 4: Try Advanced Features

### Contribution Economy

```javascript
// Open browser console

const graph = new ContributionGraph(sesStore);
await graph.initialize();

const contrib = await graph.addContribution({
  author: "did:key:your_did_here",
  type: "solution",
  content: "Novel approach to X",
  novelty: 0.85,
  quality: 0.90
});

console.log("Shares issued:", contrib.shares_issued);
```

### CST Tokens

```javascript
const cst = new CSTLedger(sesStore);
await cst.initialize();

const tokens = await cst.mint({
  owner: "did:key:your_did_here",
  count: 100
});

console.log("Tokens minted:", tokens.length);
```

### Context OS

```javascript
const contextOS = new ContextOS({
  store: sesStore,
  aiInterface: sesAI
});

await contextOS.initialize("did:key:your_did_here");

await contextOS.createContext("My Project");
await contextOS.addGoal("Implement feature X");
await contextOS.addNote("Remember to test edge cases");

console.log(contextOS.getContextSummary());
```

### Agent Consensus

```javascript
const consensus = new AgentConsensus({
  store: sesStore,
  aiInterface: sesAI
});

await consensus.initialize();

const result = await consensus.reason({
  subject: "some_cid_here",
  predicate: "valid"
});

console.log("Verdict:", result.verdict);
console.log("Confidence:", result.confidence);
```

### Scaffold (AI Teaching)

```javascript
const scaffold = new ScaffoldSystem(sesStore, sesAI);
await scaffold.initialize("did:key:your_did_here");

const response = await scaffold.scaffoldedRequest(
  "How do I implement feature X?"
);

console.log(response);
// Instead of direct answer, you get:
// - Guiding questions
// - Learning steps
// - Skill tracking
```

### Flow Execution

```javascript
const flowExecutor = new FlowExecutor({
  dcxRuntime: dcx,
  contentStore: contentStore,
  contextGraph: contextGraph,
  contributionGraph: contributionGraph,
  cstLedger: cstLedger,
  aiInterface: sesAI,
  agentConsensus: agentConsensus
});

const result = await flowExecutor.execute({
  workflow_id: "my_workflow",
  steps: [
    {
      id: "step1",
      type: "context_query",
      query: "recent work"
    },
    {
      id: "step2",
      type: "pulse_execution",
      input: "$step1",
      function: "builtin:process",
      bounds: { max_steps: 10000 }
    },
    {
      id: "step3",
      type: "agent_reasoning",
      claim: {
        subject: "$step2.output",
        predicate: "valid"
      }
    }
  ]
});

console.log(result);
```

---

## Step 5: Understand the Data Flow

### Everything is Content-Addressed

```
Input Data
    ↓
[CID Generated: Qm...]
    ↓
Stored in IndexedDB
    ↓
Referenced in Pulse
    ↓
Executed with Bounds
    ↓
Output CID Generated
    ↓
Trace CID Generated
    ↓
All Replayable Forever
```

### All Data Stays Local

- Your browser = sovereign node
- IndexedDB = your data store
- No servers, no clouds
- Export/import for sharing

---

## Common Workflows

### 1. Build & Verify Computation

```javascript
// 1. Create pulse
const pulse = await dcx.createPulse({
  input: data,
  function: myFunction,
  bounds: { max_steps: 10000 }
});

// 2. Execute
const result = await dcx.execute(pulse);

// 3. Verify
const verified = await sesVerify.verifyPulse(pulse);
console.log("Verified:", verified);

// 4. Replay
const replayed = await dcx.replay(pulse.trace_cid);
console.log("Matches:", replayed.output === result.output);
```

### 2. Contribute & Earn

```javascript
// 1. Add contribution
const contrib = await contributionGraph.addContribution({
  author: myDID,
  type: "solution",
  content: "My innovation",
  novelty: 0.9
});

// 2. Check shares
console.log("Shares:", contrib.shares_issued);

// 3. Later, check earnings
const stats = contributionGraph.getStats();
console.log("Total shares:", stats.total_shares);

const dist = contributionGraph.calculateRevenueDistribution(1000);
console.log("My earnings:", dist.find(d => d.did === myDID));
```

### 3. Context Switching

```javascript
// 1. Create contexts
await contextOS.createContext("Project A");
await contextOS.createContext("Project B");

// 2. Work on Project A
await contextOS.switchContext("Project A");
await contextOS.addGoal("Implement auth");
// ... do work ...

// 3. Switch to Project B
await contextOS.switchContext("Project B");
await contextOS.addGoal("Fix bug #42");
// ... do work ...

// 4. Back to Project A
await contextOS.switchContext("Project A");
// → Exactly where you left off!
```

### 4. AI-Assisted Learning

```javascript
// 1. Ask for help
const response = await scaffold.scaffoldedRequest(
  "How do I implement consensus?"
);

// 2. Get guided questions, not answers
console.log(response.questions);

// 3. Try solution
const myAttempt = "...";

// 4. Record result
await scaffold.recordAttempt(
  response.skill.skill_id,
  success: true,
  myAttempt
);

// 5. Check progress
const progress = scaffold.getOverallProgress();
console.log("Skills mastered:", progress.independent_skills);
```

---

## Troubleshooting

### Issue: "AI not available"
**Solution**: Install Ollama locally or disable AI features

### Issue: "Storage quota exceeded"
**Solution**: Export old data, clear IndexedDB, import what you need

### Issue: "Pulse execution failed"
**Solution**: Check resource bounds, increase if needed

### Issue: "Import failed"
**Solution**: Ensure JSON format is correct, check file encoding

---

## Next Steps

1. **Read the spec**: `SOVEREIGN_EXECUTION_SUBSTRATE.md`
2. **Explore the code**: All modules in `ses/` directory
3. **Run tests**: `TestRunner` in browser console
4. **Build something**: Use the APIs to create your own apps
5. **Contribute**: Your work becomes equity in the system!

---

## Key Concepts to Remember

1. **Everything is a Pulse** - All state changes from pulses
2. **Everything is Bounded** - No unbounded execution
3. **Everything is Replayable** - Full deterministic replay
4. **Everything is Content-Addressed** - CIDs guarantee integrity
5. **Everything is Verifiable** - Cryptographic proofs
6. **Everything is Fair** - Shapley values for attribution

---

## Documentation

- `README.md` - Overview
- `IMPLEMENTATION_SUMMARY.md` - Detailed mapping
- `CHANGELOG.md` - What's new
- `QUICK_START.md` - This guide
- JSDoc comments in every module

---

## Support

- GitHub Issues for bugs
- GitHub Discussions for questions
- Check the test suite for examples
- Read module comments for API docs

---

**You're now ready to use SES!**

**This is computing as it should have been.**

🚀 Happy Building!
