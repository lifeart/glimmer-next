import type { ASTv1 } from '@glimmer/syntax';
import { EVENT_TYPE, SYMBOLS } from './symbols';
import type { Flags } from './flags';
import type { ComplexJSType } from './converter';

let flags!: Flags;
let bindings: Set<string> = new Set();

export function setBindings(b: Set<string>) {
  bindings = b;
}

export function setFlags(f: Flags) {
  flags = f;
}

export type HBSControlExpression = {
  type: 'each' | 'if' | 'in-element' | 'yield';
  isControl: true;
  condition: string;
  blockParams: string[];
  children: Array<HBSNode | HBSControlExpression | string>;
  inverse: Array<HBSNode | HBSControlExpression | string> | null;
  key: string | null;
  isSync: boolean;
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

let ctxIndex = 0;
export function nextCtxName() {
  return `ctx${ctxIndex++}`;
}
export function resetContextCounter() {
  ctxIndex = 0;
}

export function escapeString(str: string) {
  if (typeof str !== 'string') {
    throw new Error('Not a string');
  }
  try {
    if (typeof JSON.parse(str) !== 'string') {
      return JSON.stringify(str);
    }
    return JSON.stringify(JSON.parse(str));
  } catch (e) {
    return JSON.stringify(str);
  }
}

export function isPath(str: string) {
  return str.startsWith('$:');
}

export function resolvePath(str: string) {
  if (bindings.has(str)) {
    return str;
  }
  if (str === 'has-block-params') {
    str = str.replace(
      'has-block-params',
      `${SYMBOLS.$_hasBlockParams}.bind(this, $slots)`,
    );
  } else if (str === 'has-block') {
    str = str.replace('has-block', `${SYMBOLS.$_hasBlock}.bind(this, $slots)`);
  } else if (str === 'component') {
    return SYMBOLS.COMPONENT_HELPER;
  } else if (str === 'helper') {
    return SYMBOLS.HELPER_HELPER;
  } else if (str === 'modifier') {
    return SYMBOLS.MODIFIER_HELPER;
  }
  return toSafeJSPath(
    toOptionalChaining(str)
      .replace('$:', '')
      .replace('@', `this[${SYMBOLS.$args}].`),
  );
}

export function toSafeJSPath(str: string) {
  // skip for functions
  if (str.includes('(') || !str.includes('.')) {
    return str;
  }
  const parts = str.split('.');
  const result = parts
    .map((p) => {
      if (p.endsWith('?')) {
        if (isSafeKey(p.slice(0, -1))) {
          return p;
        } else if (p.includes('[')) {
          return p.slice(0, -1);
        } else {
          return `["${p.slice(0, -1)}"]?`;
        }
      } else if (p.includes('[')) {
        return p;
      } else if (isSafeKey(p)) {
        return p;
      } else {
        return `["${p}"]`;
      }
    })
    .reduce((acc, el) => {
      if (el.startsWith('[')) {
        return acc + el;
      } else {
        if (acc.length) {
          return acc + '.' + el;
        } else {
          return el;
        }
      }
    }, '');
  return result;
}

export function toOptionalChaining<
  T extends string | number | undefined | null,
>(str: T): T {
  if (typeof str !== 'string') {
    return str;
  }
  if (str.includes("'") || str.includes('"')) {
    return str;
  }
  // special control parts
  if (str.includes('$_')) {
    return str;
  } else if (str.includes('?.')) {
    return str;
  } else if (str.split('.').length < 3) {
    return str;
  }
  const result = str
    .split('...')
    .map((el) => el.split('.').join('?.'))
    .join('...');
  if (result.includes('this?.')) {
    return result.replace('this?.', 'this.') as T;
  } else if (result.includes(`this[${SYMBOLS.$args}]?.`)) {
    return result.replace(
      `this[${SYMBOLS.$args}]?.`,
      `this[${SYMBOLS.$args}].`,
    ) as T;
  }
  return result as T;
}

export function serializePath(
  p: string | boolean,
  wrap = flags.IS_GLIMMER_COMPAT_MODE,
): string {
  if (typeof p !== 'string') {
    // @ts-expect-error
    return p;
  }
  if (p.includes('...')) {
    // splat attrs case
    return p;
  }
  const isFunction =
    p.startsWith('$:(') || p.startsWith('$:...(') || p.startsWith('$:function');
  if (wrap === false) {
    return resolvePath(p);
  }
  if (isFunction) {
    return resolvePath(p);
  }
  return `() => ${resolvePath(p)}`;
}

export function resolvedChildren(els: ASTv1.Node[]) {
  return els.filter((el) => {
    if (
      el.type === 'CommentStatement' ||
      el.type === 'MustacheCommentStatement'
    ) {
      return false;
    }
    if (
      el.type === 'TextNode' &&
      el.chars.trim().length === 0 &&
      el.chars.includes('\n')
    ) {
      return false;
    }
    return true;
  });
}

export function serializeChildren(
  children: Array<string | HBSNode | HBSControlExpression>,
  ctxName: string,
) {
  if (children.length === 0) {
    return '';
  }
  return `${children
    .map((child) => {
      if (typeof child === 'string') {
        if (isPath(child)) {
          return serializePath(child);
        }
        return `${SYMBOLS.TEXT}(${escapeString(child)})`;
      }
      return serializeNode(child, ctxName);
    })
    .join(', ')}`;
}

function toChildArray(
  childs: Array<HBSNode | HBSControlExpression | string> | null,
  ctxName = 'this',
): string {
  if (!childs) {
    return '[]';
  }
  return `[${childs
    .map((child) => serializeNode(child, ctxName))
    .filter((el) => el)
    .join(', ')}]`;
}

function toPropName(name: string) {
  let result = name.replace('@', '');
  return isSafeKey(result) ? result : JSON.stringify(result);
}

export function serializeAttribute(
  key: string,
  value: null | undefined | string | number | boolean,
): string {
  if (typeof value === 'boolean') {
    return `['${key}', ${String(value)}]`;
  } else if (typeof value === 'number') {
    return `['${key}', ${value}]`;
  } else if (value === null) {
    return `['${key}', null]`;
  } else if (typeof value === 'undefined') {
    return `['${key}', undefined]`;
  }
  if (isPath(value)) {
    return `['${key}', ${serializePath(value)}]`;
  }
  return `['${key}', ${escapeString(value)}]`;
}

function serializeProp(
  attr: [string, string | undefined | null | number | boolean],
): string {
  if (attr[1] === null) {
    return `${toPropName(attr[0])}: null`;
  } else if (typeof attr[1] === 'boolean') {
    return `${toPropName(attr[0])}: ${attr[1]}`;
  } else if (typeof attr[1] === 'number') {
    return `${toPropName(attr[0])}: ${attr[1]}`;
  } else if (typeof attr[1] === 'undefined') {
    return `${toPropName(attr[0])}: undefined`;
  }
  const isScopeValue = isPath(attr[1]);
  const key = toPropName(attr[0]);
  return `${key}: ${
    isScopeValue ? serializePath(attr[1]) : escapeString(attr[1])
  }`;
}

function isSafeKey(key: string): boolean {
  return /^[a-z_$@][a-z0-9_$]*$/i.test(key);
}

function toComponent(ref: string, args: string, ctx: string) {
  if (ref.includes('.')) {
    // may be a dynamic component
    return `${SYMBOLS.DYNAMIC_COMPONENT}($:()=>${ref},${args},${ctx})`;
  } else {
    return `${SYMBOLS.COMPONENT}(${ref},${args},${ctx})`;
  }
}

export function toObject(
  args: [string, string | number | boolean | null | undefined][],
) {
  return `{${args.map((attr) => serializeProp(attr)).join(', ')}}`;
}
function toArray(
  args: [string, string | number | boolean | null | undefined][],
) {
  return `[${args
    .map((attr) => serializeAttribute(attr[0], attr[1]))
    .join(', ')}]`;
}

function toArgs(
  args: [string, string | number | boolean | null | undefined][],
  slots: string,
  props: string,
) {
  if (flags.IS_GLIMMER_COMPAT_MODE === false) {
    const extraArgs = [...args];
    if (props !== '{}' && !props.includes(SYMBOLS.EMPTY_DOM_PROPS)) {
      extraArgs.push([`$:[${SYMBOLS.$PROPS_SYMBOL}]`, `$:${props}`]);
    }
    if (slots !== '{}') {
      extraArgs.push([`$:[${SYMBOLS.$SLOTS_SYMBOL}]`, `$:${slots}`]);
    }
    const result = toObject(extraArgs);
    return result;
  }

  const result = `${SYMBOLS.ARGS}(${toObject(args)},${slots},${props})`;

  return result
    .replace(`${SYMBOLS.ARGS}({},{},{})`, '{}')
    .replace('$_args({},{},$_edp)', '{}');
}

function hasStableChildsForControlNode(
  childs: null | (null | string | HBSNode | HBSControlExpression)[],
) {
  if (childs === null) {
    return true;
  }
  let hasStableChild = false;
  if (childs.length === 1 && typeof childs[0] === 'object') {
    const child = childs[0];
    if (child === null) {
      return true;
    }
    if ('isControl' in child) {
      hasStableChild = false;
    } else {
      if (child.events.filter(([id]) => id === EVENT_TYPE.ON_CREATED).length) {
        return false;
      }
      hasStableChild = true;
    }
  }
  return hasStableChild;
}

export function serializeNode(
  node: string | null | HBSNode | HBSControlExpression | ComplexJSType,
  ctxName = 'this',
): string | undefined | null {
  if (node === null) {
    return null;
  }

  if (typeof node === 'object' && 'isControl' in node) {
    // control node (each)
    const key = `@${node.type}`;
    const arrayName = node.condition;
    const paramNames = node.blockParams;
    const childs = (node.children || []).filter((el) => el !== null);
    const isSync = node.isSync;
    const inverses = node.inverse;
    let eachKey = node.key;

    if (eachKey === '@index') {
      console.warn('@index identity not supported');
      eachKey = '@identity';
    }

    const newCtxName = nextCtxName();
    if (key === '@yield') {
      return `$:${SYMBOLS.SLOT}(${escapeString(
        eachKey as string,
      )}, () => [${paramNames.join(',')}], $slots, ${ctxName})`;
    } else if (key === '@in-element') {
      return `$:${
        SYMBOLS.$_inElement
      }(${arrayName}, $:(${newCtxName}) => [${serializeChildren(
        childs as unknown as [string | HBSNode | HBSControlExpression],
        newCtxName,
      )}], ${ctxName})`;
    } else if (key === '@each') {
      if (paramNames.length === 0) {
        paramNames.push('$noop');
      }
      if (paramNames.length === 1) {
        // @todo - add compiler param to mark there is no index here
        // likely we  need to import $getIndex function and pass it as a param for each constructor
        paramNames.push('$index'); // dummy param
      }
      let hasStableChild = hasStableChildsForControlNode(childs);
      const FN_NAME = isSync ? SYMBOLS.EACH_SYNC : SYMBOLS.EACH;
      const EACH_KEY = eachKey ? escapeString(eachKey) : null;
      const FN_FN_ARGS = `${paramNames.join(',')},${newCtxName}`;
      const indexParamName = paramNames[1];
      const paramBounds = new RegExp(
        `(?<!\\.)\\b${indexParamName}\\b(?!(=|'|\"|:)[^ ]*)`,
        'g',
      );
      // unstable childs need to be wrapped in a component function
      if (hasStableChild) {
        let childText = toChildArray(childs, newCtxName)
          .split(paramBounds)
          .filter(Boolean)
          .join(`${indexParamName}.value`);
        return `${FN_NAME}(${arrayName}, (${FN_FN_ARGS}) => ${childText}, ${EACH_KEY}, ${ctxName})`;
      } else {
        const extraContextName = nextCtxName();
        let childText = toChildArray(childs, extraContextName)
          .split(paramBounds)
          .filter(Boolean)
          .join(`${indexParamName}.value`);
        return `${FN_NAME}(${arrayName}, (${FN_FN_ARGS}) => [${SYMBOLS.$_ucw}((${extraContextName}) => ${childText}, ${newCtxName})], ${EACH_KEY}, ${ctxName})`;
      }
    } else if (key === '@if') {
      let hasStableTrueChild = hasStableChildsForControlNode(childs);
      let hasStableFalseChild = hasStableChildsForControlNode(inverses);
      // @todo - figure out cases where we could avoid wrapping in a component
      hasStableTrueChild = false;
      hasStableFalseChild = false;
      let trueBranch = `(${newCtxName}) => ${toChildArray(childs, newCtxName)}`;
      let extraContextName = nextCtxName();
      if (!hasStableTrueChild) {
        trueBranch = `(${newCtxName}) => ${
          SYMBOLS.$_ucw
        }((${extraContextName}) => ${toChildArray(
          childs,
          extraContextName,
        )}, ${newCtxName})`;
      }

      let falseBranch = `(${newCtxName}) => ${toChildArray(
        inverses,
        newCtxName,
      )}`;
      if (!hasStableFalseChild) {
        falseBranch = `(${newCtxName}) => ${
          SYMBOLS.$_ucw
        }((${extraContextName}) => ${toChildArray(
          inverses,
          extraContextName,
        )}, ${newCtxName})`;
      }
      return `${SYMBOLS.IF}(${arrayName}, ${trueBranch}, ${falseBranch}, ${ctxName})`;
    }
  } else if (
    typeof node === 'object' &&
    node.tag &&
    (bindings.has(node.tag) ||
      node.tag.startsWith('$:$_') ||
      node.tag.includes('.'))
  ) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === '...attributes';
    });
    const attributes = node.attributes.filter((attr) => {
      return attr[0] !== '...attributes';
    });
    const args = attributes.filter((attr) => {
      return attr[0].startsWith('@');
    });
    const attrs = attributes.filter((attr) => {
      return !attr[0].startsWith('@');
    });
    const props = node.properties;
    //
    let secondArg = hasSplatAttrs
      ? `[[...$fw[0], ...${toArray(props)}],[...$fw[1], ...${toArray(
          attrs,
        )}],[...$fw[2],...${toArray(node.events)}]]`
      : `[${toArray(props)},${toArray(attrs)},${toArray(node.events)}]`;

    let isSecondArgEmpty = secondArg === '[[],[],[]]';
    if (isSecondArgEmpty) {
      secondArg = SYMBOLS.EMPTY_DOM_PROPS;
    }
    // if (isSecondArgEmpty) {
    //   if (!secondArg.includes('...')) {
    //     isSecondArgEmpty = true;
    //     secondArg = '{}';
    //   } else {
    //     isSecondArgEmpty = false;
    //   }
    // }

    if (node.selfClosing) {
      // @todo - we could pass `hasStableChild` ans hasBlock / hasBlockParams to the DOM helper
      return toComponent(node.tag, toArgs(args, '{}', secondArg), ctxName);
    } else {
      const slots: HBSNode[] = node.children.filter((child) => {
        if (typeof child === 'string') {
          return false;
        } else if ('isControl' in child) {
          return false;
        } else {
          return child.tag.startsWith(':');
        }
      }) as HBSNode[];
      if (slots.length === 0) {
        slots.push(node);
      }
      const serializedSlots = slots.map((slot) => {
        const sContext = nextCtxName();
        const slotChildren = serializeChildren(slot.children, sContext);
        const hasBlockParams = slot.blockParams.length > 0;
        const slotName = slot.tag.startsWith(':')
          ? slot.tag.slice(1)
          : 'default';
        return `${slotName}_: ${hasBlockParams},${slotName}: (${[
          ...slot.blockParams,
          sContext,
        ].join(',')}) => [${slotChildren}]`;
      });
      const slotsObj = `{${serializedSlots.join(',')}}`;
      // @todo - we could pass `hasStableChild` ans hasBlock / hasBlockParams to the DOM helper
      // including `has-block` helper
      return toComponent(node.tag, toArgs(args, slotsObj, secondArg), ctxName);
    }
  } else if (typeof node === 'object' && node.tag) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === '...attributes';
    });
    const attributes = node.attributes.filter((attr) => {
      return attr[0] !== '...attributes';
    });
    let tagProps = `[${toArray(node.properties)},${toArray(
      attributes,
    )},${toArray(node.events)}${hasSplatAttrs ? `,$fw` : ''}]`;
    if (tagProps === '[[],[],[]]') {
      tagProps = SYMBOLS.EMPTY_DOM_PROPS;
    }
    return `${SYMBOLS.TAG}('${node.tag}', ${tagProps}, [${serializeChildren(
      node.children,
      ctxName,
    )}], ${ctxName})`;
  } else {
    if (typeof node === 'string' || typeof node === 'number') {
      if (typeof node === 'number') {
        node = String(node);
      }
      if (isPath(node)) {
        return serializePath(node);
      } else {
        return `${SYMBOLS.TEXT}(${escapeString(node)})`;
      }
    }
    throw new Error('Unknown node type: ' + JSON.stringify(node, null, 2));
  }
}
