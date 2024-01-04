// https://astexplorer.net/#/gist/c2f0f7e4bf505471c94027c580af8329/c67119639ba9e8fd61a141e8e2f4cbb6f3a31de9
// https://astexplorer.net/#/gist/4e3b4c288e176bb7ce657f9dea95f052/8dcabe8144c7dc337d21e8c771413db30ca5d397
import { preprocess, traverse, ASTv1 } from "@glimmer/syntax";
import { transformSync } from "@babel/core";
import { HBSControlExpression, HBSNode, serializeNode } from "./utils";
import { processTemplate } from "./babel";
import { convert } from "./converter";

function isNodeStable(node: string) {
  return (
    node.trim().startsWith("DOM(") ||
    node.trim().startsWith("DOM.text(") ||
    !node.trim().includes("DOM")
  );
}

export function transform(source: string, fileName: string) {
  const programs: Array<HBSNode | HBSControlExpression>[] = [];
  const seenNodes: Set<ASTv1.Node> = new Set();
  const rawTxt: string = source;
  const hbsToProcess: string[] = [];
  const programResults: string[] = [];

  const babelResult = transformSync(rawTxt, {
    plugins: [processTemplate(hbsToProcess)],
    filename: fileName.replace('.gts', '.ts').replace('.gjs', '.js'),
    presets: ["@babel/preset-typescript"],
  });

  const txt = babelResult?.code ?? "";

  const { ToJSType, ElementToNode } = convert(seenNodes);

  hbsToProcess.forEach((content) => {
    const ast = preprocess(content);
    const program: (typeof programs)[number] = [];
    traverse(ast, {
      MustacheStatement(node) {
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        program.push(ToJSType(node));
      },
      TextNode(node) {
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        if (node.chars.trim().length !== 0) {
          program.push(ToJSType(node));
        }
      },
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
    programs.push(program);
  });

  programs.forEach((program) => {
    const input: Array<HBSNode | HBSControlExpression> = program;

    const results = input.reduce((acc, node) => {
      const serializedNode = serializeNode(node);
      if (typeof serializedNode === "string") {
        acc.push(serializedNode);
        return acc;
      }
      return acc;
    }, [] as string[]);

    const isClass = txt?.includes("template = ") ?? false;
    const isTemplateTag = fileName.endsWith(".gts");

    let result = "";

    if (isTemplateTag) {
      result = `function () {
      const $slots = {};
      const $fw = this.$fw;
      const roots = [${results.join(", ")}];
      return $fin(roots, $slots, ${String(isNodeStable(results[0]))}, this);
    }`;
    } else {
      result = isClass
        ? `() => {
      const $slots = {};
      const $fw = arguments[1];
      const roots = [${results.join(", ")}];
      return $fin(roots, $slots, ${String(isNodeStable(results[0]))}, this);
    }`
        : `(() => {
      const $slots = {};
      const $fw = arguments[1];
      const roots = [${results.join(", ")}];
      return $fin(roots, $slots, ${String(isNodeStable(results[0]))}, this);
    })()`;
    }

    programResults.push(result);
  });

  let src = txt ?? "";

  programResults.forEach((result) => {
    src = txt?.replace("$placeholder", result);
  });

  return src.split("$:").join("");
}
