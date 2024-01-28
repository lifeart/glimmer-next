import type { ASTv1 } from '@glimmer/syntax';
import { SYMBOLS } from './symbols';
import type { Flags } from './flags';

let flags!: Flags;

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

export function escapeString(str: string) {
  const lines = str.split('\n');
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
  return str.startsWith('$:');
}

export function resolvePath(str: string) {
  if (str.includes('has-block-params')) {
    str = str.replace(
      'has-block-params',
      `${SYMBOLS.$_hasBlockParams}.bind(this, $slots)`,
    );
  } else if (str.includes('has-block')) {
    str = str.replace('has-block', `${SYMBOLS.$_hasBlock}.bind(this, $slots)`);
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

export function toOptionalChaining(str: string) {
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
    return result.replace('this?.', 'this.');
  } else if (result.includes(`this[${SYMBOLS.$args}]?.`)) {
    return result.replace(
      `this[${SYMBOLS.$args}]?.`,
      `this[${SYMBOLS.$args}].`,
    );
  }
  return result;
}

export function serializePath(
  p: string,
  wrap = flags.IS_GLIMMER_COMPAT_MODE,
): string {
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
  return name.replace('@', '');
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
  return `${isSafeKey(key) ? key : JSON.stringify(key)}: ${
    isScopeValue ? serializePath(attr[1]) : escapeString(attr[1])
  }`;
}

function isSafeKey(key: string): boolean {
  return /^[a-z_$@][a-z0-9_$]*$/i.test(key);
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
      hasStableChild = true;
    }
  }
  return hasStableChild;
}

export function serializeNode(
  node: string | null | HBSNode | HBSControlExpression,
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
    const childs = node.children.filter((el) => el !== null);
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
      if (paramNames.length === 1) {
        // @todo - add compiler param to mark there is no index here
        // likely we  need to import $getIndex function and pass it as a param for each constructor
        paramNames.push('$index'); // dummy param
      }
      let hasStableChild = hasStableChildsForControlNode(childs);
      const FN_NAME = isSync ? SYMBOLS.EACH_SYNC : SYMBOLS.EACH;
      const EACH_KEY = eachKey ? escapeString(eachKey) : null;
      const FN_FN_ARGS = `${paramNames.join(',')},${newCtxName}`;
      // unstable childs need to be wrapped in a component function
      if (hasStableChild) {
        return `${FN_NAME}(${arrayName}, (${FN_FN_ARGS}) => ${toChildArray(
          childs,
          newCtxName,
        )}, ${EACH_KEY}, ${ctxName})`;
      } else {
        const extraContextName = nextCtxName();
        return `${FN_NAME}(${arrayName}, (${FN_FN_ARGS}) => [${
          SYMBOLS.$_ucw
        }((${extraContextName}) => ${toChildArray(
          childs,
          extraContextName,
        )}, ${newCtxName})], ${EACH_KEY}, ${ctxName})`;
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
    node.tag.toLowerCase() !== node.tag
  ) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === '...attributes';
    });
    node.attributes = node.attributes.filter((attr) => {
      return attr[0] !== '...attributes';
    });
    const args = node.attributes.filter((attr) => {
      return attr[0].startsWith('@');
    });
    const attrs = node.attributes.filter((attr) => {
      return !attr[0].startsWith('@');
    });
    const props = node.properties;
    let secondArg = hasSplatAttrs
      ? `{[${SYMBOLS.$propsProp}]: [...$fw[${SYMBOLS.$propsProp}], ...${toArray(
          props,
        )}], [${SYMBOLS.$attrsProp}]: [...$fw[${
          SYMBOLS.$attrsProp
        }], ...${toArray(attrs)}], [${SYMBOLS.$eventsProp}]: [...$fw[${
          SYMBOLS.$eventsProp
        }],...${toArray(node.events)}]}`
      : `{[${SYMBOLS.$propsProp}]: ${toArray(props)}, [${
          SYMBOLS.$attrsProp
        }]: ${toArray(attrs)},  [${SYMBOLS.$eventsProp}]: ${toArray(
          node.events,
        )}}`;

    let isSecondArgEmpty = secondArg.split('[]').length === 4;
    if (isSecondArgEmpty) {
      if (!secondArg.includes('...')) {
        isSecondArgEmpty = true;
        secondArg = 'void 0';
      } else {
        isSecondArgEmpty = false;
      }
    }

    if (node.selfClosing) {
      // @todo - we could pass `hasStableChild` ans hasBlock / hasBlockParams to the DOM helper
      if (flags.IS_GLIMMER_COMPAT_MODE === false) {
        return `${SYMBOLS.COMPONENT}(${node.tag},${toObject(
          args,
        )}, ${secondArg}, ${ctxName}, false)`;
      } else {
        return `${SYMBOLS.COMPONENT}(${node.tag},${SYMBOLS.ARGS}(${toObject(
          args,
        )}), ${secondArg}, ${ctxName}, false)`;
      }
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
        const slotChildren = serializeChildren(slot.children, ctxName);
        const hasBlockParams = slot.blockParams.length > 0;
        const slotName = slot.tag.startsWith(':')
          ? slot.tag.slice(1)
          : 'default';
        return `${slotName}_: ${hasBlockParams},${slotName}: (${slot.blockParams.join(
          ',',
        )}) => [${slotChildren}]`;
      });
      const slotsObj = `{${serializedSlots.join(',')}}`;
      let fn = `${node.tag},${SYMBOLS.ARGS}(${toObject(
        args,
      )}, ${slotsObj}), ${secondArg}, ${ctxName}`;
      if (flags.IS_GLIMMER_COMPAT_MODE === false) {
        fn = `${node.tag},${toObject([
          ...args,
          [`$:[${SYMBOLS.$SLOTS_SYMBOL}]`, `$:${slotsObj}`],
        ])}, ${secondArg}, ${ctxName}`;
      }
      // @todo - we could pass `hasStableChild` ans hasBlock / hasBlockParams to the DOM helper
      // including `has-block` helper
      return `${SYMBOLS.COMPONENT}(${fn})`;
    }
  } else if (typeof node === 'object' && node.tag) {
    const hasSplatAttrs = node.attributes.find((attr) => {
      return attr[0] === '...attributes';
    });
    node.attributes = node.attributes.filter((attr) => {
      return attr[0] !== '...attributes';
    });
    let tagProps = `[${toArray(node.properties)},${toArray(
      node.attributes,
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
