// https://astexplorer.net/#/gist/c2f0f7e4bf505471c94027c580af8329/c67119639ba9e8fd61a141e8e2f4cbb6f3a31de9
// https://astexplorer.net/#/gist/4e3b4c288e176bb7ce657f9dea95f052/8dcabe8144c7dc337d21e8c771413db30ca5d397
import { preprocess, traverse, type ASTv1 } from '@glimmer/syntax';
import {
  type PluginItem,
  transformSync,
  transformAsync,
  BabelFileResult,
} from '@babel/core';
import {
  type HBSControlExpression,
  type HBSNode,
  serializeNode,
  setBindings,
} from './utils';
import { processTemplate, type ResolvedHBS } from './babel';
import { convert } from './converter';
// @ts-expect-error
import tsPreset from '@babel/preset-typescript';
import _dT from './decorator-transforms/index';
// console.table(_dT);

import { SYMBOLS } from './symbols';
import type { Flags } from './flags';

function isSimpleElement(element: ASTv1.ElementNode) {
  const tag = element.tag;
  if (tag.includes('.') || tag.startsWith(':')) {
    return false;
  }
  return tag.toLowerCase() === tag;
}

export function isAllChildNodesSimpleElements(children: ASTv1.Node[]): boolean {
  return children.every((child: ASTv1.Node) => {
    if (child.type === 'ElementNode') {
      return (
        isSimpleElement(child) && isAllChildNodesSimpleElements(child.children)
      );
    } else if (child.type === 'TextNode') {
      return true;
    } else if (child.type === 'MustacheCommentStatement') {
      return true;
    } else if (child.type === 'CommentStatement') {
      return true;
    } else if (child.type === 'MustacheStatement') {
      if (child.path.type !== 'PathExpression') {
        return false;
      } else if (
        child.path.original === 'yield' ||
        child.path.original === 'outlet'
      ) {
        return false;
      } else if (child.path.data) {
        return true;
      }
    }
    return false;
  });
}

type Programs = {
  meta: ResolvedHBS['flags'];
  bindings: ResolvedHBS['bindings'];
  template: Array<HBSNode | HBSControlExpression>;
}[];

function processTransformedFiles(
  babelResult: BabelFileResult | null,
  hbsToProcess: ResolvedHBS[],
  seenNodes: Set<ASTv1.Node>,
  flags: Flags,
  fileName: string,
  programs: Programs,
  programResults: string[],
) {
  const txt = babelResult?.code ?? '';

  const globalFlags = flags;

  hbsToProcess.forEach((content) => {
    const flags = content.flags;
    const bindings = content.bindings;
    const { ToJSType, ElementToNode } = convert(
      seenNodes,
      globalFlags,
      bindings,
    );
    const ast = preprocess(content.template);
    const program: (typeof programs)[number] = {
      meta: flags,
      bindings,
      template: [],
    };
    traverse(ast, {
      Template(node) {
        const isSimple = isAllChildNodesSimpleElements(node.body);
        if (!isSimple && flags.hasThisAccess === false) {
          flags.hasThisAccess = true;
        }
      },
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
      ElementNode: {
        enter(node) {
          if (seenNodes.has(node)) {
            return;
          }
          node.blockParams.forEach((p) => {
            bindings.add(p);
          });
          seenNodes.add(node);
          program.template.push(ElementToNode(node));
        },
        exit(node) {
          node.blockParams.forEach((p) => {
            bindings.delete(p);
          });
        },
      },
    });
    programs.push(program);
  });

  programs.forEach((program) => {
    const input: Array<HBSNode | HBSControlExpression> = program.template;

    setBindings(program.bindings);
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
    let finContext = program.meta.hasThisAccess ? 'this' : 'this';
    const hasFw = results.some((el) => el.includes('$fw'));
    const hasSlots = results.some((el) => el.includes('$slots'));
    const slotsResolution = `const $slots = ${SYMBOLS.$_GET_SLOTS}(this, arguments);`;
    const maybeFw = `${
      hasFw ? `const $fw = ${SYMBOLS.$_GET_FW}(this, arguments);` : ''
    }`;
    const maybeSlots = `${hasSlots ? slotsResolution : ''}`;
    const declareRoots = `const roots = [${results.join(', ')}];`;
    const declareReturn = `return ${SYMBOLS.FINALIZE_COMPONENT}(roots, ${finContext});`;

    if (isTemplateTag) {
      result = `function () {
      ${maybeFw}
      ${SYMBOLS.$_GET_ARGS}(this, arguments);
      ${maybeSlots}
      ${declareRoots}
      ${declareReturn}
    }`;
    } else {
      result = isClass
        ? `() => {
      ${maybeSlots}
      ${maybeFw}
      ${declareRoots}
      ${declareReturn}
    }`
        : `(() => {
      ${SYMBOLS.$_GET_ARGS}(this, arguments);
      ${maybeSlots}
      ${maybeFw}
      ${declareRoots}
      ${declareReturn}
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

export function transform(
  source: string,
  fileName: string,
  mode: 'development' | 'production',
  isLibBuild: boolean = false,
  flags: Flags,
) {
  const programs: Programs = [];
  const seenNodes: Set<ASTv1.Node> = new Set();
  const rawTxt: string = source;
  const hbsToProcess: ResolvedHBS[] = [];
  const programResults: string[] = [];
  const isAsync = flags.ASYNC_COMPILE_TRANSFORMS;

  const plugins: PluginItem[] = [processTemplate(hbsToProcess, mode)];
  if (!isLibBuild) {
    plugins.push('module:decorator-transforms');
  }
  const replacedFileName = fileName
    .replace('.gts', '.ts')
    .replace('.gjs', '.js');
  const babelConfig = {
    plugins,
    filename: replacedFileName,
    presets: [
      [
        '@babel/preset-typescript',
        { allExtensions: true, onlyRemoveTypeImports: true },
      ],
    ],
  };

  if (isAsync) {
    return transformAsync(rawTxt, babelConfig).then((babelResult) => {
      return processTransformedFiles(
        babelResult,
        hbsToProcess,
        seenNodes,
        flags,
        fileName,
        programs,
        programResults,
      );
    });
  } else {
    const babelResult = transformSync(rawTxt, babelConfig);
    return processTransformedFiles(
      babelResult,
      hbsToProcess,
      seenNodes,
      flags,
      fileName,
      programs,
      programResults,
    );
  }
}
