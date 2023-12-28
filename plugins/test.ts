// https://astexplorer.net/#/gist/c2f0f7e4bf505471c94027c580af8329/c67119639ba9e8fd61a141e8e2f4cbb6f3a31de9
// https://astexplorer.net/#/gist/4e3b4c288e176bb7ce657f9dea95f052/8dcabe8144c7dc337d21e8c771413db30ca5d397
import { preprocess, traverse, ASTv1 } from "@glimmer/syntax";
import { transformSync } from "@babel/core";
import type Babel from "@babel/core";

export function transform(source: string, fileName: string) {
  const program: Array<HBSNode | HBSExpression> = [];
  const seenNodes = new Set();

  const rawTxt: string = source;

  let hbsToProcess = "";

  function babelPlugin(babel: { types: typeof Babel.types }) {
    const { types: t } = babel;

    return {
      name: "ast-transform", // not required
      visitor: {
        Program(path: any) {
          path.node.body.unshift(
            t.importDeclaration(
              [t.importSpecifier(t.identifier("DOM"), t.identifier("DOM"))],
              t.stringLiteral("@/utils/dom")
            )
          );
        },
        TaggedTemplateExpression(path: any) {
          if (path.node.tag.name === "hbs") {
            hbsToProcess = path.node.quasi.quasis[0].value.raw;
            path.replaceWith(t.identifier("$placeholder"));
          }
        },
      },
    };
  }

  const babelResult = transformSync(rawTxt, {
    plugins: [babelPlugin],
    filename: fileName,
    presets: ["@babel/preset-typescript"],
  });

  const txt = babelResult?.code ?? "";

  function ToJSType(node: ASTv1.Node): any {
    seenNodes.add(node);
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
      return ToJSType(node.path);
    } else if (node.type === "BlockStatement") {
      if (!node.params.length) {
        return null;
      }
      if (node.params[0].type === "SubExpression") {
        return null;
      }
      const childElements = node.program.body.filter((node) => {
        return node.type === "ElementNode" || node.type === "TextNode";
      });
      const elseChildElements = node.inverse?.body.filter((node) => {
        return node.type === "ElementNode" || node.type === "TextNode";
      });
      if (!childElements.length) {
        return null;
      }
      if (node.path.type !== 'PathExpression') {
        return null;
      }
      const name = node.path.original;

      return [
        `@${name}`,
        node.params[0].original,
        node.program.blockParams[0] ?? null,
        childElements?.map((el) => ToJSType(el)) ?? null,
        elseChildElements?.length ? elseChildElements.map((el) => ToJSType(el)) : null,
      ];
    }
  }

  function escapeString(str: string) {
    const lines = str.split("\n");
    if (lines.length === 1) {
      if (str.startsWith("'")) {
        return str;
      } else if (str.startsWith('"')) {
        return str;
      } else {
        return `"${str}"`;
      }
    } else {
      return `\`${str}\``;
    }
    
  }

  function ElementToNode(element: ASTv1.ElementNode): HBSNode {
    const node = {
      tag: element.tag,
      attributes: element.attributes.map((attr) => {
        const rawValue = ToJSType(attr.value);
        // const value = rawValue.startsWith("$:") ? rawValue : escapeString(rawValue);
        return [attr.name, rawValue];
      }),
      events: element.modifiers
        .map((mod) => {
          const firstParam = mod.params[0];
          if (firstParam.type === "StringLiteral") {
            return [ToJSType(firstParam), ToJSType(mod.params[1])];
          } else {
            return null;
          }
        })
        .filter((el) => el !== null),
      children: element.children
        .map((el) => ToJSType(el))
        .filter((el) => el !== null),
    };
    return node as unknown as HBSNode;
  }

  const ast = preprocess(hbsToProcess);

  traverse(ast, {
    BlockStatement(node) {
      if (seenNodes.has(node)) {
        return;
      }
      seenNodes.add(node);
      program.push(ToJSType(node));
    },
    ElementNode(node) {
      if (seenNodes.has(node)) {
        return;
      }
      seenNodes.add(node);
      program.push(ElementToNode(node));
    },
  });

  type HBSExpression = [string, string, string | null, HBSNode[], HBSNode[] | null];

  type HBSNode = {
    tag: string;
    attributes: [string, string][];
    events: [string, string][];
    children: (string | HBSNode | HBSExpression)[];
  };

  const input: Array<HBSNode | HBSExpression> = program;

  function serializeAttribute(key: string, value: string): string {
    if (value.startsWith("$:")) {
      return `['${key}', ${value.replace("$:", "")}]`;
    }
    return `['${key}', ${escapeString(value)}]`;
  }
  function serializeChildren(
    children: Array<string | HBSNode | HBSExpression>
  ) {
    if (children.length === 0) {
      return "null";
    }
    return `${children
      .map((child) => {
        if (typeof child === "string") {
          if (child.startsWith("$:")) {
            return `${child.replace("$:", "")}`;
          }
          return `'${child}'`;
        }
        return serializeNode(child);
      })
      .join(", ")}`;
  }

  function serializeNode(node: string | null | HBSNode | HBSExpression): string | undefined | null {
    if (node === null) {
      return null;
    }
    if (Array.isArray(node)) {
      // control node (each)
      const [key, arrayName, , childs, inverses] = node;

      if (key === "@each") {
        return `DOM.each(${arrayName}, (item) => {
          return [${childs.map((child) => serializeNode(child)).filter((el) => el).join(", ")}];
        })`;
      } else if (key === '@if') {
        return `DOM.if(${arrayName}, () => {
          return [${childs.map((child) => serializeNode(child)).filter((el) => el).join(", ")}];
        }, () => {
          return [${inverses?.map((child) => serializeNode(child)).filter((el) => el).join(", ") ?? "null"}];
        })`;
      }
    } else if (typeof node === 'object' && node.tag && node.tag.toLowerCase() !== node.tag) {
      // it's component function
      return `${node.tag}({
        ${node.attributes
          .map((attr) => {
            const isScopeValue = attr[1].startsWith("$:");
            return `${attr[0].replace("@", "")}: ${
              isScopeValue ? attr[1].replace("$:", "") : escapeString(attr[1])
            }`;
          })
          .join(", ")}
      })`;
    } else if (typeof node === 'object' && node.tag) {
      return `DOM('${node.tag}', {
        events: [${node.events
          .map((attr) => {
            return serializeAttribute(attr[0], attr[1]);
          })
          .join(", ")}],
        attributes: [${node.attributes
          .map((attr) => {
            return serializeAttribute(attr[0], attr[1]);
          })
          .join(", ")}]
      }, ${serializeChildren(node.children)} )`;
    } else {
      if (typeof node === "string") {
        return `DOM.text(\`${node}\`)`;
      }
      throw new Error("Unknown node type: " + JSON.stringify(node, null, 2));
    }
  }

  const results = input.reduce((acc, node) => {
    const serializedNode = serializeNode(node);
    if (typeof serializedNode === "string") {
      acc.push(serializedNode);
      return acc;
    }
    return acc;
  }, [] as string[]);

  const result = `(() => {
    const roots = [${results.join(", ")}];
    const existingDestructors = typeof destructors !== 'undefined' ? destructors : [];
    return {
      nodes: roots.reduce((acc, root) => {
        if ('nodes' in root) {
          return [...acc, ...root.nodes];
        } else {
          return [...acc, root.node];
        }
      }, []),
      destructors: roots.reduce((acc, root) => {
        return [...acc, ...root.destructors];
      }, existingDestructors),
      index: 0,
    }
  })()`;

  return txt?.replace("$placeholder", result);
}
