export type HBSExpression = [
  string,
  string,
  string | null,
  HBSNode[],
  HBSNode[] | null
];

export type HBSNode = {
  tag: string;
  attributes: [string, string][];
  selfClosing: boolean;
  blockParams: string[];
  events: [string, string][];
  children: (string | HBSNode | HBSExpression)[];
};

export function escapeString(str: string) {
  const lines = str.split("\n");
  if (lines.length === 1) {
    if (str.startsWith("@")) {
      return str.replace("@", "this.args.");
    } else if (str.startsWith("'")) {
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

export function serializeAttribute(key: string, value: string): string {
  if (value.startsWith("$:")) {
    return `['${key}', ${value.replace("$:", "").replace("@", "this.args.")}]`;
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
        if (child.startsWith("$:")) {
          return `${child.replace("$:", "").replace("@", "this.args.")}`;
        }
        return `DOM.text('${child}')`;
      }
      return serializeNode(child);
    })
    .join(", ")}`;
}

export function serializeNode(
  node: string | null | HBSNode | HBSExpression
): string | undefined | null {
  if (node === null) {
    return null;
  }

  if (Array.isArray(node)) {
    // control node (each)
    const [key, arrayName, , childs, inverses] = node;

    if (key === "@each") {
      return `DOM.each(${arrayName}, (item) => {
        return [${childs
          .map((child) => serializeNode(child))
          .filter((el) => el)
          .join(", ")}];
      })`;
    } else if (key === "@if") {
      return `DOM.if(${arrayName}, () => {
        return [${childs
          .map((child) => serializeNode(child))
          .filter((el) => el)
          .join(", ")}];
      }, () => {
        return [${
          inverses
            ?.map((child) => serializeNode(child))
            .filter((el) => el)
            .join(", ") ?? "null"
        }];
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
            if (attr[1] === null) {
              return `${attr[0].replace("@", "")}: null`;
            } else if (typeof attr[1] === "boolean") {
              return `${attr[0].replace("@", "")}: ${attr[1]}`;
            }
            const isScopeValue = attr[1].startsWith("$:");
            return `${attr[0].replace("@", "")}: ${
              isScopeValue
                ? attr[1].replace("$:", "").replace("@", "this.args.")
                : escapeString(attr[1])
            }`;
          })
          .join(", ")}
      }))`;
    } else {
      let slotChildren = serializeChildren(node.children);
      return `DOM.withSlots(DOM.c(new ${node.tag}({
        ${node.attributes
          .map((attr) => {
            const isScopeValue = attr[1].startsWith("$:");
            return `${attr[0].replace("@", "")}: ${
              isScopeValue
                ? attr[1].replace("$:", "").replace("@", "this.args.")
                : escapeString(attr[1])
            }`;
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
      if (node.startsWith("$:")) {
        return (
          `DOM.text(` + node.replace("$:", "").replace("@", "this.args.") + `)`
        );
      } else {
        return `DOM.text(\`${node}\`)`;
      }
    }
    throw new Error("Unknown node type: " + JSON.stringify(node, null, 2));
  }
}
