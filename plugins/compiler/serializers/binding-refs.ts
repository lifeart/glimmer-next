/**
 * Binding references read through an expression.
 *
 * Some rows of an `{{#each}}` are built with a REFERENCE to their item rather
 * than the item (src/core/control-flow/list.ts `POSITIONAL_KEY` /
 * `EACH_IN_KEY`): the row callback gets a cell whose `.value` is the item the
 * row stands for now, so that a kept row re-renders in place when another item
 * comes to stand at it. The row body names its block params as usual; this
 * module rewrites every reference to such a param in the emitted body into the
 * expression that reads it — `item` → `item.value` for a positional row,
 * `key` → `$__entry.value[0]` and `value` → `$__entry.value[1]` for a
 * `{{#each-in}}` row — so each binding that reads the param reads the
 * reference, and re-runs when it changes.
 *
 * A reference can sit in an identifier (`item`, a dotted callee `item.fn`, a
 * whole expression a visitor serialized into a name), a runtime reference
 * (`item.name`, `item?.[0]`) or raw code (a `{{log}}` / `{{unbound}}` call, a
 * dynamic modifier's hash): their text is scanned for the param as a
 * standalone identifier — not a member name (`x.item`), an object key
 * (`{ item: … }`) or the inside of a string. A function or arrow that declares
 * a param of the same name (a nested `{{#each … as |item|}}`, a component's
 * block params) and a variable declared under that name (a `{{#let}}`) shadow
 * it for the code in their scope.
 */
import type { JSExpression, JSParam, JSStatement } from '../builder';

type Replacements = ReadonlyMap<string, string>;

/**
 * `expr` with every reference to a name of `replacements` (an emitted binding
 * name) replaced by the text it maps to.
 */
export function replaceBindingRefs(
  expr: JSExpression,
  replacements: Replacements,
): JSExpression {
  if (replacements.size === 0) return expr;
  return rewrite(expr, replacements) as JSExpression;
}

function rewrite(node: unknown, names: Replacements): unknown {
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const value = rewrite(item, names);
      if (value !== item) changed = true;
      return value;
    });
    return changed ? next : node;
  }
  if (node === null || typeof node !== 'object') return node;
  const n = node as { type?: string } & Record<string, unknown>;
  switch (n.type) {
    case 'literal':
      return node;
    case 'identifier': {
      const name = n.name as string;
      const next = replaceInCode(name, names);
      if (next === name) return node;
      return { ...n, name: next, mappingName: (n.mappingName as string | undefined) ?? name };
    }
    case 'runtimeRef': {
      const symbol = n.symbol as string;
      const next = replaceInCode(symbol, names);
      return next === symbol ? node : { ...n, symbol: next };
    }
    case 'raw': {
      const code = n.code as string;
      const next = replaceInCode(code, names);
      return next === code ? node : { ...n, code: next };
    }
    case 'arrow':
    case 'function': {
      const inner = withoutDeclared(names, n.params as readonly JSParam[]);
      if (inner.size === 0) return node;
      const body = n.body;
      const nextBody = Array.isArray(body)
        ? rewriteStatements(body as JSStatement[], inner)
        : rewrite(body, inner);
      return nextBody === body ? node : { ...n, body: nextBody };
    }
    case 'iife': {
      const nextArgs = rewrite(n.args, names);
      const inner = withoutDeclared(names, n.params as readonly JSParam[]);
      const nextBody =
        inner.size === 0 ? n.body : rewriteStatements(n.body as JSStatement[], inner);
      return nextArgs === n.args && nextBody === n.body
        ? node
        : { ...n, args: nextArgs, body: nextBody };
    }
    case 'object': {
      const properties = n.properties as ReadonlyArray<Record<string, unknown>>;
      let changed = false;
      const next = properties.map((prop) => {
        // `{ item }` reads `item`: spell it out to rewrite the read.
        if (prop.shorthand === true && names.has(prop.key as string)) {
          changed = true;
          return {
            ...prop,
            shorthand: false,
            value: { type: 'runtimeRef', symbol: names.get(prop.key as string)! },
          };
        }
        const value = rewrite(prop.value, names);
        if (value === prop.value) return prop;
        changed = true;
        return { ...prop, value };
      });
      return changed ? { ...n, properties: next } : node;
    }
    default: {
      // Any other node: rewrite the nodes it holds. Its own strings (a member
      // name, a method name, template quasis, an operator) are not references.
      let next: Record<string, unknown> | null = null;
      for (const key of Object.keys(n)) {
        if (key === 'type' || key === 'sourceRange') continue;
        const value = n[key];
        if (value === null || typeof value !== 'object') continue;
        const rewritten = rewrite(value, names);
        if (rewritten !== value) {
          if (next === null) next = { ...n };
          next[key] = rewritten;
        }
      }
      return next ?? node;
    }
  }
}

// A block of statements: a variable declared under a rewritten name shadows it
// from its declaration on (its own initializer still reads the outer binding:
// a `{{#let}}` whose value reads its own name is declared under another name).
function rewriteStatements(
  statements: readonly JSStatement[],
  names: Replacements,
): readonly JSStatement[] {
  let active = names;
  let changed = false;
  const next = statements.map((statement) => {
    if (active.size === 0) return statement;
    const rewritten = rewrite(statement, active) as JSStatement;
    if (rewritten !== statement) changed = true;
    if (statement.type === 'varDecl' && active.has(statement.name)) {
      const reduced = new Map(active);
      reduced.delete(statement.name);
      active = reduced;
    }
    return rewritten;
  });
  return changed ? next : statements;
}

// `names` without those a parameter list declares (a param can be a
// destructuring pattern, `[k, v]`).
function withoutDeclared(names: Replacements, params: readonly JSParam[]): Replacements {
  let reduced: Map<string, string> | null = null;
  for (const param of params) {
    const text = typeof param === 'string' ? param : param.name;
    for (const token of identifierTokens(text)) {
      if (names.has(token)) {
        if (reduced === null) reduced = new Map(names);
        reduced.delete(token);
      }
    }
  }
  return reduced ?? names;
}

const IDENTIFIER_PART = /[\p{ID_Continue}$‌‍]/u;

function isIdentifierPart(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER_PART.test(char);
}

function identifierTokens(text: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (isIdentifierPart(text[i])) {
      let end = i + 1;
      while (end < text.length && isIdentifierPart(text[end])) end++;
      tokens.push(text.slice(i, end));
      i = end;
    } else {
      i++;
    }
  }
  return tokens;
}

/**
 * `code` (an expression's emitted text) with each standalone reference to a
 * name of `names` replaced. Skipped: string and template-literal text (not a
 * template's `${…}` parts), comments, a member name (`a.item`, `a?.item`), an
 * object key (`{ item: … }`, `, item: …`) and a longer identifier (`items`,
 * `$item`, a number).
 */
export function replaceInCode(code: string, names: Replacements): string {
  let out = '';
  let last = 0;
  // The open template literals: the brace depth of each `${…}` part, so a
  // `}` closes the part when it is back at that depth.
  const templates: number[] = [];
  let braces = 0;
  let i = 0;
  while (i < code.length) {
    const char = code[i]!;
    if (char === '"' || char === "'") {
      i = skipString(code, i, char);
      continue;
    }
    if (char === '`') {
      i = skipTemplateText(code, i + 1, templates, braces);
      continue;
    }
    if (char === '/' && (code[i + 1] === '/' || code[i + 1] === '*')) {
      const end = code[i + 1] === '/' ? code.indexOf('\n', i) : code.indexOf('*/', i + 2);
      i = end === -1 ? code.length : code[i + 1] === '/' ? end : end + 2;
      continue;
    }
    if (char === '{') {
      braces++;
      i++;
      continue;
    }
    if (char === '}') {
      if (templates.length > 0 && templates[templates.length - 1] === braces) {
        // The end of a template's `${…}` part: back to its text.
        templates.pop();
        i = skipTemplateText(code, i + 1, templates, braces);
        continue;
      }
      braces--;
      i++;
      continue;
    }
    if (isIdentifierPart(char)) {
      let end = i + 1;
      while (end < code.length && isIdentifierPart(code[end])) end++;
      const token = code.slice(i, end);
      const replacement = names.get(token);
      if (replacement !== undefined && isReference(code, i, end)) {
        out += code.slice(last, i) + replacement;
        last = end;
      }
      i = end;
      continue;
    }
    i++;
  }
  return last === 0 ? code : out + code.slice(last);
}

// The index after the string literal that opens at `start`.
function skipString(code: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < code.length) {
    const char = code[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === quote) return i + 1;
    i++;
  }
  return i;
}

// Skips template-literal text from `start`: returns the index after its
// closing backtick, or after a `${` (recording the part's brace depth).
function skipTemplateText(
  code: string,
  start: number,
  templates: number[],
  braces: number,
): number {
  let i = start;
  while (i < code.length) {
    const char = code[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '`') return i + 1;
    if (char === '$' && code[i + 1] === '{') {
      templates.push(braces);
      return i + 2;
    }
    i++;
  }
  return i;
}

// Whether the identifier at [start, end) of `code` reads a binding: not a
// member name or an object key.
function isReference(code: string, start: number, end: number): boolean {
  let before = start - 1;
  while (before >= 0 && /\s/.test(code[before]!)) before--;
  const prev = before >= 0 ? code[before] : undefined;
  if (prev === '.') {
    // `...item` (a spread) reads it; `a.item` / `a?.item` names a member.
    return code[before - 1] === '.' && code[before - 2] === '.';
  }
  if (prev === '{' || prev === ',') {
    let after = end;
    while (after < code.length && /\s/.test(code[after]!)) after++;
    if (code[after] === ':') return false;
  }
  return true;
}
