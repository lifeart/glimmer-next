import type { ASTv1 } from '@glimmer/syntax';
import {
  type HBSControlExpression,
  type HBSNode,
  escapeString,
  isPath,
  resolvedChildren,
  serializeChildren,
  serializePath,
  toObject,
  setFlags,
  setBindings,
  resolvePath,
  toOptionalChaining,
  toSafeJSPath,
} from './utils';
import { EVENT_TYPE, SYMBOLS } from './symbols';
import type { Flags } from './flags';

const SPECIAL_HELPERS = [
  SYMBOLS.HELPER_HELPER,
  SYMBOLS.MODIFIER_HELPER,
  SYMBOLS.COMPONENT_HELPER,
];

function patchNodePath(node: ASTv1.MustacheStatement | ASTv1.SubExpression, bindings: Set<string>) {
  if (node.path.type !== 'PathExpression') {
    return;
  }
  if (bindings.has(node.path.original)) {
    return;
  }
  // replacing builtin helpers
  if (node.path.original === 'unless') {
    node.path.original = SYMBOLS.$__if;
    if (node.params.length === 3) {
      const condTrue = node.params[1];
      const condFalse = node.params[2];
      node.params[1] = condFalse;
      node.params[2] = condTrue;
    } else {
      node.params.push();
      const condTrue = node.params[1];
      const condFalse = {
        type: 'StringLiteral',
        value: '',
        original: '',
        loc: node.loc,
      };
      // @ts-expect-error
      node.params[1] = condFalse;
      node.params[2] = condTrue;
    }
  } else if (node.path.original === 'if') {
    node.path.original = SYMBOLS.$__if;
  } else if (node.path.original === 'eq') {
    node.path.original = SYMBOLS.$__eq;
  } else if (node.path.original === 'debugger') {
    node.path.original = '$__debugger.call';
    node.params.unshift({
      type: 'PathExpression',
      original: 'this',
      parts: ['this'],
      loc: node.loc,
      head: null as any,
      tail: [],
      this: true,
      data: false,
    });
  } else if (node.path.original === 'log') {
    node.path.original = SYMBOLS.$__log;
  } else if (node.path.original === 'array') {
    node.path.original = SYMBOLS.$__array;
  } else if (node.path.original === 'hash') {
    node.path.original = SYMBOLS.$__hash;
  } else if (node.path.original === 'fn') {
    node.path.original = SYMBOLS.$__fn;
  } else if (node.path.original === 'or') {
    node.path.original = SYMBOLS.$__or;
  }

  if (node.path.original.includes('.')) {
    node.path.original = toSafeJSPath(toOptionalChaining(node.path.original));
  }
}

export type PrimitiveJSType = null | number | string | boolean | undefined;
export type ComplexJSType = PrimitiveJSType | HBSControlExpression | HBSNode;

export function convert(
  seenNodes: Set<ASTv1.Node>,
  flags: Flags,
  bindings: Set<string> = new Set(),
) {
  setFlags(flags);
  setBindings(bindings);

  function serializeParam(p: any) {
    if (typeof p !== 'string') {
      if (typeof p === 'object' && p !== null) {
        let t = ToJSType(p, false);
        if (typeof t !== 'string') {
          return String(t);
        }
        return toOptionalChaining(t);
      }
      return String(p);
    }
    // ? serializePath(p, false)
    return isPath(p) ? serializePath(p, false) : escapeString(p);
  }

  function toModifier(
    nodePath: string,
    params: any[],
    hash: [string, PrimitiveJSType][],
  ) {
    if (flags.WITH_MODIFIER_MANAGER) {
      return `${SYMBOLS.$_maybeModifier}($:${resolvePath(nodePath)},$n,[${params
        .map((p) => serializeParam(p))
        .join(',')}],${toObject(hash)})`;
    } else {
      return `$:${resolvePath(nodePath)}($n,${params
        .map((p) => serializeParam(p))
        .join(',')})`;
    }
  }

  function toHelper(
    nodePath: string,
    params: any[],
    hash: [string, PrimitiveJSType][],
  ) {
    const fnPath = resolvePath(nodePath);
    if (SPECIAL_HELPERS.includes(fnPath)) {
      return `$:${fnPath}([${params
        .map((p) => serializeParam(p))
        .join(',')}],${toObject(hash)})`;
    }
    if (flags.WITH_HELPER_MANAGER && !nodePath.startsWith('$_')) {
      return `$:${SYMBOLS.$_maybeHelper}(${fnPath},[${params
        .map((p) => serializeParam(p))
        .join(',')}],${toObject(hash)})`;
    } else {
      return `$:${fnPath}(${params.map((p) => serializeParam(p)).join(',')})`;
    }
    /*
      params.map(el => {
        return             if (typeof el !== 'string') {
              return String(el);
            }
            return isPath(el) ? serializePath(el, false) : escapeString(el);
      })

    */
  }

  function ToJSType(node: ASTv1.Node, wrap = true): ComplexJSType {
    seenNodes.add(node);
    if (node.type === 'ConcatStatement') {
      return `$:() => [${node.parts
        .map((p) => {
          if (p.type === 'TextNode') {
            seenNodes.add(p);
            return escapeString(p.chars);
          }
          let value = ToJSType(p, false);
          return value;
        })
        .join(',')}].join('')`;
    } else if (node.type === 'UndefinedLiteral') {
      return undefined;
    } else if (node.type === 'NullLiteral') {
      return null;
    } else if (node.type === 'BooleanLiteral') {
      return node.value;
    } else if (node.type === 'SubExpression') {
      if (node.path.type !== 'PathExpression') {
        return null;
      }
      // replacing builtin helpers
      patchNodePath(node, bindings);

      const hashArgs: [string, PrimitiveJSType][] = node.hash.pairs.map(
        (pair) => {
          return [
            pair.key,
            ToJSType(pair.value, false) as unknown as PrimitiveJSType,
          ];
        },
      );

      if (node.path.original === 'element') {
        // @todo  - write test to catch props issue here
        return `$:function(args){const $fw = ${
          SYMBOLS.$_GET_FW
        }(this, arguments);const $slots = ${
          SYMBOLS.$_GET_SLOTS
        }(this, arguments);return{[${SYMBOLS.$nodes}]:[${
          SYMBOLS.TAG
        }(${ToJSType(node.params[0])}, $fw,[()=>${
          SYMBOLS.SLOT
        }('default',()=>[],$slots)], this)], ctx: this};}`;
      } else if (node.path.original === SYMBOLS.$__hash) {
        return `$:${SYMBOLS.$__hash}(${toObject(hashArgs)})`;
      }
      return toHelper(node.path.original, node.params, hashArgs);
    } else if (node.type === 'NumberLiteral') {
      return node.value;
    }
    if (node.type === 'StringLiteral') {
      return escapeString(node.value);
    } else if (node.type === 'TextNode') {
      if (node.chars.trim().length === 0 && node.chars.includes('\n')) {
        return null;
      } else if (node.chars.trim().length === 0 && node.chars.length > 1) {
        return null;
      }
      return node.chars;
    } else if (node.type === 'ElementNode') {
      return ElementToNode(node);
    } else if (node.type === 'PathExpression') {
      return `$:${resolvePath(node.original)}`;
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
        }
        if (node.path.type === 'StringLiteral') {
          return escapeString(node.path.value);
        }
        return null;
      }
      // replacing builtin helpers
      patchNodePath(node, bindings);

      const hashArgs: [string, PrimitiveJSType][] = node.hash.pairs.map(
        (pair) => {
          return [pair.key, ToJSType(pair.value) as PrimitiveJSType];
        },
      );

      if (node.path.original === 'yield') {
        let slotName =
          node.hash.pairs.find((p) => p.key === 'to')?.value || 'default';
        if (typeof slotName !== 'string') {
          slotName = ToJSType(slotName) as unknown as string;
        }
        return {
          type: 'yield',
          isControl: true,
          blockParams: node.params.map((p) => ToJSType(p)),
          children: [],
          inverse: [],
          key: slotName,
          condition: '',
          isSync: true,
        } as HBSControlExpression;
      }
      if (node.params.length === 0) {
        // hash case
        if (node.path.original === SYMBOLS.$__hash) {
          return `${wrap ? `$:() => ` : ''}${ToJSType(node.path)}(${toObject(
            hashArgs,
          )})`;
        }
        if (hashArgs.length === 0) {
          return ToJSType(node.path);
        }
        return toHelper(node.path.original, [], hashArgs);
      } else {
        return `${wrap ? `$:() => ` : ''}${toHelper(
          node.path.original,
          node.params,
          hashArgs,
        )}`;
      }
    } else if (node.type === 'BlockStatement') {
      if (!node.params.length) {
        return null;
      }
      const childElements = resolvedChildren(node.program.body);
      const elseChildElements = node.inverse?.body
        ? resolvedChildren(node.inverse.body)
        : undefined;
      if (!childElements.length) {
        return null;
      }
      if (node.path.type !== 'PathExpression') {
        return null;
      }
      const name = node.path.original;
      const keyPair = node.hash.pairs.find((p) => p.key === 'key');
      const syncPair = node.hash.pairs.find((p) => p.key === 'sync');
      let keyValue: string | null = null;
      let syncValue: boolean = false;

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

      const children = childElements?.map((el) => ToJSType(el)) ?? null;
      const inverse = elseChildElements?.map((el) => ToJSType(el)) ?? null;

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
        } as HBSControlExpression;
      } else if (name === 'unless') {
        return {
          type: 'if',
          isControl: true,
          condition: serializePath(ToJSType(node.params[0]) as string),
          blockParams: node.program.blockParams,
          children: inverse,
          inverse: children,
          isSync: syncValue,
          key: keyValue,
        } as HBSControlExpression;
      } else if (name === 'let') {
        const varScopeName = Math.random().toString(36).substring(7);
        const namesToReplace: Record<string, string> = {};
        const primitives: Set<string> = new Set();
        const vars = node.params.map((p, index) => {
          let isString = p.type === 'StringLiteral';
          let isBoolean = p.type === 'BooleanLiteral';
          let isNumber = p.type === 'NumberLiteral';
          let isNull = p.type === 'NullLiteral';
          let isUndefined = p.type === 'UndefinedLiteral';
          let originalName = node.program.blockParams[index];
          let newName = `Let_${originalName}_${varScopeName}`;
          namesToReplace[originalName] = `${newName}`;
          let castToPrimitive =
            isString || isBoolean || isNull || isUndefined || isNumber;
          if (castToPrimitive) {
            primitives.add(originalName);
            return `let ${newName} = ${ToJSType(p, false)};`;
          } else {
            return `let ${newName} = $:() => ${ToJSType(p)};`;
          }
        });
        // note, at the moment nested let's works fine if no name overlap,
        // looks like fix for other case should be on babel level;
        // @todo - likely should be a babel work
        function fixChildScopes(str: string) {
          // console.log('fixChildScopes', str, JSON.stringify(namesToReplace));
          Object.keys(namesToReplace).forEach((key) => {
            /*
              allow: {{name}} {{foo name}} name.bar
              don't allow: 
                name:
                name=
                foo.name
                'name'
                "name"
            */
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
        const result = `$:...(() => {let self = this;${vars
          .join('')
          .split('this.')
          .join('self.')}return [${fixChildScopes(
          serializeChildren(
            children as unknown as [string | HBSNode | HBSControlExpression],
            'this', // @todo - fix possible context floating here
          ),
        )}]})()`;
        return result;
      }

      return {
        type: name,
        isControl: true,
        condition: serializePath(ToJSType(node.params[0]) as string),
        blockParams: node.program.blockParams,
        isSync: syncValue,
        children: children,
        inverse: inverse,
        key: keyValue,
      } as HBSControlExpression;
    }
  }

  function hasStableChild(node: ASTv1.ElementNode): boolean {
    const childrenWithoutEmptyTextNodes = resolvedChildren(node.children);
    if (childrenWithoutEmptyTextNodes.length === 0) {
      return true;
    }
    // getting first child, and if it's TextElement or just Element node, assume it's stable
    const firstChild = childrenWithoutEmptyTextNodes[0];
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

  const propertyKeys = [
    'class',
    'shadowrootmode',
    // boolean attributes (https://meiert.com/en/blog/boolean-attributes-of-html/)
    'checked',
    'readonly',
    'autoplay',
    'allowfullscreen',
    'async',
    'autofocus',
    'autoplay',
    'controls',
    'default',
    'defer',
    'disabled',
    'formnovalidate',
    'inert',
    'ismap',
    'itemscope',
    'loop',
    'multiple',
    'muted',
    'nomodule',
    'novalidate',
    'open',
    'playsinline',
    'required',
    'reversed',
    'selected',
  ];
  const propsToCast = {
    class: '', // className
  };

  function isAttribute(name: string) {
    return !propertyKeys.includes(name);
  }

  function ElementToNode(element: ASTv1.ElementNode): HBSNode {
    const children = resolvedChildren(element.children)
      .map((el) => ToJSType(el))
      .filter((el) => el !== null);
    
    const rawStyleEvents = element.attributes.filter((attr) => {
      return attr.name.startsWith('style.');
    });
    element.attributes = element.attributes.filter((attr) => {
      return !rawStyleEvents.includes(attr);
    });
    const styleEvents = rawStyleEvents.map((attr) => {
      const propertyName = attr.name.split('.').pop();
      const value = attr.value.type === 'TextNode' ? escapeString(attr.value.chars) : ToJSType(attr.value);
      const isPath = typeof value === 'string' ? value.includes('.') : false;
      return [
        EVENT_TYPE.ON_CREATED,
        `$:function($v,$n){$n.style.setProperty('${propertyName}',$v);}.bind(null,${SYMBOLS.$_TO_VALUE}(${isPath?`$:()=>${value}`: value}))`,
      ];
    });
    const node = {
      tag: element.tag,
      selfClosing: element.selfClosing,
      blockParams: element.blockParams,
      hasStableChild: hasStableChild(element),
      attributes: element.attributes
        .filter((el) => isAttribute(el.name))
        .map((attr) => {
          const rawValue = ToJSType(attr.value);
          // const value = rawValue.startsWith("$:") ? rawValue : escapeString(rawValue);
          return [attr.name, rawValue];
        }),
      properties: element.attributes
        .filter((el) => !isAttribute(el.name))
        .map((attr) => {
          const rawValue = ToJSType(attr.value);
          // const value = rawValue.startsWith("$:") ? rawValue : escapeString(rawValue);
          const castedProp = propsToCast[attr.name as keyof typeof propsToCast];
          return [
            typeof castedProp === 'string' ? castedProp : attr.name,
            rawValue,
          ];
        }),
      events: [...styleEvents,...element.modifiers
        .map((mod) => {
          if (mod.path.type !== 'PathExpression') {
            return null;
          }
          const hashArgs: [string, PrimitiveJSType][] = mod.hash.pairs.map(
            (pair) => {
              return [
                pair.key,
                ToJSType(pair.value, false) as unknown as PrimitiveJSType,
              ];
            },
          );

          if (mod.path.original === 'on') {
            const firstParam = mod.params[0];
            if (firstParam.type === 'StringLiteral') {
              const tail = mod.params
                .slice(2)
                .map((p) => ToJSType(p))
                .join(',');
              return [
                firstParam.original,
                `$:($e, $n) => ${ToJSType(mod.params[1])}($e, $n${
                  tail.length ? `,${tail}` : ''
                })`,
              ];
            } else {
              return null;
            }
          } else {
            return [
              // @me here
              EVENT_TYPE.ON_CREATED,
              `$:($n) => ${toModifier(
                mod.path.original,
                mod.params,
                hashArgs,
              )}`,
            ];
          }
        })
        .filter((el) => el !== null)],
      children: children,
    };
    if (children.length === 1 && typeof children[0] === 'string') {
      const v = children[0];
      if (
        !v.includes(SYMBOLS.SLOT) &&
        !node.tag.startsWith(':') &&
        node.tag.toLowerCase() === node.tag &&
        !v.includes('...') // not LET CASE
      ) {
        node.children = [];
        node.events.push([EVENT_TYPE.TEXT_CONTENT, v]);
      }
    }
    return node as unknown as HBSNode;
  }
  return {
    ToJSType,
    ElementToNode,
  };
}
