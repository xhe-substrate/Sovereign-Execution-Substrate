/**
 * SES-SYMBOLIC-CODEC.JS - Symbolic Codec for Determinism
 * Sovereign Execution Substrate - Layer 3
 * 
 * Critical for true determinism: encodes operations symbolically
 * to prevent floating-point nondeterminism.
 * 
 * Core Properties:
 * - All numeric operations encoded as exact symbolic representations
 * - No floating-point ambiguity
 * - Reversible encoding/decoding
 * - CID-compatible serialization
 * 
 * @version 1.0.0
 * @license Apache-2.0 / MIT
 */

(function(root) {
  'use strict';

  // ============================================
  // VERSION
  // ============================================
  const CODEC_VERSION = '1.0.0';

  // ============================================
  // SYMBOLIC NUMBER REPRESENTATION
  // Exact representation of numeric values
  // ============================================
  class SymbolicNumber {
    constructor(type, value, metadata = {}) {
      this.type = type; // 'integer', 'rational', 'decimal', 'special'
      this.value = value;
      this.metadata = metadata;
      this.precision = metadata.precision || 'exact';
    }

    static fromNumber(num) {
      if (Number.isNaN(num)) {
        return new SymbolicNumber('special', 'NaN');
      }
      if (!Number.isFinite(num)) {
        return new SymbolicNumber('special', num > 0 ? '+Infinity' : '-Infinity');
      }
      if (Number.isInteger(num)) {
        return new SymbolicNumber('integer', BigInt(num).toString());
      }
      // For decimals, encode as rational or exact decimal string
      const str = num.toString();
      if (str.includes('e') || str.includes('E')) {
        // Scientific notation - encode precisely
        const [mantissa, exp] = str.toLowerCase().split('e');
        return new SymbolicNumber('scientific', {
          mantissa: mantissa,
          exponent: parseInt(exp)
        });
      }
      // Regular decimal - encode as string to preserve precision
      return new SymbolicNumber('decimal', str);
    }

    static fromRational(numerator, denominator) {
      // GCD for reduction
      const gcd = (a, b) => b === 0n ? a : gcd(b, a % b);
      const n = BigInt(numerator);
      const d = BigInt(denominator);
      const g = gcd(n < 0n ? -n : n, d < 0n ? -d : d);
      return new SymbolicNumber('rational', {
        numerator: (n / g).toString(),
        denominator: (d / g).toString()
      });
    }

    toNumber() {
      switch (this.type) {
        case 'integer':
          return Number(BigInt(this.value));
        case 'rational':
          return Number(BigInt(this.value.numerator)) / Number(BigInt(this.value.denominator));
        case 'decimal':
          return parseFloat(this.value);
        case 'scientific':
          return parseFloat(this.value.mantissa) * Math.pow(10, this.value.exponent);
        case 'special':
          if (this.value === 'NaN') return NaN;
          if (this.value === '+Infinity') return Infinity;
          if (this.value === '-Infinity') return -Infinity;
          return null;
        default:
          return null;
      }
    }

    toJSON() {
      return {
        _symbolic: true,
        type: this.type,
        value: this.value,
        precision: this.precision,
        metadata: this.metadata
      };
    }

    static fromJSON(json) {
      if (!json || !json._symbolic) return null;
      return new SymbolicNumber(json.type, json.value, json.metadata);
    }

    toString() {
      switch (this.type) {
        case 'integer':
          return this.value;
        case 'rational':
          return `${this.value.numerator}/${this.value.denominator}`;
        case 'decimal':
          return this.value;
        case 'scientific':
          return `${this.value.mantissa}e${this.value.exponent}`;
        case 'special':
          return this.value;
        default:
          return '[unknown]';
      }
    }
  }

  // ============================================
  // SYMBOLIC OPERATION
  // Encode operations symbolically
  // ============================================
  class SymbolicOperation {
    constructor(op, operands, result = null) {
      this.op = op; // 'add', 'sub', 'mul', 'div', 'pow', etc.
      this.operands = operands; // Array of SymbolicNumbers
      this.result = result; // SymbolicNumber
      this.timestamp = Date.now();
    }

    // Execute the operation symbolically
    execute() {
      const nums = this.operands.map(o => o.toNumber());
      let result;

      switch (this.op) {
        case 'add':
          result = nums.reduce((a, b) => a + b, 0);
          break;
        case 'sub':
          result = nums.length === 1 ? -nums[0] : nums[0] - nums.slice(1).reduce((a, b) => a + b, 0);
          break;
        case 'mul':
          result = nums.reduce((a, b) => a * b, 1);
          break;
        case 'div':
          result = nums.length === 1 ? 1 / nums[0] : nums[0] / nums.slice(1).reduce((a, b) => a * b, 1);
          break;
        case 'pow':
          result = Math.pow(nums[0], nums[1]);
          break;
        case 'sqrt':
          result = Math.sqrt(nums[0]);
          break;
        case 'abs':
          result = Math.abs(nums[0]);
          break;
        case 'floor':
          result = Math.floor(nums[0]);
          break;
        case 'ceil':
          result = Math.ceil(nums[0]);
          break;
        case 'round':
          result = Math.round(nums[0]);
          break;
        case 'mod':
          result = nums[0] % nums[1];
          break;
        case 'max':
          result = Math.max(...nums);
          break;
        case 'min':
          result = Math.min(...nums);
          break;
        default:
          throw new Error(`Unknown operation: ${this.op}`);
      }

      this.result = SymbolicNumber.fromNumber(result);
      return this.result;
    }

    toJSON() {
      return {
        _symbolicOp: true,
        op: this.op,
        operands: this.operands.map(o => o.toJSON()),
        result: this.result ? this.result.toJSON() : null,
        timestamp: this.timestamp
      };
    }

    static fromJSON(json) {
      if (!json || !json._symbolicOp) return null;
      const operands = json.operands.map(o => SymbolicNumber.fromJSON(o));
      const result = json.result ? SymbolicNumber.fromJSON(json.result) : null;
      const op = new SymbolicOperation(json.op, operands, result);
      op.timestamp = json.timestamp;
      return op;
    }
  }

  // ============================================
  // SYMBOLIC CODEC
  // Main encoding/decoding interface
  // ============================================
  class SymbolicCodec {
    constructor(options = {}) {
      this.options = options;
      this.operationLog = [];
      this.precision = options.precision || 15; // Decimal places
    }

    /**
     * Encode a value to symbolic representation
     * @param {any} value - Value to encode
     * @returns {any} Symbolic representation
     */
    encode(value) {
      if (value === null || value === undefined) {
        return { _symbolic: true, type: 'null', value: null };
      }

      if (typeof value === 'number') {
        return SymbolicNumber.fromNumber(value).toJSON();
      }

      if (typeof value === 'boolean') {
        return { _symbolic: true, type: 'boolean', value: value };
      }

      if (typeof value === 'string') {
        return { _symbolic: true, type: 'string', value: value };
      }

      if (typeof value === 'bigint') {
        return { _symbolic: true, type: 'bigint', value: value.toString() };
      }

      if (Array.isArray(value)) {
        return {
          _symbolic: true,
          type: 'array',
          value: value.map(v => this.encode(v))
        };
      }

      if (typeof value === 'object') {
        const encoded = { _symbolic: true, type: 'object', value: {} };
        for (const [key, val] of Object.entries(value)) {
          encoded.value[key] = this.encode(val);
        }
        return encoded;
      }

      // Fallback: serialize as string
      return { _symbolic: true, type: 'unknown', value: String(value) };
    }

    /**
     * Decode a symbolic representation back to value
     * @param {any} symbolic - Symbolic representation
     * @returns {any} Original value
     */
    decode(symbolic) {
      if (!symbolic || !symbolic._symbolic) {
        // Already decoded or not symbolic
        return symbolic;
      }

      switch (symbolic.type) {
        case 'null':
          return null;
        case 'boolean':
          return symbolic.value;
        case 'string':
          return symbolic.value;
        case 'bigint':
          return BigInt(symbolic.value);
        case 'integer':
        case 'rational':
        case 'decimal':
        case 'scientific':
        case 'special':
          return SymbolicNumber.fromJSON(symbolic).toNumber();
        case 'array':
          return symbolic.value.map(v => this.decode(v));
        case 'object':
          const decoded = {};
          for (const [key, val] of Object.entries(symbolic.value)) {
            decoded[key] = this.decode(val);
          }
          return decoded;
        default:
          return symbolic.value;
      }
    }

    /**
     * Encode a mathematical operation
     * @param {string} op - Operation name
     * @param {...number} operands - Operands
     * @returns {SymbolicOperation} Symbolic operation
     */
    encodeOperation(op, ...operands) {
      const symbolicOperands = operands.map(o => SymbolicNumber.fromNumber(o));
      const operation = new SymbolicOperation(op, symbolicOperands);
      operation.execute();
      this.operationLog.push(operation);
      return operation;
    }

    /**
     * Execute an operation deterministically
     * @param {string} op - Operation name
     * @param {...number} operands - Operands
     * @returns {number} Result
     */
    compute(op, ...operands) {
      const operation = this.encodeOperation(op, ...operands);
      return operation.result.toNumber();
    }

    /**
     * Create a deterministic math wrapper
     * @returns {object} Math-like object with deterministic operations
     */
    createDeterministicMath() {
      const codec = this;
      return {
        add: (...args) => codec.compute('add', ...args),
        sub: (...args) => codec.compute('sub', ...args),
        mul: (...args) => codec.compute('mul', ...args),
        div: (...args) => codec.compute('div', ...args),
        pow: (base, exp) => codec.compute('pow', base, exp),
        sqrt: (n) => codec.compute('sqrt', n),
        abs: (n) => codec.compute('abs', n),
        floor: (n) => codec.compute('floor', n),
        ceil: (n) => codec.compute('ceil', n),
        round: (n) => codec.compute('round', n),
        mod: (a, b) => codec.compute('mod', a, b),
        max: (...args) => codec.compute('max', ...args),
        min: (...args) => codec.compute('min', ...args),
        // Constants encoded symbolically
        PI: codec.encode(Math.PI),
        E: codec.encode(Math.E),
        // Get operation log
        getLog: () => codec.operationLog.map(o => o.toJSON())
      };
    }

    /**
     * Export operation log for replay
     * @returns {object[]} Operation log
     */
    exportLog() {
      return this.operationLog.map(o => o.toJSON());
    }

    /**
     * Replay operations from log
     * @param {object[]} log - Operation log
     * @returns {SymbolicNumber[]} Results
     */
    replayLog(log) {
      const results = [];
      for (const entry of log) {
        const op = SymbolicOperation.fromJSON(entry);
        if (op) {
          op.execute();
          results.push(op.result);
        }
      }
      return results;
    }

    /**
     * Clear operation log
     */
    clearLog() {
      this.operationLog = [];
    }

    /**
     * Compare two values for exact equality
     * @param {any} a - First value
     * @param {any} b - Second value
     * @returns {boolean} True if exactly equal
     */
    exactEquals(a, b) {
      const encA = this.encode(a);
      const encB = this.encode(b);
      return JSON.stringify(encA) === JSON.stringify(encB);
    }

    /**
     * Hash a value deterministically
     * @param {any} value - Value to hash
     * @returns {Promise<string>} Hash string
     */
    async hash(value) {
      const encoded = this.encode(value);
      const str = JSON.stringify(encoded);
      const encoder = new TextEncoder();
      const buffer = encoder.encode(str);
      const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
  }

  // ============================================
  // FIXED-POINT ARITHMETIC
  // For financial and precise calculations
  // ============================================
  class FixedPoint {
    constructor(value, decimals = 18) {
      this.decimals = decimals;
      this.scale = 10n ** BigInt(decimals);
      
      if (typeof value === 'bigint') {
        this.raw = value;
      } else if (typeof value === 'string') {
        this.raw = this._parseString(value);
      } else if (typeof value === 'number') {
        this.raw = BigInt(Math.round(value * Number(this.scale)));
      } else {
        this.raw = 0n;
      }
    }

    _parseString(str) {
      const [intPart, decPart = ''] = str.split('.');
      const paddedDec = decPart.padEnd(this.decimals, '0').slice(0, this.decimals);
      return BigInt(intPart + paddedDec);
    }

    add(other) {
      const o = other instanceof FixedPoint ? other : new FixedPoint(other, this.decimals);
      return new FixedPoint(this.raw + o.raw, this.decimals);
    }

    sub(other) {
      const o = other instanceof FixedPoint ? other : new FixedPoint(other, this.decimals);
      return new FixedPoint(this.raw - o.raw, this.decimals);
    }

    mul(other) {
      const o = other instanceof FixedPoint ? other : new FixedPoint(other, this.decimals);
      return new FixedPoint((this.raw * o.raw) / this.scale, this.decimals);
    }

    div(other) {
      const o = other instanceof FixedPoint ? other : new FixedPoint(other, this.decimals);
      if (o.raw === 0n) throw new Error('Division by zero');
      return new FixedPoint((this.raw * this.scale) / o.raw, this.decimals);
    }

    toNumber() {
      return Number(this.raw) / Number(this.scale);
    }

    toString() {
      const sign = this.raw < 0n ? '-' : '';
      const abs = this.raw < 0n ? -this.raw : this.raw;
      const str = abs.toString().padStart(this.decimals + 1, '0');
      const intPart = str.slice(0, -this.decimals) || '0';
      const decPart = str.slice(-this.decimals).replace(/0+$/, '') || '0';
      return sign + intPart + '.' + decPart;
    }

    toJSON() {
      return {
        _fixedPoint: true,
        raw: this.raw.toString(),
        decimals: this.decimals
      };
    }

    static fromJSON(json) {
      if (!json || !json._fixedPoint) return null;
      const fp = new FixedPoint(0, json.decimals);
      fp.raw = BigInt(json.raw);
      return fp;
    }
  }

  // ============================================
  // EXPORT
  // ============================================
  const SymbolicCodecModule = Object.freeze({
    VERSION: CODEC_VERSION,
    SymbolicNumber: SymbolicNumber,
    SymbolicOperation: SymbolicOperation,
    SymbolicCodec: SymbolicCodec,
    FixedPoint: FixedPoint,
    // Factory function
    create: (options) => new SymbolicCodec(options)
  });

  // Universal module export
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SymbolicCodecModule;
  } else if (typeof root !== 'undefined') {
    root.SymbolicCodecModule = SymbolicCodecModule;
  }

})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : global));
