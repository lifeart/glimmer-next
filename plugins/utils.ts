import type { ASTv1 } from '@glimmer/syntax';
// import { EVENT_TYPE, SYMBOLS } from './symbols';
import { SYMBOLS } from './symbols';
import { JS_GLOBALS, ELEMENT_TAG_NAMES } from './constants';
import type { Flags } from './flags';
import type { ComplexJSType, SourceRange, MappingTreeNode, MappingSource } from './compiler-old';
import { MappingTree } from './compiler-old';

let flags!: Flags;
let bindings: Set<string> = new Set();
const warnedBindings = new Set<string>();

/**
 * Serialization context for tracking source positions during code generation.
 * This enables granular source maps that map individual expressions back to
 * their original positions in the template.
 */
export class SerializationContext {
  private output: string = '';
  private mappingStack: MappingTree[] = [];
  private rootMapping: MappingTree;

  constructor(originalSourceLength: number = 0) {
    // Create root mapping that covers the entire template
    this.rootMapping = new MappingTree(
      'Template',
      { start: 0, end: originalSourceLength },
      { start: 0, end: 0 }, // Will be updated as we emit
    );
    this.mappingStack.push(this.rootMapping);
  }

  /**
   * Current position tracker (can be set externally when output is built externally)
   */
  private currentPosition: number = 0;

  /**
   * Get the current position in the output
   */
  get position(): number {
    return this.currentPosition;
  }

  /**
   * Set the current position (for external output tracking)
   */
  set position(pos: number) {
    this.currentPosition = pos;
  }

  /**
   * Emit text without source mapping
   */
  emit(text: string): void {
    this.output += text;
    this.currentPosition += text.length;
  }

  /**
   * Advance position without emitting (when output is built externally)
   */
  advancePosition(length: number): void {
    this.currentPosition += length;
  }

  /**
   * Emit text with source mapping
   */
  emitMapped(text: string, originalRange: SourceRange | undefined, nodeType: MappingSource = 'Synthetic'): void {
    if (originalRange && originalRange.start !== originalRange.end) {
      const startPos = this.position;
      this.output += text;
      const endPos = this.position;

      // Create a mapping for this text
      const currentParent = this.mappingStack[this.mappingStack.length - 1];
      currentParent.createChild(
        nodeType,
        originalRange,
        { start: startPos, end: endPos },
      );
    } else {
      this.output += text;
    }
  }

  /**
   * Start a new mapping scope (e.g., for a block or element)
   */
  pushScope(originalRange: SourceRange | undefined, nodeType: MappingSource): void {
    const startPos = this.position;
    const parent = this.mappingStack[this.mappingStack.length - 1];
    const range = originalRange || { start: 0, end: 0 };
    const child = parent.createChild(
      nodeType,
      range,
      { start: startPos, end: startPos }, // End will be updated in popScope
    );
    this.mappingStack.push(child);
  }

  /**
   * End the current mapping scope
   */
  popScope(): void {
    if (this.mappingStack.length > 1) {
      const current = this.mappingStack.pop()!;
      current.transformedRange.end = this.position;
    }
  }

  /**
   * Get the generated code
   */
  getCode(): string {
    return this.output;
  }

  /**
   * Get the mapping tree for source map generation
   */
  getMappingTree(): MappingTreeNode {
    // Update root mapping's transformed range
    this.rootMapping.transformedRange.end = this.position;
    return this.rootMapping;
  }
}

/**
 * Global serialization context for tracking (optional - only used when source maps are needed)
 */
let serializationContext: SerializationContext | null = null;

/**
 * Set the serialization context for tracking source positions
 */
export function setSerializationContext(ctx: SerializationContext | null): void {
  serializationContext = ctx;
}

/**
 * Get the current serialization context
 */
export function getSerializationContext(): SerializationContext | null {
  return serializationContext;
}

export function setBindings(b: Set<string>) {
  bindings = b;
}

export function warnOnReservedBinding(name: string, context?: string): void {
  if (warnedBindings.has(name)) {
    return;
  }

  const contextStr = context ? ` in ${context}` : '';

  if (JS_GLOBALS.has(name)) {
    warnedBindings.add(name);
    console.warn(
      `[GXT Compiler Warning] Variable "${name}"${contextStr} shadows a JavaScript global. ` +
      `This may cause unexpected behavior if you use <${name}> as an element tag in your template. ` +
      `Consider renaming to avoid conflicts (e.g., "${name.toLowerCase()}Value", "my${name}").`
    );
  } else if (ELEMENT_TAG_NAMES.has(name)) {
    warnedBindings.add(name);
    console.warn(
      `[GXT Compiler Warning] Variable "${name}"${contextStr} matches an HTML/SVG element name. ` +
      `Using <${name}> in your template will be treated as a component reference, not an HTML element. ` +
      `Consider renaming to avoid conflicts (e.g., "${name}Value", "my${name.charAt(0).toUpperCase() + name.slice(1)}").`
    );
  }
}

export function checkBindingsForCollisions(bindings: Set<string>, context?: string): void {
  bindings.forEach((name) => warnOnReservedBinding(name, context));
}

export function setFlags(f: Flags) {
  flags = f;
}

export type HBSControlExpression = {
  type: 'each' | 'if' | 'in-element' | 'yield';
  isControl: true;
  condition: string;
  blockParams: string[];
  children: Array<HBSNode | HBSControlExpression | string>;
  inverse: Array<HBSNode | HBSControlExpression | string> | null;
  key: string | null;
  isSync: boolean;
  /** Original source range (optional, added by converter-v2) */
  loc?: SourceRange;
};

export type HBSNode = {
  tag: string;
  attributes: [string, unknown, SourceRange?][];
  properties: [string, unknown, SourceRange?][];
  selfClosing: boolean;
  hasStableChild: boolean;
  blockParams: string[];
  events: [string, string, SourceRange?][];
  children: (string | HBSNode | HBSControlExpression)[];
  /** Original source range (optional, added by converter-v2) */
  loc?: SourceRange;
};

let ctxIndex = 0;
export function nextCtxName() {
  return `ctx${ctxIndex++}`;
}
export function resetContextCounter() {
  ctxIndex = 0;
}

export function escapeString(str: string) {
  if (typeof str !== 'string') {
    throw new Error('Not a string');
  }
  try {
    if (typeof JSON.parse(str) !== 'string') {
      return JSON.stringify(str);
    }
    return JSON.stringify(JSON.parse(str));
  } catch (e) {
    return JSON.stringify(str);
  }
}

export function isPath(str: string) {
  return str.startsWith('$:');
}

export function resolvePath(str: string) {
  if (bindings.has(str)) {
    return str;
  }
  if (str === 'has-block-params') {
    str = str.replace(
      'has-block-params',
      `${SYMBOLS.$_hasBlockParams}.bind(this, $slots)`,
    );
  } else if (str === 'has-block') {
    str = str.replace('has-block', `${SYMBOLS.$_hasBlock}.bind(this, $slots)`);
  } else if (str === 'component') {
    return SYMBOLS.COMPONENT_HELPER;
  } else if (str === 'helper') {
    return SYMBOLS.HELPER_HELPER;
  } else if (str === 'modifier') {
    return SYMBOLS.MODIFIER_HELPER;
  }
  return toSafeJSPath(
    toOptionalChaining(str)
      .replace('$:', '')
      .replace('@', `this[${SYMBOLS.$args}].`),
  );
}

export function toSafeJSPath(str: string) {
  // skip for functions
  if (str.includes('(') || !str.includes('.')) {
    return str;
  }
  const parts = str.split('.');
  const result = parts
    .map((p) => {
      if (p.endsWith('?')) {
        if (isSafeKey(p.slice(0, -1))) {
          return p;
        } else if (p.includes('[')) {
          return p.slice(0, -1);
        } else {
          return `["${p.slice(0, -1)}"]?`;
        }
      } else if (p.includes('[')) {
        return p;
      } else if (isSafeKey(p)) {
        return p;
      } else {
        return `["${p}"]`;
      }
    })
    .reduce((acc, el) => {
      if (el.startsWith('[')) {
        return acc + el;
      } else {
        if (acc.length) {
          return acc + '.' + el;
        } else {
          return el;
        }
      }
    }, '');
  return result;
}

export function toOptionalChaining<
  T extends string | number | undefined | null,
>(str: T): T {
  if (typeof str !== 'string') {
    return str;
  }
  if (str.includes("'") || str.includes('"')) {
    return str;
  }
  // special control parts
  if (str.includes('$_')) {
    return str;
  } else if (str.includes('?.')) {
    return str;
  } else if (str.split('.').length < 3) {
    return str;
  }
  const result = str
    .split('...')
    .map((el) => el.split('.').join('?.'))
    .join('...');
  if (result.includes('this?.')) {
    return result.replace('this?.', 'this.') as T;
  } else if (result.includes(`this[${SYMBOLS.$args}]?.`)) {
    return result.replace(
      `this[${SYMBOLS.$args}]?.`,
      `this[${SYMBOLS.$args}].`,
    ) as T;
  }
  return result as T;
}

export function serializePath(
  p: string | boolean,
  wrap = flags.IS_GLIMMER_COMPAT_MODE,
  sourceRange?: SourceRange,
): string {
  if (typeof p !== 'string') {
    // @ts-expect-error
    return p;
  }
  if (p.includes('...')) {
    // splat attrs case
    return p;
  }
  const isFunction =
    p.startsWith('$:(') || p.startsWith('$:...(') || p.startsWith('$:function');

  let result: string;
  if (wrap === false) {
    result = resolvePath(p);
  } else if (isFunction) {
    result = resolvePath(p);
  } else {
    result = `() => ${resolvePath(p)}`;
  }

  // Track source mapping if context is available
  const ctx = serializationContext;
  if (ctx && sourceRange) {
    ctx.emitMapped('', sourceRange, 'PathExpression');
  }

  return result;
}

export function resolvedChildren(els: ASTv1.Node[]) {
  return els.filter((el) => {
    if (
      el.type === 'CommentStatement' ||
      el.type === 'MustacheCommentStatement'
    ) {
      return false;
    }
    if (
      el.type === 'TextNode' &&
      el.chars.trim().length === 0 &&
      el.chars.includes('\n')
    ) {
      return false;
    }
    return true;
  });
}

export function serializeChildren(
  children: Array<string | HBSNode | HBSControlExpression>,
  ctxName: string,
) {
  if (children.length === 0) {
    return '';
  }
  return `${children
    .map((child) => {
      if (typeof child === 'string') {
        if (isPath(child)) {
          // For string paths, we don't have source range info at this level
          return serializePath(child);
        }
        return escapeString(child);
      }
      return serializeNode(child, ctxName);
    })
    .join(', ')}`;
}

function toChildArray(
  childs: Array<HBSNode | HBSControlExpression | string> | null,
  ctxName = 'this',
): string {
  if (!childs) {
    return '[]';
  }
  return `[${childs
    .map((child) => serializeNode(child, ctxName))
    .filter((el) => el)
    .join(', ')}]`;
}

function toPropName(name: string) {
  let result = name.replace('@', '');
  return isSafeKey(result) ? result : JSON.stringify(result);
}

// Type for attribute/property tuples - [key, value, optionalRange?]
type AttrTuple = [string, unknown, SourceRange?] | [string, unknown];

export function serializeAttribute(
  key: string,
  value: null | undefined | string | number | boolean,
): string {
  if (typeof value === 'boolean') {
    return `['${key}', ${String(value)}]`;
  } else if (typeof value === 'number') {
    return `['${key}', ${value}]`;
  } else if (value === null) {
    return `['${key}', null]`;
  } else if (typeof value === 'undefined') {
    return `['${key}', undefined]`;
  }
  if (isPath(value)) {
    return `['${key}', ${serializePath(value)}]`;
  }
  return `['${key}', ${escapeString(value)}]`;
}

function serializeProp(
  attr: AttrTuple,
): string {
  const value = attr[1];
  if (value === null) {
    return `${toPropName(attr[0])}: null`;
  } else if (typeof value === 'boolean') {
    return `${toPropName(attr[0])}: ${value}`;
  } else if (typeof value === 'number') {
    return `${toPropName(attr[0])}: ${value}`;
  } else if (typeof value === 'undefined') {
    return `${toPropName(attr[0])}: undefined`;
  }
  // At this point, value should be a string
  const strValue = value as string;
  const isScopeValue = isPath(strValue);
  const key = toPropName(attr[0]);
  return `${key}: ${
    isScopeValue ? serializePath(strValue) : escapeString(strValue)
  }`;
}

function isSafeKey(key: string): boolean {
  return /^[a-z_$@][a-z0-9_$]*$/i.test(key);
}

function toComponent(ref: string, args: string, ctx: string) {
  if (ref.includes('.')) {
    // may be a dynamic component
    return `${SYMBOLS.DYNAMIC_COMPONENT}($:()=>${ref},${args},${ctx})`;
  } else {
    return `${SYMBOLS.COMPONENT}(${ref},${args},${ctx})`;
  }
}

export function toObject(
  args: AttrTuple[],
) {
  return `{${args.map((attr) => serializeProp(attr)).join(', ')}}`;
}
function toArray(
  args: AttrTuple[],
) {
  return `[${args
    .map((attr) => serializeAttribute(attr[0] as string, attr[1] as string | number | boolean | null | undefined))
    .join(', ')}]`;
}

function toArgs(
  args: AttrTuple[],
  slots: string,
  props: string,
) {
  if (flags.IS_GLIMMER_COMPAT_MODE === false) {
    const extraArgs = [...args];
    if (props !== '{}' && !props.includes(SYMBOLS.EMPTY_DOM_PROPS)) {
      extraArgs.push([`$:[${SYMBOLS.$PROPS_SYMBOL}]`, `$:${props}`]);
    }
    if (slots !== '{}') {
      extraArgs.push([`$:[${SYMBOLS.$SLOTS_SYMBOL}]`, `$:${slots}`]);
    }
    const result = toObject(extraArgs);
    return result;
  }

  const result = `${SYMBOLS.ARGS}(${toObject(args)},${slots},${props})`;

  return result
    .replace(`${SYMBOLS.ARGS}({},{},{})`, '{}')
    .replace('$_args({},{},$_edp)', '{}');
}

function hasStableChildsForControlNode(
  childs: null | (null | string | HBSNode | HBSControlExpression)[],
) {
  // TODO: we need to fix case where we render static node (for example, DIV) with dynamic content (opcode),
  // in this case we bind opcode destructor to context (and it will be if or each), and it will be re-executed multiple times;
  // same for node if it's already destroyed, opcode will work while context is active
  // return false;
  if (childs === null) {
    return true;
  }
  const realChilds = childs.filter((el) => el !== null);
  let hasStableChild = false;
  if (realChilds.length === 1 && typeof childs[0] === 'object') {
    const child = childs[0];
    if (typeof child === 'string' || child === null) {
      return false;
    }
    if ('isControl' in child) {
      return false;
    } else {
      if (bindings.has(child.tag.split('.')!.pop()!)) {
        // if there is only one node and this node is component node - we are good
        return true;
      } else if (child.events.length === 0 && child.children.length === 0) {
        return true;
      }
      return false;
    }
  }
  return hasStableChild;
}

export function serializeNode(
  node: string | null | HBSNode | HBSControlExpression | ComplexJSType,
  ctxName = 'this',
): string | undefined | null {
  if (node === null) {
    return null;
  }

  const ctx = serializationContext;

  // Track node scope if we have source location info
  const nodeObj = typeof node === 'object' && node !== null ? node : null;
  const hasLoc = nodeObj && 'loc' in nodeObj && nodeObj.loc;
  if (ctx && hasLoc && nodeObj) {
    // Use appropriate MappingSource type based on node kind
    const nodeType: MappingSource = 'isControl' in nodeObj ? 'BlockStatement' : 'ElementNode';
    ctx.pushScope((nodeObj as { loc: SourceRange }).loc, nodeType);
  }

  // Helper to pop scope, advance position, and return result
  const done = <T extends string | null | undefined>(result: T): T => {
    if (ctx) {
      // Advance position based on the length of the serialized output
      if (typeof result === 'string') {
        ctx.advancePosition(result.length);
      }
      if (hasLoc) {
        ctx.popScope();
      }
    }
    return result;
  };

  if (typeof node === 'object' && 'isControl' in node) {
    // control node (each)
    const key = `@${node.type}`;
    // Wrap condition in getter for reactivity (serializePath adds () => wrapper in compat mode)
    const condition = node.condition;
    const arrayName = typeof condition === 'string' && isPath(condition) ? serializePath(condition) : condition;
    const paramNames = node.blockParams;
    const childs = (node.children || []).filter((el) => el !== null);
    const isSync = node.isSync;
    const inverses = node.inverse;
    let eachKey = node.key;

    if (eachKey === '@index') {
      console.warn('@index identity not supported');
      eachKey = '@identity';
    }

    const newCtxName = nextCtxName();
    if (key === '@yield') {
      return done(`$:${SYMBOLS.SLOT}(${escapeString(
        eachKey as string,
      )}, () => [${paramNames.join(',')}], $slots, ${ctxName})`);
    } else if (key === '@in-element') {
      return done(`$:${
        SYMBOLS.$_inElement
      }(${arrayName}, $:(${newCtxName}) => [${serializeChildren(
        childs as unknown as [string | HBSNode | HBSControlExpression],
        newCtxName,
      )}], ${ctxName})`);
    } else if (key === '@each') {
      if (paramNames.length === 0) {
        paramNames.push('$noop');
      }
      if (paramNames.length === 1) {
        // @todo - add compiler param to mark there is no index here
        // likely we  need to import $getIndex function and pass it as a param for each constructor
        paramNames.push('$index'); // dummy param
      }
      let hasStableChild = hasStableChildsForControlNode(childs);
      const FN_NAME = isSync ? SYMBOLS.EACH_SYNC : SYMBOLS.EACH;
      const EACH_KEY = eachKey ? escapeString(eachKey) : null;
      const FN_FN_ARGS = `${paramNames.join(',')},${newCtxName}`;
      const indexParamName = paramNames[1];
      const paramBounds = new RegExp(
        `(?<!\\.)\\b${indexParamName}\\b(?!(=|'|\"|:)[^ ]*)`,
        'g',
      );
      // unstable childs need to be wrapped in a component function
      if (hasStableChild) {
        let childText = toChildArray(childs, newCtxName)
          .split(paramBounds)
          .filter(Boolean)
          .join(`${indexParamName}.value`);
        // transforming array to single value
        if (childs.length === 1) {
          const length = childText.length;
          childText = childText.slice(1, length - 1);
        }
        return done(`${FN_NAME}(${arrayName}, (${FN_FN_ARGS}) => ${childText}, ${EACH_KEY}, ${ctxName})`);
      } else {
        const extraContextName = nextCtxName();
        let childText = toChildArray(childs, extraContextName)
          .split(paramBounds)
          .filter(Boolean)
          .join(`${indexParamName}.value`);
        return done(`${FN_NAME}(${arrayName}, (${FN_FN_ARGS}) => ${SYMBOLS.$_ucw}((${extraContextName}) => ${childText}, ${newCtxName}), ${EACH_KEY}, ${ctxName})`);
      }
    } else if (key === '@if') {
      let hasStableTrueChild = hasStableChildsForControlNode(childs);
      let hasStableFalseChild = hasStableChildsForControlNode(inverses);
      // @todo - figure out cases where we could avoid wrapping in a component
      hasStableTrueChild = false;
      hasStableFalseChild = false;
      let trueBranch = `(${newCtxName}) => ${toChildArray(childs, newCtxName)}`;
      let extraContextName = nextCtxName();
      if (!hasStableTrueChild) {
        trueBranch = `(${newCtxName}) => ${
          SYMBOLS.$_ucw
        }((${extraContextName}) => ${toChildArray(
          childs,
          extraContextName,
        )}, ${newCtxName})`;
      }

      let falseBranch = `(${newCtxName}) => ${toChildArray(
        inverses,
        newCtxName,
      )}`;
      if (!hasStableFalseChild) {
        falseBranch = `(${newCtxName}) => ${
          SYMBOLS.$_ucw
        }((${extraContextName}) => ${toChildArray(
          inverses,
          extraContextName,
        )}, ${newCtxName})`;
      }
      return done(`${SYMBOLS.IF}(${arrayName}, ${trueBranch}, ${falseBranch}, ${ctxName})`);
    }
  } else if (
    typeof node === 'object' &&
    node.tag &&
    (bindings.has(node.tag) ||
      node.tag.startsWith('$:$_') ||
      node.tag.includes('.'))
  ) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === '...attributes';
    });
    const attributes = node.attributes.filter((attr) => {
      return attr[0] !== '...attributes';
    });
    const args = attributes.filter((attr) => {
      return attr[0].startsWith('@');
    });
    const attrs = attributes.filter((attr) => {
      return !attr[0].startsWith('@');
    });
    const props = node.properties;
    //
    let secondArg = hasSplatAttrs
      ? `[[...$fw[0], ...${toArray(props)}],[...$fw[1], ...${toArray(
          attrs,
        )}],[...$fw[2],...${toArray(node.events)}]]`
      : `[${toArray(props)},${toArray(attrs)},${toArray(node.events)}]`;

    let isSecondArgEmpty = secondArg === '[[],[],[]]';
    if (isSecondArgEmpty) {
      secondArg = SYMBOLS.EMPTY_DOM_PROPS;
    }
    // if (isSecondArgEmpty) {
    //   if (!secondArg.includes('...')) {
    //     isSecondArgEmpty = true;
    //     secondArg = '{}';
    //   } else {
    //     isSecondArgEmpty = false;
    //   }
    // }

    if (node.selfClosing) {
      // @todo - we could pass `hasStableChild` ans hasBlock / hasBlockParams to the DOM helper
      return done(toComponent(node.tag, toArgs(args, '{}', secondArg), ctxName));
    } else {
      const slots: HBSNode[] = node.children.filter((child) => {
        if (typeof child === 'string') {
          return false;
        } else if ('isControl' in child) {
          return false;
        } else {
          return child.tag.startsWith(':');
        }
      }) as HBSNode[];
      if (slots.length === 0) {
        slots.push(node);
      }
      const serializedSlots = slots.map((slot) => {
        const sContext = nextCtxName();
        const slotChildren = serializeChildren(slot.children, sContext);
        const hasBlockParams = slot.blockParams.length > 0;
        const slotName = slot.tag.startsWith(':')
          ? slot.tag.slice(1)
          : 'default';
        return `${slotName}_: ${hasBlockParams},${slotName}: (${[
          sContext,
          ...slot.blockParams,
        ].join(',')}) => [${slotChildren}]`;
      });
      const slotsObj = `{${serializedSlots.join(',')}}`;
      // @todo - we could pass `hasStableChild` ans hasBlock / hasBlockParams to the DOM helper
      // including `has-block` helper
      return done(toComponent(node.tag, toArgs(args, slotsObj, secondArg), ctxName));
    }
  } else if (typeof node === 'object' && node.tag) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === '...attributes';
    });
    const attributes = node.attributes.filter((attr) => {
      return attr[0] !== '...attributes';
    });
    let tagProps = `[${toArray(node.properties)},${toArray(
      attributes,
    )},${toArray(node.events)}${hasSplatAttrs ? `,$fw` : ''}]`;
    if (tagProps === '[[],[],[]]') {
      tagProps = SYMBOLS.EMPTY_DOM_PROPS;
    }
    return done(`${SYMBOLS.TAG}('${node.tag}', ${tagProps}, [${serializeChildren(
      node.children,
      ctxName,
    )}], ${ctxName})`);
  } else {
    if (typeof node === 'string' || typeof node === 'number') {
      if (typeof node === 'number') {
        node = String(node);
      }
      if (isPath(node)) {
        // For strings/numbers, hasLoc is false, so done() is a no-op
        return done(serializePath(node));
      } else {
        return done(escapeString(node));
      }
    }
    throw new Error('Unknown node type: ' + JSON.stringify(node, null, 2));
  }
}
