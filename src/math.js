(function () {
  "use strict";

  const functions = {
    abs: Math.abs,
    acos: Math.acos,
    acosh: Math.acosh,
    asin: Math.asin,
    asinh: Math.asinh,
    atan: Math.atan,
    atan2: Math.atan2,
    atanh: Math.atanh,
    ceil: Math.ceil,
    cos: Math.cos,
    cosh: Math.cosh,
    exp: Math.exp,
    floor: Math.floor,
    ln: Math.log,
    log: Math.log10,
    max: Math.max,
    min: Math.min,
    round: Math.round,
    sign: Math.sign,
    sin: Math.sin,
    sinh: Math.sinh,
    sqrt: Math.sqrt,
    tan: Math.tan,
    tanh: Math.tanh,
  };

  const constants = {
    e: Math.E,
    pi: Math.PI,
    tau: Math.PI * 2,
  };

  const asComplex = (value) => typeof value === "number" ? { re: value, im: 0 } : value;
  const complexAdd = (a, b) => ({ re: asComplex(a).re + asComplex(b).re, im: asComplex(a).im + asComplex(b).im });
  const complexSubtract = (a, b) => ({ re: asComplex(a).re - asComplex(b).re, im: asComplex(a).im - asComplex(b).im });
  const complexMultiply = (a, b) => {
    const left = asComplex(a);
    const right = asComplex(b);
    return { re: left.re * right.re - left.im * right.im, im: left.re * right.im + left.im * right.re };
  };
  const complexDivide = (a, b) => {
    const left = asComplex(a);
    const right = asComplex(b);
    const denominator = right.re * right.re + right.im * right.im;
    return {
      re: (left.re * right.re + left.im * right.im) / denominator,
      im: (left.im * right.re - left.re * right.im) / denominator,
    };
  };
  const complexLog = (value) => {
    const z = asComplex(value);
    return { re: Math.log(Math.hypot(z.re, z.im)), im: Math.atan2(z.im, z.re) };
  };
  const complexExp = (value) => {
    const z = asComplex(value);
    const scale = Math.exp(z.re);
    return { re: scale * Math.cos(z.im), im: scale * Math.sin(z.im) };
  };
  const complexPower = (a, b) => {
    const base = asComplex(a);
    const exponent = asComplex(b);
    if (exponent.im === 0 && Number.isInteger(exponent.re) && Math.abs(exponent.re) <= 64) {
      let result = { re: 1, im: 0 };
      for (let index = 0; index < Math.abs(exponent.re); index += 1) result = complexMultiply(result, base);
      return exponent.re < 0 ? complexDivide(1, result) : result;
    }
    if (base.re === 0 && base.im === 0 && exponent.im === 0 && exponent.re > 0) return { re: 0, im: 0 };
    return complexExp(complexMultiply(exponent, complexLog(base)));
  };

  const complexFunctions = {
    abs: (value) => ({ re: Math.hypot(asComplex(value).re, asComplex(value).im), im: 0 }),
    arg: (value) => ({ re: Math.atan2(asComplex(value).im, asComplex(value).re), im: 0 }),
    re: (value) => ({ re: asComplex(value).re, im: 0 }),
    im: (value) => ({ re: asComplex(value).im, im: 0 }),
    conj: (value) => ({ re: asComplex(value).re, im: -asComplex(value).im }),
    exp: complexExp,
    ln: complexLog,
    log: (value) => complexDivide(complexLog(value), { re: Math.log(10), im: 0 }),
    sqrt: (value) => complexPower(value, 0.5),
    sin: (value) => {
      const z = asComplex(value);
      return { re: Math.sin(z.re) * Math.cosh(z.im), im: Math.cos(z.re) * Math.sinh(z.im) };
    },
    cos: (value) => {
      const z = asComplex(value);
      return { re: Math.cos(z.re) * Math.cosh(z.im), im: -Math.sin(z.re) * Math.sinh(z.im) };
    },
    sinh: (value) => {
      const z = asComplex(value);
      return { re: Math.sinh(z.re) * Math.cos(z.im), im: Math.cosh(z.re) * Math.sin(z.im) };
    },
    cosh: (value) => {
      const z = asComplex(value);
      return { re: Math.cosh(z.re) * Math.cos(z.im), im: Math.sinh(z.re) * Math.sin(z.im) };
    },
  };
  complexFunctions.tan = (value) => complexDivide(complexFunctions.sin(value), complexFunctions.cos(value));
  complexFunctions.tanh = (value) => complexDivide(complexFunctions.sinh(value), complexFunctions.cosh(value));
  complexFunctions.asin = (value) => {
    const z = asComplex(value);
    const inside = complexAdd(complexMultiply({ re: 0, im: 1 }, z), complexFunctions.sqrt(complexSubtract(1, complexMultiply(z, z))));
    return complexMultiply({ re: 0, im: -1 }, complexLog(inside));
  };
  complexFunctions.acos = (value) => complexSubtract(Math.PI / 2, complexFunctions.asin(value));
  complexFunctions.atan = (value) => {
    const iz = complexMultiply({ re: 0, im: 1 }, value);
    return complexMultiply({ re: 0, im: 0.5 }, complexSubtract(complexLog(complexSubtract(1, iz)), complexLog(complexAdd(1, iz))));
  };

  const commandAliases = {
    arccos: "acos",
    arcsin: "asin",
    arctan: "atan",
    cdot: "*",
    cos: "cos",
    cosh: "cosh",
    div: "/",
    ln: "ln",
    log: "log",
    max: "max",
    min: "min",
    pi: "pi",
    sin: "sin",
    sinh: "sinh",
    tan: "tan",
    tanh: "tanh",
    tau: "tau",
    times: "*",
  };

  function findGroupEnd(source, start) {
    if (source[start] !== "{") return -1;
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      if (source[index] === "{") depth += 1;
      if (source[index] === "}") depth -= 1;
      if (depth === 0) return index;
    }
    return -1;
  }

  function expandCommandGroups(source) {
    let result = source;
    let guard = 0;
    while (/\\(?:frac|sqrt)\s*\{/.test(result) && guard < 60) {
      guard += 1;
      const match = /\\(frac|sqrt)\s*\{/.exec(result);
      if (!match) break;
      const commandStart = match.index;
      const firstStart = commandStart + match[0].lastIndexOf("{");
      const firstEnd = findGroupEnd(result, firstStart);
      if (firstEnd < 0) break;
      const first = result.slice(firstStart + 1, firstEnd);

      if (match[1] === "sqrt") {
        result = `${result.slice(0, commandStart)}sqrt(${expandCommandGroups(first)})${result.slice(firstEnd + 1)}`;
        continue;
      }

      let secondStart = firstEnd + 1;
      while (/\s/.test(result[secondStart] || "")) secondStart += 1;
      if (result[secondStart] !== "{") break;
      const secondEnd = findGroupEnd(result, secondStart);
      if (secondEnd < 0) break;
      const second = result.slice(secondStart + 1, secondEnd);
      result = `${result.slice(0, commandStart)}((${expandCommandGroups(first)})/(${expandCommandGroups(second)}))${result.slice(secondEnd + 1)}`;
    }
    return result;
  }

  function normalizeLatex(latex) {
    let source = String(latex || "")
      .replace(/\\left|\\right/g, "")
      .replace(/\\operatorname\s*\{([^{}]+)\}/g, "$1")
      .replace(/\\mathrm\s*\{([^{}]+)\}/g, "$1")
      .replace(/\\text\s*\{([^{}]*)\}/g, "$1")
      .replace(/\\,/g, "")
      .replace(/−/g, "-")
      .replace(/·|×/g, "*")
      .replace(/÷/g, "/");

    source = expandCommandGroups(source);
    source = source.replace(/\\([A-Za-z]+)/g, (whole, command) => commandAliases[command] || command);
    source = source.replace(/\|([^|]+)\|/g, "abs($1)");
    return source
      .replace(/\{/g, "(")
      .replace(/\}/g, ")")
      .replace(/\[/g, "(")
      .replace(/\]/g, ")")
      .replace(/\s+/g, "")
      .replace(/\^\(([-+]?\d+)\)/g, "^$1");
  }

  function tokenize(source) {
    const tokens = [];
    let index = 0;
    while (index < source.length) {
      const rest = source.slice(index);
      const numberMatch = /^(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/i.exec(rest);
      if (numberMatch) {
        tokens.push({ type: "number", value: Number(numberMatch[0]) });
        index += numberMatch[0].length;
        continue;
      }

      const identifierMatch = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
      if (identifierMatch) {
        tokens.push({ type: "identifier", value: identifierMatch[0].toLowerCase() });
        index += identifierMatch[0].length;
        continue;
      }

      const char = source[index];
      if ("+-*/^(),=".includes(char)) {
        tokens.push({ type: char, value: char });
        index += 1;
        continue;
      }
      throw new Error(`Unsupported symbol “${char}”`);
    }
    tokens.push({ type: "end", value: "" });
    return tokens;
  }

  function parse(source) {
    const tokens = tokenize(source);
    let index = 0;

    function current() {
      return tokens[index];
    }

    function consume(type) {
      if (current().type !== type) throw new Error(`Expected “${type}”`);
      const token = current();
      index += 1;
      return token;
    }

    function startsPrimary(token) {
      return token.type === "number" || token.type === "identifier" || token.type === "(";
    }

    function parsePrimary() {
      const token = current();
      if (token.type === "number") {
        index += 1;
        return { type: "number", value: token.value };
      }

      if (token.type === "identifier") {
        index += 1;
        const name = token.value;
        if (current().type === "(") {
          consume("(");
          const args = [];
          if (current().type !== ")") {
            args.push(parseExpression());
            while (current().type === ",") {
              consume(",");
              args.push(parseExpression());
            }
          }
          consume(")");
          return { type: "call", name, args };
        }
        return { type: "variable", name };
      }

      if (token.type === "(") {
        consume("(");
        const expression = parseExpression();
        consume(")");
        return expression;
      }
      throw new Error("Expected a number, variable, or group");
    }

    function parsePower() {
      let left = parsePrimary();
      if (current().type === "^") {
        consume("^");
        left = { type: "binary", operator: "^", left, right: parseUnary() };
      }
      return left;
    }

    function parseUnary() {
      if (current().type === "+" || current().type === "-") {
        const operator = current().type;
        index += 1;
        return { type: "unary", operator, value: parseUnary() };
      }
      return parsePower();
    }

    function parseTerm() {
      let left = parseUnary();
      while (current().type === "*" || current().type === "/" || startsPrimary(current())) {
        const operator = current().type === "*" || current().type === "/" ? current().type : "*";
        if (current().type === "*" || current().type === "/") index += 1;
        left = { type: "binary", operator, left, right: parseUnary() };
      }
      return left;
    }

    function parseExpression() {
      let left = parseTerm();
      while (current().type === "+" || current().type === "-") {
        const operator = current().type;
        index += 1;
        left = { type: "binary", operator, left, right: parseTerm() };
      }
      return left;
    }

    const ast = parseExpression();
    if (current().type !== "end") throw new Error(`Unexpected “${current().value}”`);
    return ast;
  }

  function evaluate(ast, scope) {
    if (ast.type === "number") return ast.value;
    if (ast.type === "variable") {
      if (Object.prototype.hasOwnProperty.call(scope, ast.name)) return scope[ast.name];
      if (Object.prototype.hasOwnProperty.call(constants, ast.name)) return constants[ast.name];
      throw new Error(`Unknown variable “${ast.name}”`);
    }
    if (ast.type === "unary") {
      const value = evaluate(ast.value, scope);
      return ast.operator === "-" ? -value : value;
    }
    if (ast.type === "binary") {
      const left = evaluate(ast.left, scope);
      const right = evaluate(ast.right, scope);
      if (ast.operator === "+") return left + right;
      if (ast.operator === "-") return left - right;
      if (ast.operator === "*") return left * right;
      if (ast.operator === "/") return left / right;
      if (ast.operator === "^") return left ** right;
    }
    if (ast.type === "call") {
      const fn = functions[ast.name];
      if (!fn) throw new Error(`Unknown function “${ast.name}”`);
      return fn(...ast.args.map((argument) => evaluate(argument, scope)));
    }
    return NaN;
  }

  function evaluateComplex(ast, scope) {
    if (ast.type === "number") return { re: ast.value, im: 0 };
    if (ast.type === "variable") {
      if (ast.name === "i") return { re: 0, im: 1 };
      if (Object.prototype.hasOwnProperty.call(scope, ast.name)) return asComplex(scope[ast.name]);
      if (Object.prototype.hasOwnProperty.call(constants, ast.name)) return { re: constants[ast.name], im: 0 };
      throw new Error(`Unknown variable “${ast.name}”`);
    }
    if (ast.type === "unary") {
      const value = evaluateComplex(ast.value, scope);
      return ast.operator === "-" ? { re: -value.re, im: -value.im } : value;
    }
    if (ast.type === "binary") {
      const left = evaluateComplex(ast.left, scope);
      const right = evaluateComplex(ast.right, scope);
      if (ast.operator === "+") return complexAdd(left, right);
      if (ast.operator === "-") return complexSubtract(left, right);
      if (ast.operator === "*") return complexMultiply(left, right);
      if (ast.operator === "/") return complexDivide(left, right);
      if (ast.operator === "^") return complexPower(left, right);
    }
    if (ast.type === "call") {
      const fn = complexFunctions[ast.name];
      if (!fn) throw new Error(`Unknown complex function “${ast.name}”`);
      return fn(...ast.args.map((argument) => evaluateComplex(argument, scope)));
    }
    return { re: NaN, im: NaN };
  }

  function collectVariables(ast, variables = new Set()) {
    if (!ast) return variables;
    if (ast.type === "variable" && ast.name !== "i" && !Object.prototype.hasOwnProperty.call(constants, ast.name)) variables.add(ast.name);
    if (ast.type === "unary") collectVariables(ast.value, variables);
    if (ast.type === "binary") {
      collectVariables(ast.left, variables);
      collectVariables(ast.right, variables);
    }
    if (ast.type === "call") ast.args.forEach((argument) => collectVariables(argument, variables));
    return variables;
  }

  function splitEquation(source) {
    let depth = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      if (source[index] === ")") depth -= 1;
      if (source[index] === "=" && depth === 0) return [source.slice(0, index), source.slice(index + 1)];
    }
    return [source, ""];
  }

  function splitTopLevelList(source) {
    const values = [];
    let depth = 0;
    let start = 0;
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      if (source[index] === ")") depth -= 1;
      if (source[index] === "," && depth === 0) {
        values.push(source.slice(start, index));
        start = index + 1;
      }
    }
    values.push(source.slice(start));
    return values;
  }

  function compileLatex(latex) {
    const source = normalizeLatex(latex);
    if (!source) return { kind: "empty", latex, source };
    if (source === "mandelbrot") {
      return {
        kind: "recurrence-complex",
        latex,
        source,
        variables: new Set(["c"]),
        evaluateStep: (value, c) => complexAdd(complexMultiply(value, value), c),
      };
    }
    const mandelbulbMatch = /^mandelbulb(?:\(([^()]*)\))?$/.exec(source);
    if (mandelbulbMatch) {
      const power = Math.min(12, Math.max(2, Number(mandelbulbMatch[1]) || 8));
      return { kind: "fractal-3d", fractal: "mandelbulb", power, latex, source, variables: new Set() };
    }
    const recurrenceMatch = /^([a-z])_\(n\+1\)=(.+)$/.exec(source);
    if (recurrenceMatch) {
      const variable = recurrenceMatch[1];
      const previousPattern = new RegExp(`${variable}_(?:\\(n\\)|n)`, "g");
      const stepSource = recurrenceMatch[2].replace(previousPattern, variable);
      const stepAst = parse(stepSource);
      return {
        kind: "recurrence-complex",
        variable,
        latex,
        source,
        variables: collectVariables(stepAst),
        evaluateStep: (value, c, scope = {}) => evaluateComplex(stepAst, { ...scope, [variable]: value, c }),
      };
    }
    if (source.startsWith("(") && source.endsWith(")")) {
      const parts = splitTopLevelList(source.slice(1, -1));
      if (parts.length === 2 || parts.length === 3) {
        const asts = parts.map(parse);
        const variables = new Set();
        asts.forEach((ast) => collectVariables(ast, variables));
        if (variables.has("t")) {
          return {
            kind: parts.length === 3 ? "parametric-3d" : "parametric-2d",
            latex,
            source,
            variables,
            evaluatePoint: (scope = {}) => asts.map((ast) => evaluate(ast, scope)),
          };
        }
      }
    }
    const [leftSource, rightSource] = splitEquation(source);

    if (!rightSource) {
      const ast = parse(leftSource);
      return {
        kind: "value",
        latex,
        source,
        variables: collectVariables(ast),
        evaluate: (scope = {}) => evaluate(ast, scope),
      };
    }

    const assignmentMatch = /^([a-z_][a-z_0-9]*)$/i.exec(leftSource);
    const functionMatch = /^([a-z_][a-z_0-9]*)\(([a-z](?:,[a-z])*)\)$/i.exec(leftSource);
    const rightAst = parse(rightSource);
    if (functionMatch) {
      const name = functionMatch[1].toLowerCase();
      const parameters = functionMatch[2].toLowerCase().split(",");
      const variables = collectVariables(rightAst);
      if (parameters.length === 1 && parameters[0] === "z") {
        return {
          kind: "complex",
          name,
          parameters,
          latex,
          source,
          variables,
          evaluateComplex: (scope = {}) => evaluateComplex(rightAst, scope),
        };
      }
      const parameterSet = new Set(parameters);
      const kind = parameters.length === 3
        ? "implicit-3d"
        : parameterSet.has("y") && parameterSet.has("z")
          ? "x-of-yz"
          : parameterSet.has("x") && parameterSet.has("z")
            ? "y-of-xz"
            : parameters.length > 1
              ? "z-of-xy"
              : parameters[0] === "y" ? "x-of-y" : "y-of-x";
      return {
        kind,
        name,
        parameters,
        latex,
        source,
        variables,
        evaluate: (scope = {}) => evaluate(rightAst, scope),
      };
    }
    if (assignmentMatch) {
      const name = assignmentMatch[1].toLowerCase();
      const variables = collectVariables(rightAst);
      if (name === "w") {
        return {
          kind: "complex",
          name,
          latex,
          source,
          variables,
          evaluateComplex: (scope = {}) => evaluateComplex(rightAst, scope),
        };
      }
      const coordinateKind = name === "r"
        ? "radial"
        : name === "z"
          ? "z-of-xy"
          : name === "x"
            ? variables.has("z") ? "x-of-yz" : "x-of-y"
            : name === "y"
              ? variables.has("z") ? "y-of-xz" : "y-of-x"
              : null;
      return {
        kind: coordinateKind || "constant",
        name,
        latex,
        source,
        variables,
        evaluate: (scope = {}) => evaluate(rightAst, scope),
      };
    }

    const leftAst = parse(leftSource);
    const variables = collectVariables(leftAst);
    collectVariables(rightAst, variables);
    return {
      kind: variables.has("z") ? "implicit-3d" : "implicit",
      latex,
      source,
      variables,
      evaluate: (scope = {}) => evaluate(leftAst, scope) - evaluate(rightAst, scope),
    };
  }

  window.OrbifoldMath = {
    compileLatex,
    normalizeLatex,
  };
}());
