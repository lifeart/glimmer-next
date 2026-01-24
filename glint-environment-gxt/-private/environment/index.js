"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const preprocess_1 = require("./preprocess");
const transform_1 = require("./transform");
function gxtEnvironment(options) {
    let additionalSpecialForms = typeof options['additionalSpecialForms'] === 'object'
        ? options['additionalSpecialForms']
        : {};
    const additionalGlobalSpecialForms = additionalSpecialForms.globals ?? {};
    const additionalGlobals = Array.isArray(options['additionalGlobals'])
        ? options['additionalGlobals']
        : [];
    const tagConfig = {
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
            'and',
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
                preprocess: preprocess_1.preprocess,
                transform: transform_1.transform,
            },
            '.gjs': {
                kind: 'untyped-script',
                preprocess: preprocess_1.preprocess,
                transform: transform_1.transform,
            },
        },
    };
}
exports.default = gxtEnvironment;
//# sourceMappingURL=index.js.map