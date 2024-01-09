// https://astexplorer.net/#/gist/c2f0f7e4bf505471c94027c580af8329/c67119639ba9e8fd61a141e8e2f4cbb6f3a31de9
// https://astexplorer.net/#/gist/4e3b4c288e176bb7ce657f9dea95f052/8dcabe8144c7dc337d21e8c771413db30ca5d397
import { preprocess, traverse, ASTv1 } from '@glimmer/syntax';
import { transformSync } from '@babel/core';
import { HBSControlExpression, HBSNode, serializeNode } from './utils';
import { processTemplate, type ResolvedHBS } from './babel';
import { convert } from './converter';

import { SYMBOLS } from './symbols';

function isNodeStable(node: string) {
  return (
    node.trim().startsWith(`${SYMBOLS.TAG}(`) ||
    node.trim().startsWith(`${SYMBOLS.TEXT}(`) ||
    !node.trim().includes('$_')
  );
}

/*

function isSimpleElement(element: ASTv1.ElementNode) {
  return (
    element.tag.charAt(0).toLowerCase() === element.tag.charAt(0) &&
    !element.tag.startsWith(':')
  );
}


export function isAllChildNodesSimpleElements(element: ASTv1.ElementNode): boolean {
  return isSimpleElement(element) && element.children.every((child: ASTv1.Statement) => {
    if (child.type === 'ElementNode') {
      return isAllChildNodesSimpleElements(child);
    } else if (child.type === 'TextNode') {
      return true;
    }
    return false;
  });
}

*/

export function transform(
  source: string,
  fileName: string,
  mode: 'development' | 'production',
) {
  const programs: {
    meta: ResolvedHBS['flags'];
    template: Array<HBSNode | HBSControlExpression>;
  }[] = [];
  const seenNodes: Set<ASTv1.Node> = new Set();
  const rawTxt: string = source;
  const hbsToProcess: ResolvedHBS[] = [];
  const programResults: string[] = [];

  const babelResult = transformSync(rawTxt, {
    plugins: [processTemplate(hbsToProcess, mode)],
    filename: fileName.replace('.gts', '.ts').replace('.gjs', '.js'),
    presets: [
      [
        '@babel/preset-typescript',
        { allExtensions: true, onlyRemoveTypeImports: true },
      ],
    ],
  });

  const txt = babelResult?.code ?? '';

  const { ToJSType, ElementToNode } = convert(seenNodes);

  hbsToProcess.forEach((content) => {
    const flags = content.flags;
    const ast = preprocess(content.template);
    const program: (typeof programs)[number] = {
      meta: flags,
      template: [],
    };
    traverse(ast, {
      MustacheStatement(node) {
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        // @ts-expect-error fix-here
        program.template.push(ToJSType(node));
      },
      TextNode(node) {
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        if (node.chars.trim().length !== 0) {
          // @ts-expect-error fix-here
          program.template.push(ToJSType(node));
        }
      },
      BlockStatement(node) {
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        // @ts-expect-error fix-here
        program.template.push(ToJSType(node));
      },
      ElementNode(node) {
        if (seenNodes.has(node)) {
          return;
        }
        seenNodes.add(node);
        program.template.push(ElementToNode(node));
      },
    });
    programs.push(program);
  });

  programs.forEach((program) => {
    const input: Array<HBSNode | HBSControlExpression> = program.template;

    const results = input.reduce((acc, node) => {
      const serializedNode = serializeNode(node);
      if (typeof serializedNode === 'string') {
        acc.push(serializedNode);
        return acc;
      }
      return acc;
    }, [] as string[]);

    const isClass = txt?.includes('template = ') ?? false;
    const isTemplateTag =
      fileName.endsWith('.gts') || fileName.endsWith('.gjs');

    let result = '';
    let finContext = program.meta.hasThisAccess ? 'this' : 'null';

    if (isTemplateTag) {
      result = `function () {
      const $slots = {};
      const $fw = this.$fw || arguments[1];
      this.args = this.args || arguments[0];
      const roots = [${results.join(', ')}];
      return ${SYMBOLS.FINALIZE_COMPONENT}(roots, $slots, ${String(
        isNodeStable(results[0]) && results.length === 1,
      )}, ${finContext});
    }`;
    } else {
      result = isClass
        ? `() => {
      const $slots = {};
      const $fw = arguments[1];
      const roots = [${results.join(', ')}];
      return ${SYMBOLS.FINALIZE_COMPONENT}(roots, $slots, ${String(
        isNodeStable(results[0]),
      )}, ${finContext});
    }`
        : `(() => {
      const $slots = {};
      const $fw = arguments[1];
      const roots = [${results.join(', ')}];
      return ${SYMBOLS.FINALIZE_COMPONENT}(roots, $slots, ${String(
        isNodeStable(results[0]),
      )}, ${finContext});
    })()`;
    }

    programResults.push(result);
  });

  let src = txt ?? '';

  programResults.forEach((result) => {
    src = src?.replace('$placeholder', result);
  });

  return src.split('$:').join('');
}
