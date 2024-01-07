import type Babel from '@babel/core';
import { MAIN_IMPORT, SYMBOLS } from './symbols';

export type ResolvedHBS = {
  template: string;
  flags: {
    hasThisAccess: boolean;
  }
}

export function processTemplate(
  hbsToProcess: ResolvedHBS[],
  mode: 'development' | 'production',
) {
  return function babelPlugin(babel: { types: typeof Babel.types }) {
    const { types: t } = babel;
    type Context = Record<string, boolean |  string | undefined>;
    return {
      name: 'ast-transform', // not required
      visitor: {
        ClassBody: {
          enter(_: any, context: Context) {
            // here we assume that class is extends from our Component
            // @todo - check if it's really extends from Component
            context.isInsideClassBody = true;
            if (_.node.body.length === 1) {
              // seems like it's body with only $static method
              context.isInsideClassBody = false;
            }
          },
          exit(_: any, context: Context) {
            context.isInsideClassBody = false;
          },
        },
        ClassMethod(path: any) {
          if (path.node.key.name === '$static') {
            path.replaceWith(
              t.classProperty(
                t.identifier('template'),
                // hbs literal
                t.taggedTemplateExpression(
                  t.identifier('hbs'),
                  path.node.body.body[0].expression.arguments[0],
                ),
              ),
            );
          }
        },
        CallExpression(path: any) {
          if (path.node.callee && path.node.callee.type === 'Identifier') {
            if (path.node.callee.name === 'scope') {
              path.remove();
            } else if (path.node.callee.name === 'template') {
              path.replaceWith(
                t.taggedTemplateExpression(
                  t.identifier('hbs'),
                  path.node.arguments[0],
                ),
              );
            } else if (path.node.callee.name === 'formula') {
              if (mode === 'production') {
                // remove last argument if two arguments
                if (path.node.arguments.length === 2) {
                  path.node.arguments.pop();
                }
              }
            }
          }
        },
        ImportDeclaration(path: any) {
          if (path.node.source.value === '@ember/template-compiler') {
            path.node.source.value = MAIN_IMPORT;
            path.node.specifiers.forEach((specifier: any) => {
              specifier.local.name = 'hbs';
              specifier.imported.name = 'hbs';
            });
          }
        },
        Program(path: any) {
          const PUBLIC_API = Object.values(SYMBOLS);
          const IMPORTS = PUBLIC_API.map((name) => {
            return t.importSpecifier(t.identifier(name), t.identifier(name));
          });
          path.node.body.unshift(
            t.importDeclaration(IMPORTS, t.stringLiteral(MAIN_IMPORT)),
          );
        },
        ReturnStatement: {
          enter(_: any, context: Context) {
            context.isInsideReturnStatement = true;
          },
          exit(_: any, context: Context) {
            context.isInsideReturnStatement = false;
          },
        },
        TaggedTemplateExpression(path: any, context: Context) {
          if (path.node.tag.name === 'hbs') {
            const template = path.node.quasi.quasis[0].value.raw as string;
            const isInsideClassBody = context.isInsideClassBody === true;
            const hasThisInTemplate = template.includes('this');
            let hasThisAccess = isInsideClassBody === true || hasThisInTemplate;
            // looks like it's function based template, we don't need to mess with it's context hell
            if (context.isInsideReturnStatement === true) {
              hasThisAccess = true;
            }
            hbsToProcess.push({
              template,
              flags: {
                hasThisAccess: hasThisAccess,
              },
            });
            path.replaceWith(t.identifier('$placeholder'));
          }
        },
      },
    };
  };
}
