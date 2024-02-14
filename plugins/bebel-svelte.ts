import type Babel from '@babel/core';

export default function babelSvelteTransform(babel: typeof Babel) {
  /*
    transforming 
    export let foo = bar;

    to Object.defineProperty(ctx, 'foo', {
        get() {
            return args['foo] ?? bar;
        }
    });

    and all it's usages from 
        foo.bar
    to 
        ctx['foo'].bar

*/

  const { types: t } = babel;
  type State = {
    exportedIdentifiers: Map<any, any>;
  };

  const contextName = '$ctx';

  return {
    name: 'svelte-export-transform',
    visitor: {
      Program: {
        enter(_: any, state: State) {
          state.exportedIdentifiers = new Map();
        },
        exit(path: any, state: State) {
          path.traverse({
            ReferencedIdentifier(path: any) {
              const identifierName = path.node.name;
              if (state.exportedIdentifiers.has(identifierName)) {
                // We're referencing an exported identifier; replace it.
                const ctxIdentifier = t.memberExpression(
                  t.identifier(contextName),
                  t.stringLiteral(identifierName),
                  true,
                );
                if (
                  path.parentPath.isOptionalMemberExpression({
                    object: path.node,
                  }) ||
                  path.parentPath.isMemberExpression({ object: path.node })
                ) {
                  // The identifier is the object of a member expression.
                  // Replace the identifier, but keep the rest of the expression as is.
                  path.replaceWith(ctxIdentifier);
                } else if (
                  path.findParent((p: any) => p.isOptionalMemberExpression())
                ) {
                  // Inside an optional chain, but not the object itself.
                  // This case might be less common based on the current requirements.
                  // Adjust or extend as necessary for your specific use cases.
                } else {
                  // Not part of a member expression; replace directly.
                  path.replaceWith(ctxIdentifier);
                }
              }
            },
          });
        },
      },
      ExportNamedDeclaration(path: any, state: State) {
        if (
          path.node.declaration &&
          path.node.declaration.type === 'VariableDeclaration'
        ) {
          const declarations = path.node.declaration.declarations;
          declarations.forEach((declaration: any) => {
            // TODO: support it without init
            if (declaration.id && declaration.init) {
              const varName = declaration.id.name;
              // Mark this variable name as exported.
              state.exportedIdentifiers.set(varName, true);

              // Replace the export statement with the appropriate Object.defineProperty call.
              const definePropertyCall = t.callExpression(
                t.memberExpression(
                  t.identifier('Object'),
                  t.identifier('defineProperty'),
                ),
                [
                  t.identifier(contextName),
                  t.stringLiteral(varName),
                  t.objectExpression([
                    t.objectProperty(
                      t.identifier('get'),
                      t.functionExpression(
                        null,
                        [],
                        t.blockStatement([
                          t.returnStatement(
                            t.logicalExpression(
                              '??',
                              t.memberExpression(
                                t.identifier('args'),
                                t.stringLiteral(varName),
                                true,
                              ),
                              declaration.init,
                            ),
                          ),
                        ]),
                      ),
                    ),
                  ]),
                ],
              );
              path.replaceWith(definePropertyCall);
            }
          });
        }
      },
    },
  };
}
