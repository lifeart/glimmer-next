/**
 * Converter V2
 *
 * Template-to-JavaScript converter with Glint-style source mapping.
 */

import type { ASTv1 } from '@glimmer/syntax';
import { builders, preprocess } from '@glimmer/syntax';
import type { Flags } from '../flags';
import { CONSTANTS, EVENT_TYPE, SYMBOLS } from '../symbols';
import {
  booleanAttributes,
  BUILTIN_HELPERS,
  COMPILE_TIME_HELPERS,
  propertyKeys,
} from '../constants';
import {
  escapeString,
  isPath,
  toOptionalChaining,
  toSafeJSPath,
  resolvePath as resolvePathUtil,
  toObject,
  setFlags,
  setBindings,
  checkBindingsForCollisions,
  warnOnReservedBinding,
  serializeChildren,
} from '../utils';
import type { RewriteResult, ComplexJSTypeV2, HBSNodeV2, HBSControlExpressionV2, SourceRange } from './types';
import { getNodeRange } from './types';
import { Mapper, createMapper } from './mapper';

const SPECIAL_HELPERS = [
  SYMBOLS.HELPER_HELPER,
  SYMBOLS.MODIFIER_HELPER,
  SYMBOLS.COMPONENT_HELPER,
];

/**
 * Convert a template string to JavaScript with source mapping
 */
export function templateToTypescript(
  template: string,
  flags: Flags,
  bindings: Set<string> = new Set(),
): RewriteResult {
  const mapper = createMapper(template);

  try {
    const ast = preprocess(template, {
      mode: 'codemod',
    });

    const converter = createConverter(mapper, flags, bindings);

    // Process the template body
    mapper.forNode(ast as unknown as ASTv1.Node, 'Template', () => {
      const children = resolvedChildren(ast.body);
      if (children.length === 0) {
        mapper.text('[]');
        return;
      }

      mapper.brackets(() => {
        mapper.list(children, (child, _index) => {
          const result = converter.ToJSType(child);
          emitValue(mapper, result, child);
        });
      });
    });

    return {
      code: mapper.getCode(),
      mapping: mapper.getMappingTree(),
      directives: mapper.directives,
      errors: mapper.errors,
    };
  } catch (error) {
    mapper.error(
      error instanceof Error ? error.message : 'Unknown error during template conversion',
    );
    return {
      code: '[]',
      mapping: mapper.getMappingTree(),
      directives: mapper.directives,
      errors: mapper.errors,
    };
  }
}

/**
 * Emit a value to the mapper with source mapping
 */
function emitValue(mapper: Mapper, value: ComplexJSTypeV2, _node?: ASTv1.Node): void {
  if (value === null) {
    mapper.text('null');
  } else if (value === undefined) {
    mapper.text('undefined');
  } else if (typeof value === 'boolean') {
    mapper.text(String(value));
  } else if (typeof value === 'number') {
    mapper.text(String(value));
  } else if (typeof value === 'string') {
    mapper.text(value);
  } else if ('isControl' in value) {
    emitControlExpression(mapper, value);
  } else if ('tag' in value) {
    emitNode(mapper, value);
  }
}

/**
 * Emit a control expression with source mapping
 */
function emitControlExpression(mapper: Mapper, expr: HBSControlExpressionV2): void {
  const loc = expr.loc;
  const json = JSON.stringify(expr);

  if (loc && loc.start !== loc.end) {
    // Emit with source mapping
    mapper.emit(json, loc.start, loc.end);
  } else {
    // No source location available, emit without mapping
    mapper.text(json);
  }
}

/**
 * Emit an HBS node with source mapping
 */
function emitNode(mapper: Mapper, node: HBSNodeV2): void {
  const loc = node.loc;
  const json = JSON.stringify(node);

  if (loc && loc.start !== loc.end) {
    // Emit with source mapping
    mapper.emit(json, loc.start, loc.end);
  } else {
    // No source location available, emit without mapping
    mapper.text(json);
  }
}

/**
 * Filter out empty text nodes
 */
function resolvedChildren(nodes: ASTv1.Node[]): ASTv1.Node[] {
  return nodes.filter((node) => {
    if (node.type === 'TextNode') {
      const chars = node.chars;
      if (chars.trim().length === 0 && chars.includes('\n')) {
        return false;
      }
      if (chars.trim().length === 0 && chars.length > 1) {
        return false;
      }
    }
    return true;
  });
}

/**
 * Create the converter with all transformation methods
 */
function createConverter(
  _mapper: Mapper,
  flags: Flags,
  bindings: Set<string>,
  seenNodes: Set<ASTv1.Node> = new Set(),
) {
  // Counter for deterministic variable scope naming (replaces Math.random())
  let letBlockCounter = 0;

  /**
   * Patch node path for builtin helpers
   */
  function patchNodePath(
    node: ASTv1.MustacheStatement | ASTv1.SubExpression,
  ): void {
    if (node.path.type !== 'PathExpression') {
      return;
    }
    if (bindings.has(node.path.original)) {
      return;
    }

    // Handle unless → if conversion
    if (node.path.original === 'unless') {
      node.path.original = BUILTIN_HELPERS['if'];
      if (node.params.length === 3) {
        const condTrue = node.params[1];
        const condFalse = node.params[2];
        node.params[1] = condFalse;
        node.params[2] = condTrue;
      } else {
        const condTrue = node.params[1];
        const condFalse = {
          type: 'StringLiteral',
          value: '',
          original: '',
          loc: node.loc,
        } as ASTv1.StringLiteral;
        node.params[1] = condFalse;
        node.params[2] = condTrue;
      }
    } else if (node.path.original === 'debugger') {
      node.path.original = BUILTIN_HELPERS['debugger'];
      node.params.unshift(builders.path('this'));
    } else if (node.path.original in BUILTIN_HELPERS) {
      node.path.original =
        BUILTIN_HELPERS[node.path.original as keyof typeof BUILTIN_HELPERS];
    }

    if (node.path.original.includes('.')) {
      node.path.original = toSafeJSPath(toOptionalChaining(node.path.original));
    }
  }

  /**
   * Resolve a path string
   */
  function resolvePath(str: string): string {
    return resolvePathUtil(str);
  }

  /**
   * Serialize a parameter
   */
  function serializeParam(p: unknown): string {
    if (typeof p !== 'string') {
      if (typeof p === 'object' && p !== null && 'type' in p) {
        const t = ToJSType(p as ASTv1.Node, false);
        if (typeof t !== 'string') {
          return String(t);
        }
        return toOptionalChaining(t);
      }
      return String(p);
    }
    return isPath(p) ? `$:${resolvePath(p.slice(2))}` : escapeString(p);
  }

  /**
   * Check if a function path has a resolved binding
   */
  function hasResolvedBinding(fnPath: string): boolean {
    let hasBinding =
      fnPath.startsWith('$_') ||
      fnPath.startsWith('this.') ||
      fnPath.startsWith('this[') ||
      bindings.has(fnPath.split('.')[0]?.split('?')[0]);
    if (COMPILE_TIME_HELPERS.includes(fnPath)) {
      hasBinding = false;
    }
    return hasBinding;
  }

  /**
   * Convert a modifier call
   */
  function toModifier(
    nodePath: string,
    params: ASTv1.Expression[],
    hash: [string, unknown][],
  ): string {
    const resolvedPath = resolvePath(nodePath);
    if (flags.WITH_MODIFIER_MANAGER) {
      return `${SYMBOLS.$_maybeModifier}($:${resolvedPath},$n,[${params
        .map((p) => serializeParam(p))
        .join(',')}],${toObject(hash as [string, string | null][])})`;
    } else {
      return `$:${resolvedPath}($n,${params.map((p) => serializeParam(p)).join(',')})`;
    }
  }

  /**
   * Convert a helper call
   */
  function toHelper(
    nodePath: string,
    params: ASTv1.Expression[],
    hash: [string, unknown][],
  ): string {
    const fnPath = resolvePath(nodePath);

    if (SPECIAL_HELPERS.includes(fnPath)) {
      return `$:${fnPath}([${params.map((p) => serializeParam(p)).join(',')}],${toObject(hash as [string, string | null][])})`;
    }

    const hasBinding = hasResolvedBinding(fnPath);

    if ((!hasBinding || flags.WITH_HELPER_MANAGER) && !nodePath.startsWith('$_')) {
      if (!hasBinding) {
        hash.push([
          CONSTANTS.SCOPE_KEY,
          `$:()=>this[${SYMBOLS.$args}]?.${CONSTANTS.SCOPE_KEY}`,
        ]);
      }
      return `$:${SYMBOLS.$_maybeHelper}(${
        hasBinding ? fnPath : JSON.stringify(fnPath)
      },[${params.map((p) => serializeParam(p)).join(',')}],${toObject(hash as [string, string | null][])})`;
    } else {
      return `$:${fnPath}(${params.map((p) => serializeParam(p)).join(',')})`;
    }
  }

  /**
   * Check if element has a stable first child
   */
  function hasStableChild(node: ASTv1.ElementNode): boolean {
    const children = resolvedChildren(node.children);
    if (children.length === 0) {
      return true;
    }
    const firstChild = children[0];
    if (firstChild.type === 'TextNode') {
      return true;
    }
    if (
      firstChild.type === 'ElementNode' &&
      !firstChild.tag.startsWith(':') &&
      firstChild.tag.toLowerCase() === firstChild.tag
    ) {
      return true;
    }
    return false;
  }

  /**
   * Check if a name is an attribute (vs property)
   */
  function isAttribute(name: string): boolean {
    return !propertyKeys.includes(name);
  }

  const propsToCast: Record<string, string> = {
    class: '',
    readonly: 'readOnly',
  };

  /**
   * Convert an AST node to JS type
   */
  function ToJSType(node: ASTv1.Node, wrap = true): ComplexJSTypeV2 {
    // Track processed nodes to prevent double processing during AST traversal
    seenNodes.add(node);

    const range = getNodeRange(node);

    if (node.type === 'ConcatStatement') {
      return `$:() => [${node.parts
        .map((p) => {
          if (p.type === 'TextNode') {
            seenNodes.add(p);
            return escapeString(p.chars);
          }
          return ToJSType(p, false);
        })
        .join(',')}].join('')`;
    } else if (node.type === 'UndefinedLiteral') {
      return undefined;
    } else if (node.type === 'NullLiteral') {
      return null;
    } else if (node.type === 'BooleanLiteral') {
      return node.value;
    } else if (node.type === 'NumberLiteral') {
      return node.value;
    } else if (node.type === 'StringLiteral') {
      return escapeString(node.value);
    } else if (node.type === 'TextNode') {
      if (node.chars.trim().length === 0 && node.chars.includes('\n')) {
        return null;
      } else if (node.chars.trim().length === 0 && node.chars.length > 1) {
        return null;
      }
      return node.chars;
    } else if (node.type === 'PathExpression') {
      return `$:${toOptionalChaining(resolvePath(node.original))}`;
    } else if (node.type === 'SubExpression') {
      if (node.path.type !== 'PathExpression') {
        return null;
      }
      patchNodePath(node);

      const hashArgs: [string, unknown][] = node.hash.pairs.map((pair) => {
        return [pair.key, ToJSType(pair.value, false)];
      });

      if (node.path.original === 'element') {
        return `$:function(args){${SYMBOLS.$_GET_ARGS}(this, arguments);const $fw = ${SYMBOLS.$_GET_FW}(this, arguments);const $slots = ${SYMBOLS.$_GET_SLOTS}(this, arguments);return ${SYMBOLS.FINALIZE_COMPONENT}([${SYMBOLS.TAG}(${ToJSType(node.params[0])}, $fw,[()=>${SYMBOLS.SLOT}('default',()=>[],$slots,this)], this)], this)};`;
      } else if (node.path.original === SYMBOLS.$__hash) {
        return `$:${SYMBOLS.$__hash}(${toObject(hashArgs as [string, string | null][])})`;
      }

      return toHelper(node.path.original, node.params, hashArgs);
    } else if (node.type === 'MustacheStatement') {
      if (node.path.type !== 'PathExpression') {
        if (
          node.path.type === 'BooleanLiteral' ||
          node.path.type === 'UndefinedLiteral' ||
          node.path.type === 'NumberLiteral' ||
          node.path.type === 'NullLiteral'
        ) {
          return node.path.value;
        } else if (node.path.type === 'SubExpression') {
          return `${wrap ? `$:() => ` : ''}${ToJSType(node.path)}`;
        } else if (node.path.type === 'StringLiteral') {
          return escapeString(node.path.value);
        }
        return null;
      }

      patchNodePath(node);

      const hashArgs: [string, unknown][] = node.hash.pairs.map((pair) => {
        return [pair.key, ToJSType(pair.value)];
      });

      if (node.path.original === 'yield' || node.path.original === 'outlet') {
        let slotName =
          node.hash.pairs.find((p) => p.key === 'to')?.value || 'default';
        if (typeof slotName !== 'string') {
          slotName = ToJSType(slotName) as string;
        }
        return {
          type: 'yield',
          isControl: true,
          blockParams: node.params.map((p) => ToJSType(p)) as string[],
          children: [],
          inverse: [],
          key: slotName as string,
          condition: '',
          isSync: true,
          loc: range,
        } as HBSControlExpressionV2;
      }

      if (node.params.length === 0) {
        if (node.path.original === SYMBOLS.$__hash) {
          return `${wrap ? `$:() => ` : ''}${ToJSType(node.path)}(${toObject(hashArgs as [string, string | null][])})`;
        }
        if (hashArgs.length === 0) {
          const fnPath = resolvePath(node.path.original);
          const hasBinding = hasResolvedBinding(fnPath);
          if (!hasBinding) {
            return toHelper(node.path.original, [], hashArgs);
          } else {
            return ToJSType(node.path);
          }
        }
        return toHelper(node.path.original, [], hashArgs);
      } else {
        return `${wrap ? `$:() => ` : ''}${toHelper(node.path.original, node.params, hashArgs)}`;
      }
    } else if (node.type === 'BlockStatement') {
      if (!node.params.length) {
        return null;
      }

      node.program.blockParams.forEach((p) => {
        warnOnReservedBinding(p, 'block param');
        bindings.add(p);
      });

      const childElements = resolvedChildren(node.program.body);
      const elseChildElements = node.inverse?.body
        ? resolvedChildren(node.inverse.body)
        : undefined;

      if (!childElements.length) {
        node.program.blockParams.forEach((p) => bindings.delete(p));
        return null;
      }

      if (node.path.type !== 'PathExpression') {
        node.program.blockParams.forEach((p) => bindings.delete(p));
        return null;
      }

      const name = node.path.original;
      const keyPair = node.hash.pairs.find((p) => p.key === 'key');
      const syncPair = node.hash.pairs.find((p) => p.key === 'sync');
      let keyValue: string | null = null;
      let syncValue = false;

      if (keyPair) {
        if (keyPair.value.type === 'StringLiteral') {
          keyValue = keyPair.value.original;
        } else {
          keyValue = ToJSType(keyPair.value) as string;
        }
      }
      if (syncPair) {
        if (syncPair.value.type === 'BooleanLiteral') {
          syncValue = syncPair.value.value;
        } else {
          syncValue = ToJSType(syncPair.value) as boolean;
        }
      }

      const children = childElements.map((el) => ToJSType(el));
      const inverse = elseChildElements?.map((el) => ToJSType(el)) ?? null;

      // Cleanup bindings
      node.program.blockParams.forEach((p) => bindings.delete(p));

      if (name === 'in-element') {
        return {
          type: 'in-element',
          isControl: true,
          condition: ToJSType(node.params[0]) as string,
          blockParams: [],
          children: children,
          inverse: [],
          isSync: true,
          key: '',
          loc: range,
        } as HBSControlExpressionV2;
      } else if (name === 'unless') {
        return {
          type: 'if',
          isControl: true,
          condition: ToJSType(node.params[0]) as string,
          blockParams: node.program.blockParams,
          children: inverse,
          inverse: children,
          isSync: syncValue,
          key: keyValue,
          loc: range,
        } as HBSControlExpressionV2;
      } else if (name === 'let') {
        // Handle let block specially - inline the variables
        const varScopeName = `scope${letBlockCounter++}`;
        const namesToReplace: Record<string, string> = {};
        const primitives: Set<string> = new Set();
        const vars = node.params.map((p, index) => {
          const originalName = node.program.blockParams[index];
          const newName = `Let_${originalName}_${varScopeName}`;
          namesToReplace[originalName] = newName;
          const isPrimitive =
            p.type === 'StringLiteral' ||
            p.type === 'BooleanLiteral' ||
            p.type === 'NumberLiteral' ||
            p.type === 'NullLiteral' ||
            p.type === 'UndefinedLiteral';

          if (isPrimitive) {
            primitives.add(originalName);
            return `let ${newName} = ${ToJSType(p, false)};`;
          } else {
            return `let ${newName} = $:() => ${ToJSType(p)};`;
          }
        });

        // Replace variable references in serialized children
        function fixChildScopes(str: string) {
          Object.keys(namesToReplace).forEach((key) => {
            // Match variable names but not:
            // - preceded by . (property access like foo.name)
            // - followed by = or : (object keys/assignments)
            // - inside quotes
            const re = new RegExp(
              `(?<!\\.)\\b${key}\\b(?!(=|'|\"|:)[^ ]*)`,
              'g',
            );
            if (primitives.has(key)) {
              str = str.replace(re, namesToReplace[key]);
            } else {
              str = str.replace(re, `${namesToReplace[key]}()`);
            }
          });
          return str;
        }

        // Re-add block params to bindings before serializing children
        // (they were deleted at line 504, but serializeNode needs them to recognize component tags)
        node.program.blockParams.forEach((p) => bindings.add(p));

        // Serialize children and apply variable replacement
        const serializedChildren = serializeChildren(
          children as unknown as Parameters<typeof serializeChildren>[0],
          'this',
        );

        // Clean up bindings after serialization
        node.program.blockParams.forEach((p) => bindings.delete(p));

        const result = `$:...(() => {let self = this;${vars
          .join('')
          .split('this.')
          .join('self.')}return [${fixChildScopes(serializedChildren)}]})()`;
        return result;
      }

      return {
        type: name as 'each' | 'if',
        isControl: true,
        condition: ToJSType(node.params[0]) as string,
        blockParams: node.program.blockParams,
        isSync: syncValue,
        children: children,
        inverse: inverse,
        key: keyValue,
        loc: range,
      } as HBSControlExpressionV2;
    } else if (node.type === 'ElementNode') {
      return ElementToNode(node);
    }

    return null;
  }

  /**
   * Convert an element node to HBSNodeV2
   */
  function ElementToNode(element: ASTv1.ElementNode): HBSNodeV2 {
    const range = getNodeRange(element);

    // Handle namespace wrappers
    // Track already-wrapped elements to avoid infinite recursion
    const isAlreadyWrapped = element.tag.startsWith('$:');

    if (!isAlreadyWrapped && element.tag === 'math') {
      // Clone the element and mark it to prevent re-wrapping
      const clonedElement = { ...element, tag: `__wrapped_math__` };
      const parent = builders.element(`$:${SYMBOLS.MATH_NAMESPACE}`, {
        children: [clonedElement as unknown as ASTv1.ElementNode],
      });
      return ElementToNode(parent);
    } else if (!isAlreadyWrapped && element.tag === 'svg') {
      // Clone the element and mark it to prevent re-wrapping
      const clonedElement = { ...element, tag: `__wrapped_svg__` };
      const parent = builders.element(`$:${SYMBOLS.SVG_NAMESPACE}`, {
        children: [clonedElement as unknown as ASTv1.ElementNode],
      });
      return ElementToNode(parent);
    } else if (!isAlreadyWrapped && element.tag === 'foreignObject') {
      const htmlWrapper = builders.element(`$:${SYMBOLS.HTML_NAMESPACE}`, {
        children: element.children,
      });
      element.children = [htmlWrapper];
    }

    // Restore original tag names for wrapped elements
    let actualTag = element.tag;
    if (element.tag === '__wrapped_math__') {
      actualTag = 'math';
    } else if (element.tag === '__wrapped_svg__') {
      actualTag = 'svg';
    }

    // Handle block params
    element.blockParams.forEach((p) => {
      warnOnReservedBinding(p, 'component block param');
      bindings.add(p);
    });

    const children = resolvedChildren(element.children)
      .map((el) => ToJSType(el))
      .filter((el) => el !== null) as (string | HBSNodeV2 | HBSControlExpressionV2)[];

    element.blockParams.forEach((p) => bindings.delete(p));

    // Handle style.* attributes
    const rawStyleEvents = element.attributes.filter((attr) =>
      attr.name.startsWith('style.'),
    );
    element.attributes = element.attributes.filter(
      (attr) => !rawStyleEvents.includes(attr),
    );

    const styleEvents: [string, string, SourceRange?][] = rawStyleEvents.map((attr) => {
      const propertyName = attr.name.split('.').pop();
      const value =
        attr.value.type === 'TextNode'
          ? escapeString(attr.value.chars)
          : ToJSType(attr.value);
      const isPathValue = typeof value === 'string' && value.includes('.');
      return [
        EVENT_TYPE.ON_CREATED,
        `$:function($v,$n){$n.style.setProperty('${propertyName}',$v);}.bind(null,${SYMBOLS.$_TO_VALUE}(${isPathValue ? `$:()=>${value}` : value}))`,
        getNodeRange(attr),
      ];
    });

    const extraEvents: [string, string, SourceRange?][] = [];

    const node: HBSNodeV2 = {
      tag: actualTag,
      selfClosing: element.selfClosing,
      blockParams: element.blockParams,
      hasStableChild: hasStableChild(element),
      attributes: element.attributes
        .filter((el) => isAttribute(el.name))
        .map((attr) => {
          const rawValue = ToJSType(attr.value);
          return [attr.name, rawValue, getNodeRange(attr)];
        }),
      properties: element.attributes
        .filter((el) => !isAttribute(el.name))
        .map((attr) => {
          const rawValue = ToJSType(attr.value);
          if (
            booleanAttributes.includes(attr.name) &&
            attr.value.type === 'TextNode' &&
            attr.value.chars === ''
          ) {
            const castedProp = propsToCast[attr.name];
            return [
              typeof castedProp === 'string' ? castedProp : attr.name,
              true,
              getNodeRange(attr),
            ];
          }
          const castedProp = propsToCast[attr.name];
          return [
            typeof castedProp === 'string' ? castedProp : attr.name,
            rawValue,
            getNodeRange(attr),
          ];
        }),
      events: [
        ...extraEvents,
        ...styleEvents,
        ...element.modifiers
          .map((mod): [string, string, SourceRange?] | null => {
            if (mod.path.type !== 'PathExpression') {
              return null;
            }
            const hashArgs: [string, unknown][] = mod.hash.pairs.map((pair) => {
              return [pair.key, ToJSType(pair.value, false)];
            });

            if (mod.path.original === 'on') {
              const firstParam = mod.params[0];
              if (firstParam.type === 'StringLiteral') {
                const tail = mod.params
                  .slice(2)
                  .map((p) => ToJSType(p))
                  .join(',');
                return [
                  firstParam.original,
                  `$:($e, $n) => ${ToJSType(mod.params[1])}($e, $n${tail.length ? `,${tail}` : ''})`,
                  getNodeRange(mod),
                ];
              } else {
                return null;
              }
            } else {
              return [
                EVENT_TYPE.ON_CREATED,
                `$:($n) => ${toModifier(mod.path.original, mod.params, hashArgs)}`,
                getNodeRange(mod),
              ];
            }
          })
          .filter((el): el is [string, string, SourceRange?] => el !== null),
      ],
      children: children,
      loc: range,
    };

    // Optimize single text child
    if (children.length === 1 && typeof children[0] === 'string') {
      const v = children[0];
      if (
        !v.includes(SYMBOLS.SLOT) &&
        !actualTag.startsWith(':') &&
        actualTag.toLowerCase() === actualTag &&
        !v.includes('...')
      ) {
        node.children = [];
        node.events.push([EVENT_TYPE.TEXT_CONTENT, v]);
      }
    }

    return node;
  }

  return {
    ToJSType,
    ElementToNode,
  };
}

/**
 * Compatibility layer for old converter API
 *
 * This function matches the signature of the old converter's `convert` function
 * to allow gradual migration to converter-v2.
 *
 * @param seenNodes - Set of already-processed nodes (prevents double processing during AST traversal)
 * @param flags - Compilation flags
 * @param bindings - Set of known bindings/variables
 */
export function convert(
  seenNodes: Set<ASTv1.Node>,
  flags: Flags,
  bindings: Set<string> = new Set(),
): { ToJSType: (node: ASTv1.Node, wrap?: boolean) => ComplexJSTypeV2; ElementToNode: (element: ASTv1.ElementNode) => HBSNodeV2 } {
  // Set global state for utils.ts functions (for backward compatibility)
  setFlags(flags);
  setBindings(bindings);

  // Check for variable name collisions with JS globals and HTML element names
  checkBindingsForCollisions(bindings, 'scope');

  // Create a dummy mapper since it's not used in ToJSType/ElementToNode
  const dummyMapper = createMapper('');

  // Create converter and return the functions with seenNodes tracking
  const converter = createConverter(dummyMapper, flags, bindings, seenNodes);

  return converter;
}

// Type alias for backward compatibility
export type { ComplexJSTypeV2 as ComplexJSType } from './types';

export { createMapper, Mapper } from './mapper';
export { MappingTree, createRootMapping } from './mapping-tree';
export { TransformedModule, TransformedModuleBuilder } from './transformed-module';
