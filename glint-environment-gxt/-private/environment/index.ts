import {
  GlintEnvironmentConfig,
  GlintSpecialFormConfig,
  GlintTagConfig,
} from '@glint/core/config-types';
import { preprocess } from './preprocess';
import { transform } from './transform';

export default function gxtEnvironment(
  options: Record<string, unknown>,
): GlintEnvironmentConfig {
  let additionalSpecialForms =
    typeof options['additionalSpecialForms'] === 'object'
      ? (options['additionalSpecialForms'] as GlintSpecialFormConfig)
      : {};

  const additionalGlobalSpecialForms = additionalSpecialForms.globals ?? {};

  const additionalGlobals = Array.isArray(options['additionalGlobals'])
    ? options['additionalGlobals']
    : [];

  const tagConfig: GlintTagConfig = {
    typesModule: 'glint-environment-gxt/-private/dsl',
    specialForms: {
      globals: {
        if: 'if',
        unless: 'if-not',
        yield: 'yield',
        component: 'bind-invokable',
        modifier: 'bind-invokable',
        helper: 'bind-invokable',
        ...additionalGlobalSpecialForms,
      },
      imports: {
        '@ember/helper': {
          array: 'array-literal',
          hash: 'object-literal',
          ...additionalSpecialForms.imports?.['@ember/helper'],
        },
        ...additionalSpecialForms.imports,
      },
    },
    globals: [
      'component',
      'debugger',
      'each',
      'has-block',
      'has-block-params',
      'helper',
      'if',
      'in-element',
      'let',
      'log',
      'modifier',
      'unless',
      'yield',
      // new:
      'on',
      'array',
      'hash',
      'fn',
      'eq',
      'not',
      'or',
      'element',
      ...Object.keys(additionalGlobalSpecialForms),
      ...additionalGlobals,
    ],
  };

  return {
    tags: {
      '@lifeart/gxt': { hbs: JSON.parse(JSON.stringify(tagConfig)) },
      'glint-environment-gxt/-private/tag': {
        hbs: JSON.parse(JSON.stringify(tagConfig)),
      },
    },
    extensions: {
      '.gts': {
        kind: 'typed-script',
        preprocess,
        transform,
      },
      '.gjs': {
        kind: 'untyped-script',
        preprocess,
        transform,
      },
    },
  };
}
