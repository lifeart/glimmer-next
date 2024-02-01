import type Babel from '@babel/core';
import { MAIN_IMPORT, SYMBOLS } from './symbols';

export type ResolvedHBS = {
  template: string;
  flags: {
    hasThisAccess: boolean;
  };
  bindings: Set<string>;
};


function getScopeBindings(path: any, bindings: Set<string> = new Set()) {
  Object.keys(path.scope.bindings).forEach((key) => {
    bindings.add(key);
  });
  if (path.parentPath) {
    getScopeBindings(path.parentPath, bindings);
  }
  return bindings;
}

export function processTemplate(
  hbsToProcess: ResolvedHBS[],
  mode: 'development' | 'production',
) {
  return function babelPlugin(babel: { types: typeof Babel.types }) {
    const { types: t } = babel;
    type Context = Record<string, boolean | string | undefined | string[]>;
    return {
      name: 'ast-transform', // not required
      visitor: {
        VariableDeclarator(path: any, context: Context) {
          if (mode !== 'development') {
            return;
          }
          if (!context.tokensForHotReload) {
            return;
          }
          const tokensForHotReload = context.tokensForHotReload as string[];
          if (path.node.id.type === 'Identifier') {
            if (path.node.id.name === 'existingTokensToReload') {
              path.node.init = t.arrayExpression(
                tokensForHotReload.map((token: string) => {
                  return t.stringLiteral(token);
                }),
              );
            }
          }
        },
        ExportNamedDeclaration(path: any, context: Context) {
          if (mode !== 'development') {
            return;
          }
          if (!context.tokensForHotReload) {
            context.tokensForHotReload = [];
          }
          if (path.node.declaration) {
            if (path.node.declaration.type === 'VariableDeclaration') {
              const declarations = path.node.declaration.declarations;
              if (declarations.length === 1) {
                const declaration = declarations[0];
                if (declaration.id.type === 'Identifier') {
                  const existingTokens = context.tokensForHotReload as string[];
                  existingTokens.push(declaration.id.name);
                }
              }
            } else if (path.node.declaration.type === 'ClassDeclaration') {
              const declaration = path.node.declaration;
              if (declaration.id.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(declaration.id.name);
              }
            }
          }
        },
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
                t.identifier(SYMBOLS.$template),
                // hbs literal
                t.taggedTemplateExpression(
                  t.identifier('hbs'),
                  path.node.body.body[0].expression.arguments[0],
                ),
                null,
                null,
                true,
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
              bindings: getScopeBindings(path),
            });
            path.replaceWith(t.identifier('$placeholder'));
          }
        },
      },
    };
  };
}

export function stripGXTDebug(babel: { types: typeof Babel.types }) {
  const { types: t } = babel;
  return {
    name: 'string-gxt-debug-info-transform', // not required
    visitor: {
      BinaryExpression(path: any) {
        if (t.isLiteral(path.node.right)) {
          if (path.node.right.value === '/tests.html') {
            path.replaceWith(t.booleanLiteral(false));
          }
        }
      },
      ClassMethod(path: any) {
        if (path.node.kind === 'constructor') {
          if (path.node.params.length === 2) {
            if (path.node.params[1].name === 'debugName') {
              path.node.params.pop();
            }
          }
        }
      },
      ExpressionStatement(path: any) {
        // remove all console.log/warn/error/info
        if (
          path.node.expression &&
          path.node.expression.type === 'CallExpression'
        ) {
          if (path.node.expression.callee.type === 'MemberExpression') {
            if (path.node.expression.callee.object.name === 'console') {
              path.remove();
            }
          }
        }
      },
      ClassProperty(path: any) {
        if (path.node.key.name === '_debugName') {
          path.remove();
        }
      },
      FunctionDeclaration(path: any) {
        if (path.node.id.name === 'formula' || path.node.id.name === 'cell') {
          path.node.params.pop();
        }
      },
      AssignmentPattern(path: any) {
        if (path.node.left.name === 'debugName') {
          path.remove();
        }
      },
      NewExpression(path: any) {
        if (path.node.callee && path.node.callee.type === 'Identifier') {
          if (
            path.node.callee.name === 'MergedCell' ||
            path.node.callee.name === 'Cell'
          ) {
            path.node.arguments.pop();
          }
        }
      },
      CallExpression(path: any) {
        if (path.node.callee && path.node.callee.type === 'Identifier') {
          if (
            path.node.callee.name === 'cell' ||
            path.node.callee.name === 'formula' ||
            path.node.callee.name === 'resolveRenderable'
          ) {
            if (path.node.arguments.length === 2) {
              path.node.arguments.pop();
            }
          }
        }
      },
    },
  };
}
