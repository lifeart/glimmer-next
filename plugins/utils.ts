import type { ASTv1 } from "@glimmer/syntax";

export type HBSExpression = [
  string,
  string,
  string | null,
  Array<HBSNode|string>,
  HBSNode[] | null
];

export type HBSNode = {
  tag: string;
  attributes: [string, string][];
  selfClosing: boolean;
  hasStableChild: boolean;
  blockParams: string[];
  events: [string, string][];
  children: (string | HBSNode | HBSExpression)[];
};

export function escapeString(str: string) {
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

export function isPath(str: string) {
  return str.startsWith("$:");
}

export function serializePath(p: string): string {
  return p.replace("$:", "").replace("@", "this.args.");
}

export function resolvedChildren(els: ASTv1.Node[]) {
  return els.filter((el) => {
    if (el.type === 'CommentStatement' || el.type === 'MustacheCommentStatement') {
      return false;
    }
    return el.type !== "TextNode" || el.chars.trim().length !== 0;
  });
}

export function serializeAttribute(key: string, value: string): string {
  if (isPath(value)) {
    return `['${key}', ${serializePath(value)}]`;
  }
  return `['${key}', ${escapeString(value)}]`;
}

export function serializeChildren(
  children: Array<string | HBSNode | HBSExpression>
) {
  if (children.length === 0) {
    return "null";
  }
  return `${children
    .map((child) => {
      if (typeof child === "string") {
        if (isPath(child)) {
          return `${serializePath(child)}`;
        }
        return `DOM.text('${child.trim()}')`;
      }
      return serializeNode(child);
    })
    .join(", ")}`;
}

function toChildArray(childs: Array<HBSNode|string> | null): string {
  if (!childs) {
    return "[null]";
  }
  return `[${childs
    .map((child) => serializeNode(child))
    .filter((el) => el)
    .join(", ")}]`;
}

function toPropName(name: string) {
  return name.replace("@", "");
}

function serializeProp(attr: [string, string | null]): string {
  if (attr[1] === null) {
    return `${toPropName(attr[0])}: null`;
  } else if (typeof attr[1] === "boolean") {
    return `${toPropName(attr[0])}: ${attr[1]}`;
  }
  const isScopeValue = isPath(attr[1]);
  return `${toPropName(attr[0])}: ${
    isScopeValue ? serializePath(attr[1]) : escapeString(attr[1])
  }`;
}

export function serializeNode(
  node: string | null | HBSNode | HBSExpression
): string | undefined | null {
  if (node === null) {
    return null;
  }

  if (Array.isArray(node)) {
    // control node (each)
    const [key, arrayName, paramName, childs, inverses] = node;

    if (key === "@each") {
      return `DOM.each(${arrayName}, (${paramName}) => {
        return ${toChildArray(childs)};
      })`;
    } else if (key === "@if") {
      return `DOM.if(${arrayName}, () => {
        return ${toChildArray(childs)};
      }, () => {
        return ${toChildArray(inverses)};
      })`;
    }
  } else if (
    typeof node === "object" &&
    node.tag &&
    node.tag.toLowerCase() !== node.tag
  ) {
    // it's component function
    if (node.selfClosing) {
      return `DOM.c(new ${node.tag}({
        ${node.attributes
          .map((attr) => {
            return serializeProp(attr);
          })
          .join(", ")}
      }))`;
    } else {
      let slotChildren = serializeChildren(node.children);
      return `DOM.withSlots(DOM.c(new ${node.tag}({
        ${node.attributes
          .map((attr) => {
            return serializeProp(attr);
          })
          .join(", ")}
      }), { default: (${node.blockParams.join(",")}) => ${
        slotChildren !== "null" ? `[${slotChildren}]` : "[]"
      } }))`;
    }
  } else if (typeof node === "object" && node.tag) {
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
      if (isPath(node)) {
        return `DOM.text(` + serializePath(node) + `)`;
      } else {
        return `DOM.text(\`${node.trim()}\`)`;
      }
    }
    throw new Error("Unknown node type: " + JSON.stringify(node, null, 2));
  }
}
