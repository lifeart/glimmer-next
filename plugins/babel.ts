import type Babel from "@babel/core";

export function processTemplate(hbsToProcess: string[]) {
  return function babelPlugin(babel: { types: typeof Babel.types }) {
    const { types: t } = babel;

    return {
      name: "ast-transform", // not required
      visitor: {
        ClassMethod(path: any) {
          if (path.node.key.name === "$static") {
            path.replaceWith(
              t.classProperty(
                t.identifier("template"),
                // hbs literal
                t.taggedTemplateExpression(
                  t.identifier("hbs"),
                  path.node.body.body[0].expression.arguments[0]
                )
              )
            );
          }
        },
        CallExpression(path: any) {
          if (path.node.callee && path.node.callee.type === "Identifier") {
            if (path.node.callee.name === "scope") {
              path.remove();
            } else if (path.node.callee.name === "template") {
              path.replaceWith(
                t.taggedTemplateExpression(
                  t.identifier("hbs"),
                  path.node.arguments[0]
                )
              );
            }
          }
        },
        ImportDeclaration(path: any) {
          if (path.node.source.value === "@ember/template-compiler") {
            path.node.source.value = "@/utils/template";
            path.node.specifiers.forEach((specifier: any) => {
              specifier.local.name = "hbs";
              specifier.imported.name = "hbs";
            });
          }
        },
        Program(path: any) {
          path.node.body.unshift(
            t.importDeclaration(
              [
                t.importSpecifier(t.identifier("DOM"), t.identifier("DOM")),
                t.importSpecifier(
                  t.identifier("finalizeComponent"),
                  t.identifier("finalizeComponent")
                ),
              ],
              t.stringLiteral("@/utils/dom")
            )
          );
        },
        TaggedTemplateExpression(path: any) {
          if (path.node.tag.name === "hbs") {
            hbsToProcess.push(path.node.quasi.quasis[0].value.raw);
            path.replaceWith(t.identifier("$placeholder"));
          }
        },
      },
    };
  };
}
