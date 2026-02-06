/**
 * SES-TRACE-ANALYZER.JS - Enhanced Trace Analysis System
 * Sovereign Execution Substrate - Layer 3
 * 
 * Analyzes execution traces for:
 * - Resource efficiency (actual vs bounds usage)
 * - Optimization opportunities
 * - Anomaly detection
 * - Visualization data generation
 * 
 * @version 1.0.0
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // VERSION
  // ============================================
  const ANALYZER_VERSION = '1.0.0';

  // ============================================
  // EFFICIENCY METRICS
  // ============================================
  class EfficiencyMetrics {
    constructor() {
      this.stepEfficiency = 0;
      this.memoryEfficiency = 0;
      this.branchEfficiency = 0;
      this.timeEfficiency = 0;
      this.overallScore = 0;
      this.grade = 'F';
      this.recommendations = [];
    }

    calculate(trace, bounds) {
      // Step efficiency: (used / allowed) as percentage
      this.stepEfficiency = bounds.maxSteps > 0 
        ? (trace.totalSteps / bounds.maxSteps) * 100 
        : 0;
      
      // Memory efficiency
      this.memoryEfficiency = bounds.maxMemoryBytes > 0 
        ? (trace.peakMemory / bounds.maxMemoryBytes) * 100 
        : 0;
      
      // Branch efficiency
      this.branchEfficiency = bounds.maxBranchDepth > 0 
        ? (trace.maxBranchDepth / bounds.maxBranchDepth) * 100 
        : 0;

      // Time efficiency (if available)
      if (trace.startTime && trace.endTime) {
        const elapsed = new Date(trace.endTime) - new Date(trace.startTime);
        this.timeEfficiency = bounds.maxExecutionMs > 0 
          ? (elapsed / bounds.maxExecutionMs) * 100 
          : 0;
      }

      // Overall score (weighted average, lower is better for resource usage)
      const weights = { steps: 0.4, memory: 0.3, branches: 0.2, time: 0.1 };
      const resourceUsage = 
        (this.stepEfficiency * weights.steps) +
        (this.memoryEfficiency * weights.memory) +
        (this.branchEfficiency * weights.branches) +
        (this.timeEfficiency * weights.time);
      
      // Efficiency score: 100 - resource usage (higher is better)
      // But also penalize very low usage (wasted bounds)
      const utilizationPenalty = resourceUsage < 10 ? (10 - resourceUsage) : 0;
      this.overallScore = Math.max(0, 100 - resourceUsage - utilizationPenalty);

      // Grade based on score
      if (this.overallScore >= 90) this.grade = 'A';
      else if (this.overallScore >= 80) this.grade = 'B';
      else if (this.overallScore >= 70) this.grade = 'C';
      else if (this.overallScore >= 60) this.grade = 'D';
      else this.grade = 'F';

      // Generate recommendations
      this.generateRecommendations(trace, bounds);

      return this;
    }

    generateRecommendations(trace, bounds) {
      this.recommendations = [];

      // Step recommendations
      if (this.stepEfficiency > 90) {
        this.recommendations.push({
          type: 'warning',
          category: 'steps',
          message: 'Near step limit - consider increasing maxSteps or optimizing algorithm',
          severity: 'high'
        });
      } else if (this.stepEfficiency < 10) {
        this.recommendations.push({
          type: 'optimization',
          category: 'steps',
          message: `Bounds overestimated: only ${this.stepEfficiency.toFixed(1)}% steps used. Consider reducing maxSteps to ${Math.ceil(trace.totalSteps * 1.5)}`,
          severity: 'low'
        });
      }

      // Memory recommendations
      if (this.memoryEfficiency > 90) {
        this.recommendations.push({
          type: 'warning',
          category: 'memory',
          message: 'Near memory limit - consider increasing maxMemoryBytes',
          severity: 'high'
        });
      } else if (this.memoryEfficiency < 10 && bounds.maxMemoryBytes > 1024 * 1024) {
        this.recommendations.push({
          type: 'optimization',
          category: 'memory',
          message: `Memory bounds overestimated: only ${this.memoryEfficiency.toFixed(1)}% used. Consider reducing maxMemoryBytes`,
          severity: 'low'
        });
      }

      // Branch recommendations
      if (this.branchEfficiency > 80) {
        this.recommendations.push({
          type: 'warning',
          category: 'branches',
          message: 'High branch depth usage - possible deep recursion',
          severity: 'medium'
        });
      }

      // Time recommendations
      if (this.timeEfficiency > 80) {
        this.recommendations.push({
          type: 'warning',
          category: 'time',
          message: 'Near time limit - consider optimizing or increasing timeout',
          severity: 'high'
        });
      }
    }

    toJSON() {
      return {
        stepEfficiency: this.stepEfficiency,
        memoryEfficiency: this.memoryEfficiency,
        branchEfficiency: this.branchEfficiency,
        timeEfficiency: this.timeEfficiency,
        overallScore: this.overallScore,
        grade: this.grade,
        recommendations: this.recommendations
      };
    }
  }

  // ============================================
  // ANOMALY DETECTOR
  // ============================================
  class AnomalyDetector {
    constructor(options = {}) {
      this.thresholds = {
        stepRateSpike: options.stepRateSpike || 2.0,      // 2x average
        memorySpike: options.memorySpike || 1.5,          // 50% increase
        longOperation: options.longOperation || 100,       // ms
        infiniteLoopSteps: options.infiniteLoopSteps || 1000
      };
    }

    detectAnomalies(trace) {
      const anomalies = [];

      if (!trace.steps || trace.steps.length === 0) {
        return anomalies;
      }

      // Analyze step patterns
      const stepRates = this.calculateStepRates(trace.steps);
      const avgRate = stepRates.reduce((a, b) => a + b, 0) / stepRates.length;

      // Detect step rate spikes
      stepRates.forEach((rate, i) => {
        if (rate > avgRate * this.thresholds.stepRateSpike) {
          anomalies.push({
            type: 'stepRateSpike',
            tick: trace.steps[i]?.tick || i,
            severity: 'medium',
            details: { rate, average: avgRate, threshold: this.thresholds.stepRateSpike }
          });
        }
      });

      // Detect memory spikes
      let prevMemory = 0;
      trace.steps.forEach((step, i) => {
        if (step.memory && prevMemory > 0) {
          const increase = step.memory / prevMemory;
          if (increase > this.thresholds.memorySpike) {
            anomalies.push({
              type: 'memorySpike',
              tick: step.tick,
              severity: 'high',
              details: { before: prevMemory, after: step.memory, increase }
            });
          }
        }
        prevMemory = step.memory || prevMemory;
      });

      // Detect potential infinite loops (repeated operations)
      const operationCounts = new Map();
      trace.steps.forEach(step => {
        const key = `${step.operation}:${JSON.stringify(step.args)}`;
        operationCounts.set(key, (operationCounts.get(key) || 0) + 1);
      });

      operationCounts.forEach((count, key) => {
        if (count > this.thresholds.infiniteLoopSteps) {
          anomalies.push({
            type: 'potentialInfiniteLoop',
            severity: 'high',
            details: { operation: key.split(':')[0], count, threshold: this.thresholds.infiniteLoopSteps }
          });
        }
      });

      // Detect determinism violations
      const deterministicViolations = this.checkDeterminism(trace);
      anomalies.push(...deterministicViolations);

      return anomalies;
    }

    calculateStepRates(steps) {
      const windowSize = Math.max(1, Math.floor(steps.length / 10));
      const rates = [];

      for (let i = 0; i < steps.length; i += windowSize) {
        const window = steps.slice(i, i + windowSize);
        rates.push(window.length / windowSize);
      }

      return rates;
    }

    checkDeterminism(trace) {
      const violations = [];

      // Check for wall-clock dependencies
      trace.steps.forEach(step => {
        const op = (step.operation || '').toLowerCase();
        const args = JSON.stringify(step.args || {}).toLowerCase();

        if (op.includes('date') || op.includes('now') || args.includes('date')) {
          violations.push({
            type: 'wallClockDependency',
            tick: step.tick,
            severity: 'critical',
            details: { operation: step.operation }
          });
        }

        if (op.includes('random') || args.includes('random')) {
          violations.push({
            type: 'randomnessDependency',
            tick: step.tick,
            severity: 'critical',
            details: { operation: step.operation }
          });
        }
      });

      return violations;
    }
  }

  // ============================================
  // VISUALIZATION DATA GENERATOR
  // ============================================
  class VisualizationGenerator {
    constructor() {
      this.colors = {
        steps: '#00d4aa',
        memory: '#00a8ff',
        branches: '#ffaa00',
        time: '#aa66ff'
      };
    }

    /**
     * Generate flame graph data from trace
     */
    generateFlameGraph(trace) {
      const nodes = [];
      const stack = [];
      let currentDepth = 0;

      trace.steps.forEach((step, index) => {
        // Track depth based on operation patterns
        if (step.operation?.includes('enter') || step.operation?.includes('start')) {
          currentDepth++;
        }

        nodes.push({
          id: index,
          name: step.operation || 'unknown',
          depth: currentDepth,
          value: 1,
          tick: step.tick,
          memory: step.memory || 0
        });

        if (step.operation?.includes('exit') || step.operation?.includes('end')) {
          currentDepth = Math.max(0, currentDepth - 1);
        }
      });

      return {
        type: 'flameGraph',
        nodes: nodes,
        maxDepth: Math.max(...nodes.map(n => n.depth), 0),
        totalSteps: trace.totalSteps
      };
    }

    /**
     * Generate branch depth tree visualization
     */
    generateBranchTree(trace) {
      const tree = {
        name: 'root',
        depth: 0,
        children: [],
        steps: []
      };

      let currentNode = tree;
      const nodeStack = [tree];

      trace.steps.forEach(step => {
        if (step.operation?.includes('enterBranch') || step.operation?.includes('recurse')) {
          const newNode = {
            name: step.operation,
            depth: nodeStack.length,
            children: [],
            steps: [step]
          };
          currentNode.children.push(newNode);
          nodeStack.push(newNode);
          currentNode = newNode;
        } else if (step.operation?.includes('exitBranch')) {
          nodeStack.pop();
          currentNode = nodeStack[nodeStack.length - 1] || tree;
        } else {
          currentNode.steps.push(step);
        }
      });

      return {
        type: 'branchTree',
        tree: tree,
        maxDepth: trace.maxBranchDepth
      };
    }

    /**
     * Generate memory allocation timeline
     */
    generateMemoryTimeline(trace) {
      const timeline = [];
      let runningMemory = 0;

      trace.steps.forEach((step, index) => {
        if (step.memory !== undefined) {
          runningMemory = step.memory;
        }

        timeline.push({
          tick: step.tick || index,
          memory: runningMemory,
          operation: step.operation
        });
      });

      return {
        type: 'memoryTimeline',
        data: timeline,
        peakMemory: trace.peakMemory,
        totalPoints: timeline.length
      };
    }

    /**
     * Generate operation frequency chart
     */
    generateOperationFrequency(trace) {
      const frequency = new Map();

      trace.steps.forEach(step => {
        const op = step.operation || 'unknown';
        frequency.set(op, (frequency.get(op) || 0) + 1);
      });

      const data = Array.from(frequency.entries())
        .map(([name, count]) => ({ name, count, percentage: (count / trace.totalSteps) * 100 }))
        .sort((a, b) => b.count - a.count);

      return {
        type: 'operationFrequency',
        data: data,
        uniqueOperations: data.length,
        totalSteps: trace.totalSteps
      };
    }

    /**
     * Generate all visualizations
     */
    generateAll(trace) {
      return {
        flameGraph: this.generateFlameGraph(trace),
        branchTree: this.generateBranchTree(trace),
        memoryTimeline: this.generateMemoryTimeline(trace),
        operationFrequency: this.generateOperationFrequency(trace)
      };
    }
  }

  // ============================================
  // MAIN TRACE ANALYZER
  // ============================================
  class TraceAnalyzer {
    constructor(options = {}) {
      this.options = options;
      this.anomalyDetector = new AnomalyDetector(options.anomaly || {});
      this.visualizationGenerator = new VisualizationGenerator();
    }

    /**
     * Analyze resource efficiency
     */
    analyzeResourceEfficiency(trace, bounds) {
      const metrics = new EfficiencyMetrics();
      return metrics.calculate(trace, bounds);
    }

    /**
     * Detect anomalies in trace
     */
    detectAnomalies(trace) {
      return this.anomalyDetector.detectAnomalies(trace);
    }

    /**
     * Generate visualizations
     */
    visualizeExecution(trace) {
      return this.visualizationGenerator.generateAll(trace);
    }

    /**
     * Full analysis report
     */
    analyze(pulse, trace) {
      const bounds = pulse.bounds || {};

      return {
        version: ANALYZER_VERSION,
        timestamp: new Date().toISOString(),
        pulseId: pulse.pulseId,
        summary: {
          totalSteps: trace.totalSteps,
          peakMemory: trace.peakMemory,
          maxBranchDepth: trace.maxBranchDepth,
          duration: trace.startTime && trace.endTime 
            ? new Date(trace.endTime) - new Date(trace.startTime) 
            : null
        },
        efficiency: this.analyzeResourceEfficiency(trace, bounds),
        anomalies: this.detectAnomalies(trace),
        visualizations: this.visualizeExecution(trace),
        determinism: {
          hasDeterministicSeed: !!trace.deterministicSeed,
          seedMatchesInput: trace.deterministicSeed === pulse.inputCid
        }
      };
    }

    /**
     * Compare two traces for drift
     */
    compareTraces(trace1, trace2) {
      const drift = {
        stepCountDiff: trace2.totalSteps - trace1.totalSteps,
        memoryDiff: trace2.peakMemory - trace1.peakMemory,
        branchDiff: trace2.maxBranchDepth - trace1.maxBranchDepth,
        operationDrift: []
      };

      // Compare operation sequences
      const minLen = Math.min(trace1.steps?.length || 0, trace2.steps?.length || 0);
      for (let i = 0; i < minLen; i++) {
        if (trace1.steps[i].operation !== trace2.steps[i].operation) {
          drift.operationDrift.push({
            tick: i,
            expected: trace1.steps[i].operation,
            actual: trace2.steps[i].operation
          });
        }
      }

      drift.isDeterministic = 
        drift.stepCountDiff === 0 && 
        drift.operationDrift.length === 0;

      return drift;
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const TraceAnalyzerModule = Object.freeze({
    VERSION: ANALYZER_VERSION,
    TraceAnalyzer: TraceAnalyzer,
    EfficiencyMetrics: EfficiencyMetrics,
    AnomalyDetector: AnomalyDetector,
    VisualizationGenerator: VisualizationGenerator,
    // Factory function
    create: (options) => new TraceAnalyzer(options)
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = TraceAnalyzerModule;
  } else if (typeof root !== 'undefined') {
    root.TraceAnalyzerModule = TraceAnalyzerModule;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
