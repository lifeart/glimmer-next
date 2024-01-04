import type { ASTv1 } from "@glimmer/syntax";

export type HBSControlExpression = {
  type: "each" | "if";
  isControl: true;
  condition: string;
  blockParams: string[];
  children: Array<HBSNode | string>;
  inverse: Array<HBSNode | string> | null;
  key: string | null;
};

export type HBSNode = {
  tag: string;
  attributes: [string, null | undefined | string | number | boolean][];
  properties: [string, null | undefined | string | number | boolean][];
  selfClosing: boolean;
  hasStableChild: boolean;
  blockParams: string[];
  events: [string, string][];
  children: (string | HBSNode | HBSControlExpression)[];
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
    if (
      el.type === "CommentStatement" ||
      el.type === "MustacheCommentStatement"
    ) {
      return false;
    }
    return el.type !== "TextNode" || el.chars.trim().length !== 0;
  });
}

export function serializeChildren(
  children: Array<string | HBSNode | HBSControlExpression>
) {
  if (children.length === 0) {
    return "null";
  }
  return `${children
    .map((child) => {
      if (typeof child === "string") {
        if (isPath(child)) {
          return serializePath(child);
        }
        return `DOM.text('${child}')`;
      }
      return serializeNode(child);
    })
    .join(", ")}`;
}

function toChildArray(childs: Array<HBSNode | string> | null): string {
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

export function serializeAttribute(
  key: string,
  value: null | undefined | string | number | boolean
): string {
  if (typeof value === "boolean") {
    return `['${key}', ${String(value)}]`;
  } else if (typeof value === "number") {
    return `['${key}', ${value}]`;
  } else if (value === null) {
    return `['${key}', null]`;
  } else if (typeof value === "undefined") {
    return `['${key}', undefined]`;
  }
  if (isPath(value)) {
    return `['${key}', ${serializePath(value)}]`;
  }
  return `['${key}', ${escapeString(value)}]`;
}

function serializeProp(
  attr: [string, string | undefined | null | number | boolean]
): string {
  if (attr[1] === null) {
    return `${toPropName(attr[0])}: null`;
  } else if (typeof attr[1] === "boolean") {
    return `${toPropName(attr[0])}: ${attr[1]}`;
  } else if (typeof attr[1] === "number") {
    return `${toPropName(attr[0])}: ${attr[1]}`;
  } else if (typeof attr[1] === "undefined") {
    return `${toPropName(attr[0])}: undefined`;
  }
  const isScopeValue = isPath(attr[1]);
  return `${toPropName(attr[0])}: ${
    isScopeValue ? serializePath(attr[1]) : escapeString(attr[1])
  }`;
}

function toObject(args: [string, string | number | boolean | null | undefined][]) {
  return `{${args.map((attr) => serializeProp(attr)).join(", ")}}`;
}
function toArray(args: [string, string | number | boolean | null | undefined][]) {
  return `[${args.map((attr) => serializeAttribute(attr[0], attr[1])).join(", ")}]`;
}

export function serializeNode(
  node: string | null | HBSNode | HBSControlExpression
): string | undefined | null {
  if (node === null) {
    return null;
  }

  if (typeof node === "object" && "isControl" in node) {
    // control node (each)
    const key = `@${node.type}`;
    const arrayName = node.condition;
    const paramNames = node.blockParams;
    const childs = node.children;
    const inverses = node.inverse;
    let eachKey = node.key;

    if (eachKey === "@index") {
      console.warn("@index identity not supported");
      eachKey = "@identity";
    }

    if (key === "@each") {
      return `DOM.each(${arrayName}, (${paramNames.join(",")}) => ${toChildArray(childs)}, ${eachKey ? escapeString(eachKey) : null})`;
    } else if (key === "@if") {
      return `DOM.if(${arrayName}, () => ${toChildArray(childs)}, () => ${toChildArray(inverses)} )`;
    }
  } else if (
    typeof node === "object" &&
    node.tag &&
    node.tag.toLowerCase() !== node.tag
  ) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === "...attributes";
    });
    const args = node.attributes.filter((attr) => {
      return attr[0].startsWith('@');
    });
    const attrs = node.attributes.filter((attr) => {
      return !attr[0].startsWith('@');
    });
    const props = node.properties;
    const secondArg = hasSplatAttrs ?  `{attrs: [...$fw.attrs, ...${toArray(attrs)}], props: [...$fw.props, ...${toArray(props)}], events: [...$fw.events,...${toArray(node.events)}]}` : `{attrs: ${toArray(attrs)}, props: ${toArray(props)}, events: ${toArray(node.events)}}`;

    if (node.selfClosing) {
      return `DOM.c(new ${node.tag}(${toObject(args)}, ${secondArg}))`;
    } else {
      let slotChildren = serializeChildren(node.children);
      return `DOM.withSlots(DOM.c(new ${node.tag}(${toObject(node.attributes)}, ${secondArg}), { default: (${node.blockParams.join(",")}) => ${
        slotChildren !== "null" ? `[${slotChildren}]` : "[]"
      } }))`;
    }
  } else if (typeof node === "object" && node.tag) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === "...attributes";
    });
    return `DOM('${node.tag}', {
      events: ${toArray(node.events)},
      properties: ${toArray(node.properties)}, 
      attributes: ${toArray(node.attributes)}
      ${hasSplatAttrs ? `, fw: $fw,` : ""}
    }, ${serializeChildren(node.children)} )`;
  } else {
    if (typeof node === "string") {
      if (isPath(node)) {
        return serializePath(node);
      } else {
        return `DOM.text(\`${node}\`)`;
      }
    }
    throw new Error("Unknown node type: " + JSON.stringify(node, null, 2));
  }
}
