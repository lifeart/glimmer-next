import { transform } from './../../plugins/test';
import * as fns from '@lifeart/gxt';
import { format } from 'prettier/standalone';
import parserBabel from 'prettier/plugins/babel';
import estree from 'prettier/plugins/estree';
import { SYMBOLS } from '../../plugins/symbols';
import { TEMPLATE_META } from './ember__component';

Object.keys(fns).forEach((key) => {
  if (key.startsWith('$')) {
    // @ts-expect-error
    globalThis[key] = fns[key];
  }
});

// @ts-expect-error
globalThis.scopes = new Map();
// @ts-expect-error
globalThis.components = new Map();
// @ts-expect-error
globalThis.rawTemplates = new Map();
// @ts-expect-error
globalThis.compiledTemplate = new Map();

const emptyScope = () => ({});

export function precompileTemplate(
  tpl: string,
  args: {
    strictMode: boolean;
    scope: () => any;
  },
) {
  const scopeId = Math.random().toString(36).slice(2);
  // @ts-expect-error
  globalThis.scopes.set(scopeId, args.scope ?? emptyScope);
  const keys =
    typeof args.scope === 'function' ? Object.keys(args.scope()) : [];

  // @ts-expect-error
  globalThis.rawTemplates.set(scopeId, tpl);

  const transformResult = transform(
    `export function t${scopeId}() {
        ${SYMBOLS.$_GET_ARGS}(this, arguments);
        this['$fw'] =  ${SYMBOLS.$_GET_FW}(this, arguments);
        let {${keys.join(', ')}} = globalThis.scopes.get('${scopeId}')();
        return hbs\`${tpl}\`;
    }`,
    'name.js',
    'development',
    false,
    {
      IS_GLIMMER_COMPAT_MODE: true,
      RUN_EVENT_DESTRUCTORS_FOR_SCOPED_NODES: false,
      TRY_CATCH_ERROR_HANDLING: true,
      SUPPORT_SHADOW_DOM: true,
      REACTIVE_MODIFIERS: true,
      WITH_HELPER_MANAGER: true,
      WITH_MODIFIER_MANAGER: true,
    },
  );
  let final = transformResult.split('export ').pop() ?? '';

  // @ts-expect-error
  globalThis.compiledTemplate.set(scopeId, final);

  format(final, {
    parser: 'babel',
    filepath: 'index.js',
    plugins: [parserBabel, estree],
  })
    .then((result) => {
      // hasBottomBarBlock
      if (final.includes('hasBottomBarBlock')) {
        console.log(result);
      }
      // if (final.includes('euiTab') && !final.includes('euiTabs--expand')) {
      //   console.log(result);
      // }
      // @ts-expect-error
      globalThis.compiledTemplate.set(scopeId, result);
    })
    .catch((e) => {
      console.log('--------');
      console.log(final);
      console.log('--------');
      console.log(e);
    });
  const fnId = Math.random().toString(36).slice(2);
  try {
    eval(`
    let fn = ${final};
    globalThis.components.set('${fnId}', fn);
    // globalThis.components.set('${fnId}', function() {
    //   try {
    //     return fn.apply(this, Array.from(arguments));
    //   } catch (e) {
    //     // console.log(${JSON.stringify(tpl)});
    //     // console.log(${JSON.stringify(final)});
    //     throw e;
    //   }
    // });
`);
  } catch (e) {
    console.log(tpl);
    console.log(final);
    throw e;
  }

  // @ts-expect-error
  return globalThis.components.get(fnId);
}
