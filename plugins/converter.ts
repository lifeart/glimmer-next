import type { ASTv1 } from "@glimmer/syntax";
import { HBSNode, escapeString } from "./utils";

export function convert(seenNodes: Set<ASTv1.Node>) {
  function ToJSType(node: ASTv1.Node): any {
    seenNodes.add(node);
    if (node.type === "UndefinedLiteral") {
      return undefined;
    } else if (node.type === "NullLiteral") {
      return null;
    } else if (node.type === "BooleanLiteral") {
      return node.value;
    } else if (node.type === "SubExpression") {
      if (node.path.type !== "PathExpression") {
        return null;
      }
      return `${node.path.original}(${node.params
        .map((p) => ToJSType(p))
        .join(",")})`;
    } else if (node.type === "NumberLiteral") {
      return node.value;
    }
    if (node.type === "StringLiteral") {
      return node.value;
    } else if (node.type === "TextNode") {
      if (node.chars.trim().length === 0) {
        return null;
      }
      return node.chars;
    } else if (node.type === "ElementNode") {
      return ElementToNode(node);
    } else if (node.type === "PathExpression") {
      return `$:${node.original}`;
    } else if (node.type === "MustacheStatement") {
      if (node.path.type !== "PathExpression") {
        if (node.path.type === "BooleanLiteral") {
          return node.path.value;
        }
        return null;
      }
      if (node.path.original === "yield") {
        return `$:() => DOM.slot('default', () => [${node.params
          .map((p) => ToJSType(p))
          .join(",")}], $slots)`;
      }
      if (node.params.length === 0) {
        return ToJSType(node.path);
      } else {
        return `$:() => ${ToJSType(node.path)}(${node.params
          .map((p) => ToJSType(p))
          .map((el) => {
            if (typeof el !== "string") {
              return String(el);
            }
            return el.startsWith("$:")
              ? el.replace("$:", "").replace("@", "this.args.")
              : escapeString(el);
          })
          .join(",")})`;
      }
    } else if (node.type === "BlockStatement") {
      if (!node.params.length) {
        return null;
      }
      if (node.params[0].type === "SubExpression") {
        return null;
      }
      const childElements = node.program.body.filter((node) => {
        return (
          node.type === "ElementNode" ||
          node.type === "TextNode" ||
          node.type === "MustacheStatement"
        );
      });
      const elseChildElements = node.inverse?.body.filter((node) => {
        return (
          node.type === "ElementNode" ||
          node.type === "TextNode" ||
          node.type === "MustacheStatement"
        );
      });
      if (!childElements.length) {
        return null;
      }
      if (node.path.type !== "PathExpression") {
        return null;
      }
      const name = node.path.original;

      return [
        `@${name}`,
        node.params[0].original,
        node.program.blockParams[0] ?? null,
        childElements?.map((el) => ToJSType(el)) ?? null,
        elseChildElements?.length
          ? elseChildElements.map((el) => ToJSType(el))
          : null,
      ];
    }
  }

  function ElementToNode(element: ASTv1.ElementNode): HBSNode {
    const node = {
      tag: element.tag,
      selfClosing: element.selfClosing,
      blockParams: element.blockParams,
      attributes: element.attributes.map((attr) => {
        const rawValue = ToJSType(attr.value);
        // const value = rawValue.startsWith("$:") ? rawValue : escapeString(rawValue);
        return [attr.name, rawValue];
      }),
      events: element.modifiers
        .map((mod) => {
          if (mod.path.type !== "PathExpression") {
            return null;
          }
          if (mod.path.original === "on") {
            const firstParam = mod.params[0];
            if (firstParam.type === "StringLiteral") {
              return [ToJSType(firstParam), ToJSType(mod.params[1])];
            } else {
              return null;
            }
          } else {
            return [
              "onCreated",
              `$:(node) => { return ${mod.path.original}(node, [${mod.params
                .map((p) => ToJSType(p))
                .join(",")}]) }`,
            ];
          }
        })
        .filter((el) => el !== null),
      children: element.children
        .map((el) => ToJSType(el))
        .filter((el) => el !== null),
    };
    return node as unknown as HBSNode;
  }
  return {
    ToJSType,
    ElementToNode,
  };
}
