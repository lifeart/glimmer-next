"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function gxtEnvironment(options) {
    let typesModule = 'glint-environment-gxt/-private/dsl';
    let additionalSpecialForms = typeof options['additionalSpecialForms'] === 'object'
    ? options['additionalSpecialForms']
    : {};
// const additionalGlobalSpecialForms = additionalSpecialForms.globals ?? {};
// const additionalGlobals = Array.isArray(options['additionalGlobals'])
//     ? options['additionalGlobals']
//     : [];
   
    let specialForms = {
        if: 'if',
        unless: 'if-not',
        yield: 'yield',
        array: 'array-literal',
        hash: 'object-literal',
        component: 'bind-invokable',
        modifier: 'bind-invokable',
        helper: 'bind-invokable',
        ...additionalSpecialForms.globals,
      };

    return {
        template: {
            typesModule,
      specialForms,
      getPossibleTemplatePaths() {
        return [];
      }
        }
        // tags: {
        //     '@glint/environment-ember-template-imports/-private/tag': {
        //         hbs: {
        //             typesModule: 'glint-environment-gxt/-private/dsl',
        //             specialForms: {
        //                 globals: {
        //                     if: 'if',
        //                     unless: 'if-not',
        //                     yield: 'yield',
        //                     component: 'bind-invokable',
        //                     modifier: 'bind-invokable',
        //                     helper: 'bind-invokable',
        //                     ...additionalGlobalSpecialForms,
        //                 },
        //                 imports: {
        //                     '@ember/helper': {
        //                         array: 'array-literal',
        //                         hash: 'object-literal',
        //                         ...additionalSpecialForms.imports?.['@ember/helper'],
        //                     },
        //                     ...additionalSpecialForms.imports,
        //                 },
        //             },
        //             globals: [
        //                 'each',
                       
        //                 ...Object.keys(additionalGlobalSpecialForms),
        //                 ...additionalGlobals,
        //             ],
        //         },
        //     },
        // }
    };
}
exports.default = gxtEnvironment;
//# sourceMappingURL=index.js.map