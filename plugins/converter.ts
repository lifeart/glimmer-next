import type { ASTv1 } from '@glimmer/syntax';
import {
  HBSControlExpression,
  HBSNode,
  escapeString,
  isPath,
  resolvedChildren,
  serializeChildren,
  serializePath,
  toObject,
} from './utils';
import { EVENT_TYPE, SYMBOLS } from './symbols';

function patchNodePath(node: ASTv1.MustacheStatement | ASTv1.SubExpression) {
  if (node.path.type !== 'PathExpression') {
    return;
  }
  // replacing builtin helpers
  if (node.path.original === 'unless') {
    node.path.original = SYMBOLS.$__if;
    const condTrue = node.params[1];
    const condFalse = node.params[2];
    node.params[1] = condFalse;
    node.params[2] = condTrue;
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
  }
}
export type PrimitiveJSType = null | number | string | boolean | undefined;
export type ComplexJSType = PrimitiveJSType | HBSControlExpression | HBSNode;

export function convert(seenNodes: Set<ASTv1.Node>) {
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
      patchNodePath(node);

      if (node.path.original === 'element') {
        return `$:function(args,props){const $slots={};return{[${
          SYMBOLS.$nodes
        }]:[${SYMBOLS.TAG}(${ToJSType(node.params[0])},[props[${
          SYMBOLS.$propsProp
        }],props[${SYMBOLS.$attrsProp}],props[${SYMBOLS.$eventsProp}]],[()=>${
          SYMBOLS.SLOT
        }('default',()=>[],$slots)], this)[${SYMBOLS.$node}]],[${
          SYMBOLS.$slotsProp
        }]:$slots,index:0, ctx: this};}`;
      } else if (node.path.original === SYMBOLS.$__hash) {
        const hashArgs: [string, PrimitiveJSType][] = node.hash.pairs.map(
          (pair) => {
            return [
              pair.key,
              ToJSType(pair.value) as unknown as PrimitiveJSType,
            ];
          },
        );
        return `$:${node.path.original}(${toObject(hashArgs)})`;
      }
      return `$:${node.path.original}(${node.params
        .map((p) => ToJSType(p))
        .join(',')})`;
    } else if (node.type === 'NumberLiteral') {
      return node.value;
    }
    if (node.type === 'StringLiteral') {
      return escapeString(node.value);
    } else if (node.type === 'TextNode') {
      if (node.chars.trim().length === 0) {
        return null;
      }
      return node.chars;
    } else if (node.type === 'ElementNode') {
      return ElementToNode(node);
    } else if (node.type === 'PathExpression') {
      return `$:${node.original}`;
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
        return null;
      }
      // replacing builtin helpers
      patchNodePath(node);

      if (node.path.original === 'yield') {
        let slotName =
          node.hash.pairs.find((p) => p.key === 'to')?.value || 'default';
        if (typeof slotName !== 'string') {
          slotName = ToJSType(slotName) as unknown as string;
        }
        return `$:() => ${SYMBOLS.SLOT}(${escapeString(
          slotName,
        )}, () => [${node.params.map((p) => ToJSType(p)).join(',')}], $slots)`;
      }
      if (node.params.length === 0) {
        // hash case
        if (node.path.original === SYMBOLS.$__hash) {
          const hashArgs: [string, PrimitiveJSType][] = node.hash.pairs.map(
            (pair) => {
              return [pair.key, ToJSType(pair.value) as PrimitiveJSType];
            },
          );
          return `${wrap ? `$:() => ` : ''}${ToJSType(node.path)}(${toObject(
            hashArgs,
          )})`;
        }
        return ToJSType(node.path);
      } else {
        return `${wrap ? `$:() => ` : ''}${ToJSType(node.path)}(${node.params
          .map((p) => ToJSType(p))
          .map((el) => {
            if (typeof el !== 'string') {
              return String(el);
            }
            return isPath(el) ? serializePath(el, false) : escapeString(el);
          })
          .join(',')})`;
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
      if (name === 'unless') {
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
        const vars = node.params.map((p, index) => {
          let isSubExpression = p.type === 'SubExpression';
          let isString = p.type === 'StringLiteral';
          let isBoolean = p.type === 'BooleanLiteral';
          let isNull = p.type === 'NullLiteral';
          let isUndefined = p.type === 'UndefinedLiteral';
          if (
            isSubExpression ||
            isString ||
            isBoolean ||
            isNull ||
            isUndefined
          ) {
            return `let ${node.program.blockParams[index]} = ${ToJSType(
              p,
              false,
            )};`;
          } else {
            return `let ${node.program.blockParams[index]} = $:() => ${ToJSType(
              p,
            )};`;
          }
        });
        // note, at the moment nested let's works fine if no name overlap,
        // looks like fix for other case should be on babel level;
        const result = `$:...(() => {${vars.join(
          '',
        )}return [${serializeChildren(
          children as unknown as [string | HBSNode | HBSControlExpression],
          'this', // @todo - fix possible context floating here
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
    class: 'className',
  };

  function isAttribute(name: string) {
    return !propertyKeys.includes(name);
  }

  function ElementToNode(element: ASTv1.ElementNode): HBSNode {
    const children = resolvedChildren(element.children)
      .map((el) => ToJSType(el))
      .filter((el) => el !== null);
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
          return [
            propsToCast[attr.name as keyof typeof propsToCast] || attr.name,
            rawValue,
          ];
        }),
      events: element.modifiers
        .map((mod) => {
          if (mod.path.type !== 'PathExpression') {
            return null;
          }
          if (mod.path.original === 'on') {
            const firstParam = mod.params[0];
            if (firstParam.type === 'StringLiteral') {
              return [
                firstParam.original,
                `$:($e, $n) => ${ToJSType(mod.params[1])}($e, $n, ${mod.params
                  .slice(2)
                  .map((p) => ToJSType(p))
                  .join(',')})`,
              ];
            } else {
              return null;
            }
          } else {
            return [
              EVENT_TYPE.ON_CREATED,
              `$:($n) => $:${mod.path.original}($n, ${mod.params
                .map((p) => ToJSType(p))
                .join(',')})`,
            ];
          }
        })
        .filter((el) => el !== null),
      children: children,
    };
    if (children.length === 1 && typeof children[0] === 'string') {
      const v = children[0];
      if (
        !v.includes(SYMBOLS.SLOT) &&
        !node.tag.startsWith(':') &&
        node.tag.toLowerCase() === node.tag
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
