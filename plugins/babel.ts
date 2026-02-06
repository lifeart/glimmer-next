import type Babel from '@babel/core';
import { MAIN_IMPORT, SYMBOLS } from './symbols';
import type { PropertyTypeHint } from './compiler/types';

export type ResolvedHBS = {
  template: string;
  flags: {
    hasThisAccess: boolean;
  };
  bindings: Set<string>;
  /** CALLBACK to determine if a variable is in the lexical scope */
  lexicalScope?: (name: string) => boolean;
  /** Source location of the template in the original file (for source maps) */
  loc?: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  /** Type hints extracted from decorators on the containing class */
  typeHints?: { properties?: Record<string, PropertyTypeHint> };
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
    type Context = Record<string, boolean | string | undefined | string[] | Record<string, PropertyTypeHint>>;
    const getTemplateFunctionNames = (path: Babel.NodePath<any>) => {
      const state = (path.state ??= {}) as { templateFunctionNames?: Set<string> };
      if (!state.templateFunctionNames) {
        state.templateFunctionNames = new Set<string>();
      }
      return state.templateFunctionNames;
    };
    return {
      name: 'ast-transform', // not required
      visitor: {
        VariableDeclarator(path: Babel.NodePath<Babel.types.VariableDeclarator>, context: Context) {
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
        ExportNamedDeclaration(path: Babel.NodePath<Babel.types.ExportNamedDeclaration>, context: Context) {
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
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(declaration.id.name);
              }
            } else if (path.node.declaration.type === 'FunctionDeclaration') {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(declaration.id.name);
              }
            }
          }
        },
        ExportDefaultDeclaration(path: Babel.NodePath<Babel.types.ExportDefaultDeclaration>, context: Context) {
          if (mode !== 'development') {
            return;
          }
          if (!context.tokensForHotReload) {
            context.tokensForHotReload = [];
          }
          if (path.node.declaration) {
            if (path.node.declaration.type === 'ClassDeclaration' && path.node.declaration.id) {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(`${declaration.id.name}:default`);
              }
            } else if (path.node.declaration.type === 'FunctionDeclaration' && path.node.declaration.id) {
              const declaration = path.node.declaration;
              if (declaration.id?.type === 'Identifier') {
                const existingTokens = context.tokensForHotReload as string[];
                existingTokens.push(`${declaration.id.name}:default`);
              }
            }
          }
        },
        ClassBody: {
          enter(_: Babel.NodePath<Babel.types.ClassBody>, context: Context) {
            context.decoratorHints = undefined;
            // here we assume that class is extends from our Component
            // @todo - check if it's really extends from Component
            context.isInsideClassBody = true;
            if (_.node.body.length === 1) {
              // seems like it's body with only $static method
              context.isInsideClassBody = false;
            }
          },
          exit(_: Babel.NodePath<Babel.types.ClassBody>, context: Context) {
            context.isInsideClassBody = false;
          },
        },
        ClassProperty(path: Babel.NodePath<Babel.types.ClassProperty>, context: Context) {
          // Static properties are not accessed via this.propName in templates
          if (path.node.static) return;
          if (path.node.key.type === 'Identifier') {
            const propName = path.node.key.name;
            if (!context.decoratorHints) {
              context.decoratorHints = {};
            }
            const hints = context.decoratorHints as Record<string, PropertyTypeHint>;
            // Check if property has @tracked decorator
            const isTracked = path.node.decorators?.some(
              (d) => d.expression.type === 'Identifier' && d.expression.name === 'tracked'
            ) ?? false;

            // Classify based on initializer AST node
            const init = path.node.value;
            if (!init) {
              if (isTracked) {
                // @tracked with no initializer (e.g., `@tracked value!: string`)
                hints[`this.${propName}`] = { kind: 'primitive', isTracked: true };
              }
              // No initializer, not tracked — unknown, skip
              return;
            }
            const initType = init.type;
            // cell() or formula() calls are reactive
            if (initType === 'CallExpression'
              && init.callee.type === 'Identifier'
              && (init.callee.name === 'cell' || init.callee.name === 'formula')) {
              hints[`this.${propName}`] = { kind: 'cell' };
            }
            // Arrow functions and function expressions
            else if (initType === 'ArrowFunctionExpression' || initType === 'FunctionExpression') {
              hints[`this.${propName}`] = isTracked
                ? { kind: 'function', isTracked: true }
                : { kind: 'function' };
            }
            // Object/array literals — could hold anything
            else if (initType === 'ObjectExpression' || initType === 'ArrayExpression') {
              hints[`this.${propName}`] = isTracked
                ? { kind: 'object', isTracked: true }
                : { kind: 'object' };
            }
            // new expressions (e.g., new Cell(), new Map()) — unknown
            else if (initType === 'NewExpression') {
              if (isTracked) {
                hints[`this.${propName}`] = { kind: 'unknown', isTracked: true };
              }
              // Not tracked — don't emit a hint for unknown constructors
            }
            // Primitive literals: string, number, boolean, null
            else if (
              initType === 'StringLiteral' || initType === 'NumericLiteral'
              || initType === 'BooleanLiteral' || initType === 'NullLiteral'
            ) {
              hints[`this.${propName}`] = isTracked
                ? { kind: 'primitive', isTracked: true }
                : { kind: 'primitive' };
            }
            // Template literals without expressions are effectively strings
            else if (initType === 'TemplateLiteral' && init.expressions.length === 0) {
              hints[`this.${propName}`] = isTracked
                ? { kind: 'primitive', isTracked: true }
                : { kind: 'primitive' };
            }
            // Anything else (call expressions, identifiers, etc.)
            else if (isTracked) {
              hints[`this.${propName}`] = { kind: 'unknown', isTracked: true };
            }
            // Not tracked, unknown expression — skip
          }
        },
        ClassMethod(path: Babel.NodePath<Babel.types.ClassMethod>) {
          if (path.node.key.type === 'Identifier' && path.node.key.name === '$static') {
            path.replaceWith(
              t.classProperty(
                t.identifier(SYMBOLS.$template),
                // hbs literal
                t.taggedTemplateExpression(
                  t.identifier('hbs'),
                  // @ts-expect-error expression type
                  path.node.body.body[0].expression.arguments[0],
                ),
                null,
                null,
                true,
              ),
            );
          }
        },
        // Handle static block pattern from content-tag preprocessor
        // Converts: static { template(`...`, {...}) }
        // To: [$template] = hbs`...`
        StaticBlock(path: Babel.NodePath<Babel.types.StaticBlock>) {
          // Check if the static block contains a single template() call or hbs``
          const body = path.node.body;
          if (body.length === 1 && body[0].type === 'ExpressionStatement') {
            const expr = body[0].expression;
            // Check for template() call
            if (
              expr.type === 'CallExpression' &&
              expr.callee.type === 'Identifier' &&
              expr.arguments[0]?.type === 'TemplateLiteral'
            ) {
              const templateFnNames = getTemplateFunctionNames(path);
              const isTemplateCall = expr.callee.name === 'template'
                || templateFnNames.has(expr.callee.name);
              if (isTemplateCall) {
                // Convert to [$template] = hbs`...` property
                path.replaceWith(
                  t.classProperty(
                    t.identifier(SYMBOLS.$template),
                    t.taggedTemplateExpression(
                      t.identifier('hbs'),
                      expr.arguments[0] as Babel.types.TemplateLiteral,
                    ),
                    null,
                    null,
                    true,
                  ),
                );
              }
            }
            // Check for hbs`` (already transformed)
            else if (expr.type === 'TaggedTemplateExpression' &&
                     expr.tag.type === 'Identifier' &&
                     expr.tag.name === 'hbs') {
              path.replaceWith(
                t.classProperty(
                  t.memberExpression(t.thisExpression(), t.identifier(SYMBOLS.$template)),
                  expr,
                  null,
                  null,
                  false,
                  true,
                ),
              );
            }
          }
        },
        CallExpression(path: Babel.NodePath<Babel.types.CallExpression>) {
          if (path.node.callee && path.node.callee.type === 'Identifier') {
            if (path.node.callee.name === 'scope') {
              path.remove();
            } else {
              const templateFnNames = getTemplateFunctionNames(path);
              const isTemplateCall = path.node.callee.name === 'template'
                || templateFnNames.has(path.node.callee.name);
              if (isTemplateCall) {
                path.replaceWith(
                  t.taggedTemplateExpression(
                    t.identifier('hbs'),
                    path.node.arguments[0] as Babel.types.TemplateLiteral,
                  ),
                );
              } else if (path.node.callee.name === 'formula') {
                if (mode === 'production') {
                  // remove last argument if two arguments
                  if (path.node.arguments.length === 2) {
                    path.node.arguments.pop();
                  }
                }
              } else if (path.node.callee.name === 'getRenderTargets') {
                if (mode === 'production') {
                  // remove last argument if two arguments
                  if (path.node.arguments.length === 2) {
                    path.node.arguments.pop();
                  }
                }
              }
            }
          }
        },
        ImportDeclaration(path: Babel.NodePath<Babel.types.ImportDeclaration>) {
          if (path.node.source.value === '@ember/template-compiler') {
            const templateFunctionNames = getTemplateFunctionNames(path);
            templateFunctionNames.add('template');
            path.node.source.value = MAIN_IMPORT;
            path.node.specifiers.forEach((specifier: any) => {
              if (specifier.type === 'ImportSpecifier') {
                const importedName = specifier.imported.type === 'Identifier' ? specifier.imported.name : undefined;
                if (importedName === 'template') {
                  templateFunctionNames.add(specifier.local.name);
                }
                specifier.local.name = 'hbs';
                specifier.imported.name = 'hbs';
              } else {
                specifier.local.name = 'hbs';
              }
            });
          }
        },
        Program(path: Babel.NodePath<Babel.types.Program>) {
          const state = (path.state ??= {}) as { templateFunctionNames?: Set<string> };
          state.templateFunctionNames = new Set<string>();
          const PUBLIC_API = Object.values(SYMBOLS);
          const IMPORTS = PUBLIC_API.map((name) => {
            return t.importSpecifier(t.identifier(name), t.identifier(name));
          });
          path.node.body.unshift(
            t.importDeclaration(IMPORTS, t.stringLiteral(MAIN_IMPORT)),
          );
        },
        ReturnStatement: {
          enter(_: Babel.NodePath<Babel.types.ReturnStatement>, context: Context) {
            context.isInsideReturnStatement = true;
          },
          exit(_: Babel.NodePath<Babel.types.ReturnStatement>, context: Context) {
            context.isInsideReturnStatement = false;
          },
        },
        TaggedTemplateExpression(path: Babel.NodePath<Babel.types.TaggedTemplateExpression>, context: Context) {
          if (path.node.tag.type === 'Identifier' && path.node.tag.name === 'hbs') {
            const template = path.node.quasi.quasis[0].value.raw as string;
            const isInsideClassBody = context.isInsideClassBody === true;
            const hasThisInTemplate = template.includes('this');
            let hasThisAccess = isInsideClassBody === true || hasThisInTemplate;
            // looks like it's function based template, we don't need to mess with it's context hell
            if (context.isInsideReturnStatement === true) {
              hasThisAccess = true;
            }
            // Capture template content location for source maps
            // The quasi.quasis[0] contains the actual template string content
            const quasiLoc = path.node.quasi.quasis[0].loc;
            const decoratorHints = context.decoratorHints as Record<string, PropertyTypeHint> | undefined;
            hbsToProcess.push({
              template,
              flags: {
                hasThisAccess: hasThisAccess,
              },
              bindings: getScopeBindings(path),
              lexicalScope: (name: string) => path.scope.hasBinding(name),
              loc: quasiLoc ? {
                start: {
                  line: quasiLoc.start.line,
                  column: quasiLoc.start.column,
                  offset: path.node.quasi.quasis[0].start ?? (quasiLoc.start as any).offset,
                },
                end: {
                  line: quasiLoc.end.line,
                  column: quasiLoc.end.column,
                  offset: path.node.quasi.quasis[0].end ?? (quasiLoc.end as any).offset,
                },
              } : undefined,
              typeHints: decoratorHints ? { properties: { ...decoratorHints } } : undefined,
            });
            context.decoratorHints = undefined;
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
        const nodeName = path.node.id.name;
        if (nodeName === 'formula' || nodeName === 'cell') {
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
          const name = path.node.callee.name;
          if (name === 'addToTree' && path.node.arguments.length === 3) {
            path.node.arguments.pop();
          } else if (
            name === 'cell' ||
            name === 'formula' ||
            name === 'resolveRenderable'
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
