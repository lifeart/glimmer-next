import type { ASTv1 } from '@glimmer/syntax';
import {
  HBSControlExpression,
  HBSNode,
  escapeString,
  isPath,
  resolvedChildren,
  serializePath,
} from './utils';
import { EVENT_TYPE, SYMBOLS } from './symbols';

export function convert(seenNodes: Set<ASTv1.Node>) {
  function ToJSType(node: ASTv1.Node, wrap = true): any {
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
      return `$:${node.path.original}(${node.params
        .map((p) => ToJSType(p))
        .join(',')})`;
    } else if (node.type === 'NumberLiteral') {
      return node.value;
    }
    if (node.type === 'StringLiteral') {
      return node.value;
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
      if (node.path.original === 'yield') {
        let slotName =
          node.hash.pairs.find((p) => p.key === 'to')?.value || 'default';
        if (typeof slotName !== 'string') {
          slotName = ToJSType(slotName);
        }
        return `$:() => ${SYMBOLS.SLOT}('${slotName}', () => [${node.params
          .map((p) => ToJSType(p))
          .join(',')}], $slots)`;
      }
      if (node.params.length === 0) {
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

      return {
        type: name,
        isControl: true,
        condition: ToJSType(node.params[0]),
        blockParams: node.program.blockParams,
        children: childElements?.map((el) => ToJSType(el)) ?? null,
        inverse: elseChildElements?.length
          ? elseChildElements.map((el) => ToJSType(el))
          : null,
        key: keyPair ? ToJSType(keyPair.value) : null,
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
                ToJSType(firstParam),
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
      if (!v.includes(SYMBOLS.SLOT)) {
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
