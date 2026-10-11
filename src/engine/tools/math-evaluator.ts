/**
 * RARE-INTELLIGENCE — Safe Deterministic Mathematical Evaluator
 * Pure recursive-descent parser and tokenizer with zero eval(), Function(), or code generation.
 * Enforces input validation, bounded recursion depth, and divide-by-zero protection.
 */

export class SafeMathEvaluator {
  private static readonly MAX_DEPTH = 50;

  public static evaluate(expression: string): number {
    if (!expression || typeof expression !== 'string') {
      throw new Error('Expression must be a non-empty string.');
    }

    const tokens = this.tokenize(expression.trim());
    if (tokens.length === 0) {
      throw new Error('Expression yielded no valid tokens.');
    }

    let pos = 0;

    function peek(): string | null {
      return pos < tokens.length ? tokens[pos] : null;
    }

    function consume(expected?: string): string {
      const token = tokens[pos];
      if (expected && token !== expected) {
        throw new Error(`Unexpected token "${token}", expected "${expected}".`);
      }
      pos++;
      return token;
    }

    function parseExpression(depth: number): number {
      if (depth > SafeMathEvaluator.MAX_DEPTH) {
        throw new Error('Maximum recursion depth exceeded in mathematical expression.');
      }

      let val = parseTerm(depth + 1);

      while (peek() === '+' || peek() === '-') {
        const op = consume();
        const nextVal = parseTerm(depth + 1);
        val = op === '+' ? val + nextVal : val - nextVal;
      }

      return val;
    }

    function parseTerm(depth: number): number {
      let val = parseFactor(depth + 1);

      while (peek() === '*' || peek() === '/' || peek() === '%') {
        const op = consume();
        const nextVal = parseFactor(depth + 1);
        if (op === '*') {
          val = val * nextVal;
        } else if (op === '/') {
          if (nextVal === 0) {
            throw new Error('Division by zero is undefined.');
          }
          val = val / nextVal;
        } else if (op === '%') {
          if (nextVal === 0) {
            throw new Error('Modulo by zero is undefined.');
          }
          val = val % nextVal;
        }
      }

      return val;
    }

    function parseFactor(depth: number): number {
      const val = parseUnary(depth + 1);

      if (peek() === '^') {
        consume();
        const exponent = parseFactor(depth + 1);
        return Math.pow(val, exponent);
      }

      return val;
    }

    function parseUnary(depth: number): number {
      if (peek() === '-') {
        consume();
        return -parseUnary(depth + 1);
      }
      if (peek() === '+') {
        consume();
        return parseUnary(depth + 1);
      }
      return parsePrimary(depth + 1);
    }

    function parsePrimary(depth: number): number {
      const token = peek();
      if (!token) {
        throw new Error('Unexpected end of mathematical expression.');
      }

      // Parentheses
      if (token === '(') {
        consume('(');
        const val = parseExpression(depth + 1);
        consume(')');
        return val;
      }

      // Numbers
      if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) {
        consume();
        const num = parseFloat(token);
        if (!isFinite(num)) {
          throw new Error('Numeric value overflow or non-finite number.');
        }
        return num;
      }

      // Built-in Mathematical Functions
      if (/^[a-zA-Z_]\w*$/.test(token)) {
        const funcName = consume().toLowerCase();
        consume('(');
        const args: number[] = [];

        if (peek() !== ')') {
          args.push(parseExpression(depth + 1));
          while (peek() === ',') {
            consume(',');
            args.push(parseExpression(depth + 1));
          }
        }
        consume(')');

        return SafeMathEvaluator.applyFunction(funcName, args);
      }

      throw new Error(`Unexpected mathematical token: "${token}"`);
    }

    const result = parseExpression(0);
    if (pos < tokens.length) {
      throw new Error(`Unexpected trailing token: "${tokens[pos]}"`);
    }

    if (!isFinite(result)) {
      throw new Error('Calculation result is non-finite.');
    }

    return result;
  }

  private static applyFunction(name: string, args: number[]): number {
    switch (name) {
      case 'sqrt':
        if (args.length !== 1) throw new Error('sqrt() expects exactly 1 argument.');
        if (args[0] < 0) throw new Error('sqrt() cannot evaluate negative numbers.');
        return Math.sqrt(args[0]);
      case 'abs':
        if (args.length !== 1) throw new Error('abs() expects exactly 1 argument.');
        return Math.abs(args[0]);
      case 'round':
        if (args.length !== 1) throw new Error('round() expects exactly 1 argument.');
        return Math.round(args[0]);
      case 'ceil':
        if (args.length !== 1) throw new Error('ceil() expects exactly 1 argument.');
        return Math.ceil(args[0]);
      case 'floor':
        if (args.length !== 1) throw new Error('floor() expects exactly 1 argument.');
        return Math.floor(args[0]);
      case 'min':
        if (args.length === 0) throw new Error('min() requires at least 1 argument.');
        return Math.min(...args);
      case 'max':
        if (args.length === 0) throw new Error('max() requires at least 1 argument.');
        return Math.max(...args);
      case 'log':
        if (args.length !== 1) throw new Error('log() expects exactly 1 argument.');
        if (args[0] <= 0) throw new Error('log() domain must be strictly positive.');
        return Math.log(args[0]);
      case 'exp':
        if (args.length !== 1) throw new Error('exp() expects exactly 1 argument.');
        return Math.exp(args[0]);
      default:
        throw new Error(`Unsupported mathematical function "${name}".`);
    }
  }

  private static tokenize(expr: string): string[] {
    const tokens: string[] = [];
    let i = 0;

    while (i < expr.length) {
      const c = expr[i];

      // Whitespace
      if (/\s/.test(c)) {
        i++;
        continue;
      }

      // Multi-character numbers
      if (/\d/.test(c) || (c === '.' && i + 1 < expr.length && /\d/.test(expr[i + 1]))) {
        let numStr = '';
        while (i < expr.length && (/[\d.]/.test(expr[i]) || (/[eE]/.test(expr[i]) && i + 1 < expr.length && /[\d+-]/.test(expr[i + 1])))) {
          numStr += expr[i];
          i++;
        }
        tokens.push(numStr);
        continue;
      }

      // Identifiers / functions
      if (/[a-zA-Z_]/.test(c)) {
        let id = '';
        while (i < expr.length && /\w/.test(expr[i])) {
          id += expr[i];
          i++;
        }
        tokens.push(id);
        continue;
      }

      // Operators and punctuation
      if (['+', '-', '*', '/', '%', '^', '(', ')', ','].includes(c)) {
        tokens.push(c);
        i++;
        continue;
      }

      throw new Error(`Invalid character in expression: "${c}"`);
    }

    return tokens;
  }
}
