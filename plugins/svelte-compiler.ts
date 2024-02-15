// @ts-check

import * as parser from 'svelte/compiler';
import { print } from 'code-red';
import { SYMBOLS, MAIN_IMPORT } from './symbols.js';
import MagicString from 'magic-string';
import plugin from './bebel-svelte';
import { transformSync } from '@babel/core';
import synchronizedPrettier from '@prettier/sync';

import type {
  Attribute,
  BaseDirective,
  BaseExpressionDirective,
  BaseNode,
  Element,
  MustacheTag,
  SpreadAttribute,
  Text,
} from 'svelte/types/compiler/interfaces';

const importsPrefix = `
  import { ${Object.values(SYMBOLS).join(',')} } from "${MAIN_IMPORT}";
`;
let magic = new MagicString('');

function applyBabelTransform(code: string) {
  let babelResult = null;
  try {
    babelResult = transformSync(code, {
      plugins: [plugin],
      filename: 'item.ts',
      presets: [
        [
          '@babel/preset-typescript',
          { allExtensions: true, onlyRemoveTypeImports: true },
        ],
      ],
    });
  } catch (e) {
    // loc: Position { line: 3, column: 731, index: 739 }
    // let's extract error code based on loc
    // @ts-expect-error loc may not exist
    const loc = e.loc;
    const lines = code.split('\n');
    const line = lines[loc.line - 1];
    const start = loc.column - 30;
    const end = loc.column + 20;
    // we need to wrap error with << and >> to make it visible
    const errorPrefix = line.substring(start, loc.column);
    const errorSuffix = line.substring(loc.column + 2, end);
    console.log(
      // @ts-expect-error
      e.reasonCode,
      errorPrefix +
        '>>' +
        line.substring(loc.column + 1, loc.column + 2) +
        '<<' +
        errorSuffix,
    );
  }

  const txt = babelResult?.code ?? '';

  return txt;
}

export function compile(code = '', fileName = 'unknown') {
  const componentName = fileName.split('.svelte').pop();
  magic = new MagicString(code, {
    filename: fileName,
  });
  // code-red
  const result = parser.compile(code, {
    dev: true,
    preserveWhitespace: false,
    preserveComments: false,
    enableSourcemap: false,
    generate: 'dom',
    varsReport: 'strict',
    immutable: false,
    hydratable: false,
    legacy: false,
    css: 'external',
  });

  // console.log('ast', JSON.stringify(result.ast, null, 2));

  const script = result.ast.instance
    ? print(result.ast.instance.content).code
    : '';

  const template = result.ast.html.children
    ? result.ast.html.children.map(transform).join(',')
    : '';

  const imports = script.split('\n').filter((el) => el.includes('import '));
  const content = script.split('\n').filter((el) => !el.includes('import '));

  magic.prepend(`
  ${importsPrefix}
  ${imports.join('\n')}
  `);

  let map = magic.generateMap({
    source: fileName,
    file: fileName + '.map',
    includeContent: true,
  });

  let codeResult = `
  ${importsPrefix}
  ${imports.join('\n')}
  export default function ${componentName}(args) {
    const $fw = ${SYMBOLS.$_GET_FW}(this, arguments);
    const $slots = ${SYMBOLS.$_GET_SLOTS}(this, arguments);
    const $ctx = {};
    ${applyBabelTransform(`
      ${content.join('\n')}
      const roots = [${template}];
    `)}
    return ${SYMBOLS.FINALIZE_COMPONENT}(roots, this);
  }`;
  const prettyCode = synchronizedPrettier.format(codeResult, {
    parser: 'babel',
  });
  return { code: prettyCode, map };
}

const p = (expression: any) => print(expression).code;

const getContext = () => 'this';

const t = {
  isElement: (element: BaseNode): element is Element =>
    element.type === 'Element',
  isText: (element: BaseNode): element is Text => element.type === 'Text',
  isAttributeShorthand: (element: BaseNode) =>
    element.type === 'AttributeShorthand',
  isInlineComponent: (element: BaseNode): element is Element =>
    element.type === 'InlineComponent',
  isIfBlock: (element: BaseNode): element is BaseExpressionDirective =>
    element.type === 'IfBlock',
  isElseBlock: (element: BaseNode): element is BaseExpressionDirective =>
    element.type === 'ElseBlock',
  isEachBlock: (element: BaseNode): element is BaseExpressionDirective =>
    element.type === 'EachBlock',
  isEventHandler: (element: BaseNode): element is BaseDirective =>
    element.type === 'EventHandler',
  isStyleDirective: (element: BaseNode): element is BaseDirective =>
    element.type === 'isStyleDirective',
  isClass: (element: BaseNode): element is BaseDirective =>
    element.type === 'Class',
  isAttribute: (element: BaseNode): element is Attribute =>
    element.type === 'Attribute',
  isMustacheTag: (element: BaseNode): element is MustacheTag =>
    element.type === 'MustacheTag',
  isSpread: (element: BaseNode): element is SpreadAttribute =>
    element.type === 'Spread',
  isSlot: (element: BaseNode): element is Element => element.type === 'Slot',
};

function transformElement(element: Element): string {
  const modifiers = element.attributes.filter(
    (el) => t.isEventHandler(el) || t.isStyleDirective(el),
  );
  const properties = element.attributes.filter(
    (el) => t.isClass(el) || (t.isAttribute(el) && el.name === 'class'),
  );
  // TODO: deal with spread ($fw)
  const spread = element.attributes.filter((el) => t.isSpread(el));
  const attributes = element.attributes.filter(
    (el) =>
      !modifiers.includes(el) &&
      !properties.includes(el) &&
      !spread.includes(el),
  );
  const compiledProperties = `[${properties
    .map((el) => {
      if (t.isClass(el)) {
        return `['',()=>${p(el.expression)} ? ${escapeText(el.name)} : '']`;
      }
      if (Array.isArray(el.value)) {
        if (el.value.length !== 1) {
          throw new Error('Unknown attribute type');
        }
        if (t.isMustacheTag(el.value[0])) {
          return `['',()=>${transform(el.value[0])}]`;
        }
        return `['',${transform(el.value[0])}]`;
      } else {
        throw new Error('Unknown attribute type');
      }
    })
    .join(',')}]`;
  const compiledModifiers = `[${modifiers
    .map((el) => {
      if (t.isStyleDirective(el)) {
        return `[2,${escapeText(el.name)},()=>${p(el.value[0].expression)}]`;
      }
      const value = p(el.expression);
      if (el.expression.type === 'Identifier') {
        return `[${escapeText(el.name)},()=>${value}()]`;
      }
      return `[${escapeText(el.name)},${value}]`;
    })
    .join(',')}]`;
  return `${SYMBOLS.TAG}(${escapeText(
    element.name,
  )}, [${compiledProperties}, [${attributes.map(
    transformAttribute,
  )}], ${compiledModifiers}], [${
    element.children
      ?.map((node) => {
        if (t.isMustacheTag(node)) {
          return `()=>${transform(node)}`;
        } else {
          return transform(node);
        }
      })
      .join(',') ?? ''
  }],${getContext()})`;
}
function transformArgument(
  attribute: BaseDirective | Attribute | SpreadAttribute,
): string {
  if (!Array.isArray(attribute.value)) {
    if (t.isSpread(attribute)) {
      return `...${p(attribute.expression)}`;
    }
    return `${escapeText(attribute.name)}:${transform(attribute.value)}`;
  }
  if (attribute.value.length === 1) {
    const node = attribute.value[0];
    if (t.isMustacheTag(node)) {
      return `${escapeText(attribute.name)}:()=>${transform(node)}`;
    } else {
      return `${escapeText(attribute.name)}:${transform(node)}`;
    }
  } else {
    return `${escapeText(attribute.name)}:()=>[${attribute.value.map((el) => {
      return transform(el);
    })}].join('')`;
  }
}
function transformAttribute(
  attribute: BaseDirective | Attribute | SpreadAttribute,
): string {
  if (t.isSpread(attribute)) {
    throw new Error('Spread attributes are not supported');
  }
  if (!Array.isArray(attribute.value)) {
    return `[${escapeText(attribute.name)},${transform(attribute.value)}]`;
  }
  if (attribute.value.length === 1) {
    const node = attribute.value[0];
    if (t.isMustacheTag(node)) {
      return `[${escapeText(attribute.name)},()=>${transform(node)}]`;
    } else {
      return `[${escapeText(attribute.name)},${transform(node)}]`;
    }
  } else {
    return `[${escapeText(attribute.name)},()=>[${attribute.value.map((el) => {
      return transform(el);
    })}].join('')]`;
  }
}

function transformMustacheTag(node: MustacheTag): string {
  return p(node.expression);
}

function escapeText(text: string): string {
  return JSON.stringify(text);
}
function hasAttribute(element: Element, attrName: string) {
  return element.attributes.find(
    (el) => t.isAttribute(el) && el.name === attrName,
  );
}

function transformInlineComponent(node: Element): string {
  const argsArray = node.attributes.map((attr) => {
    const result = transformArgument(attr);
    magic.update(attr.start, attr.end, result);
    return result;
  });
  const slotNodes =
    node.children?.filter(
      (el) => t.isElement(el) && hasAttribute(el, 'slot'),
    ) ?? [];

  const slots = slotNodes.map((el) => {
    const slotName =
      el.attributes.find(
        (attr: BaseDirective | Attribute | SpreadAttribute) =>
          attr.name === 'slot',
      ).value[0].data ?? 'default';
    return `${slotName}:()=>[${el.children?.map(transform).join(',') ?? ''}]`;
  });

  const children = node.children?.filter((el) => !slotNodes.includes(el));

  if (children) {
    slots.push(`default:()=>[${children.map(transform).join(',')}]`);
  }
  if (slots.length) {
    argsArray.push(`[${SYMBOLS.$SLOTS_SYMBOL}]:{${slots.join(',')}}`);
  }
  return `${SYMBOLS.COMPONENT}(${node.name},{${argsArray.join(
    ',',
  )}},${getContext()})`;
}
function transformAttributeShorthand(node: any) {
  return `()=>${p(node.expression)}`;
}

function transformIfBlock(node: BaseExpressionDirective): string {
  return `${SYMBOLS.IF}(()=>${p(node.expression)},()=>[${
    node.children?.map(transform).join(',') ?? ''
  }], ${node.else ? `${transform(node.else)}` : null})`;
}
function transformElseBlock(node: BaseExpressionDirective): string {
  return `()=>[${node.children?.map(transform).join(',') ?? ''}]`;
}
function transformSlot(node: Element): string {
  // slot definition
  const slotName =
    node.attributes.find((attr) => attr.name === 'name')?.value?.[0]?.data ??
    'default';
  // todo - add params support
  const paramNames: string[] = [];
  return `${SYMBOLS.SLOT}(${escapeText(slotName)},() => [${paramNames.join(
    ',',
  )}], $slots, ${getContext()})`;
}

function transformEachBlock(node: BaseExpressionDirective): string {
  const item = p(node.context);
  const index = node.index ? node.index : '$index';
  const key = node.key
    ? `$key = (${item})=>${p(node.key)}`
    : `$key = '@identity'`;
  return `${SYMBOLS.EACH}(()=>${p(
    node.expression,
  )},(${item},${index},${key})=>[${
    node.children?.map(transform).join(',') ?? ''
  }],${getContext()})`;
}

function transform(
  node: BaseNode | boolean | string | number | null | undefined,
) {
  if (node === null) {
    return 'null';
  } else if (typeof node !== 'object') {
    return node;
  } else if (t.isElement(node)) {
    const result = transformElement(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isAttribute(node)) {
    const result = transformAttribute(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isText(node)) {
    const result = escapeText(node.data);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isMustacheTag(node)) {
    const result = transformMustacheTag(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isAttributeShorthand(node)) {
    const result = transformAttributeShorthand(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isInlineComponent(node)) {
    const result = transformInlineComponent(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isIfBlock(node)) {
    const result = transformIfBlock(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isElseBlock(node)) {
    const result = transformElseBlock(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isEachBlock(node)) {
    const result = transformEachBlock(node);
    magic.update(node.start, node.end, result);
    return result;
  } else if (t.isSlot(node)) {
    const result = transformSlot(node);
    magic.update(node.start, node.end, result);
    return result;
  }

  throw new Error(`Unknown node type: ${node.type}`);
}
