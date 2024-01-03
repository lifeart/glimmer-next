import { expect, test, describe } from "vitest";
import { preprocess } from "@glimmer/syntax";

import { convert } from "./converter";
import type { ASTv1 } from "@glimmer/syntax";
import { HBSNode } from "./utils";

function $t<T extends ASTv1.Node>(tpl: string): T {
  const seenNodes: Set<ASTv1.Node> = new Set();
  const { ToJSType } = convert(seenNodes);
  const ast = preprocess(tpl);
  const node = ast.body[0] as T;
  return ToJSType(node);
}

function $node(partial: Partial<HBSNode>): HBSNode {
  return {
    ...partial,
    events: partial.events ?? [],
    children: partial.children ?? [],
    attributes: partial.attributes ?? [],
    blockParams: partial.blockParams ?? [],
    selfClosing: partial.selfClosing ?? false,
    tag: partial.tag ?? "",
  };
}

describe("convert function builder", () => {
  describe("TextNode", () => {
    test("converts a simple string", () => {
      expect($t<ASTv1.TextNode>(`"Hello World"`)).toEqual(`"Hello World"`);
    });
  });
  describe("MustacheStatement", () => {
    test("converts a args-less path", () => {
      expect($t<ASTv1.MustacheStatement>(`{{foo-bar}}`)).toEqual(`$:foo-bar`);
    });
    test("converts a path with args", () => {
      expect($t<ASTv1.MustacheStatement>(`{{foo-bar bas boo}}`)).toEqual(
        `$:() => $:foo-bar(bas,boo)`
      );
    });
    test("converts sub-expression without args", () => {
      expect($t<ASTv1.MustacheStatement>(`{{(foo-bar)}}`)).toEqual(
        `$:() => $:foo-bar()`
      );
    });
    test("supports helper composition", () => {
      expect($t<ASTv1.MustacheStatement>(`{{(foo-bar (baz-bat))}}`)).toEqual(
        `$:() => $:foo-bar($:baz-bat())`
      );
    });
    test("support boolean literals", () => {
      expect($t<ASTv1.MustacheStatement>(`{{true}}`)).toEqual(true);
      expect($t<ASTv1.MustacheStatement>(`{{false}}`)).toEqual(false);
    });
    test("support null literals", () => {
      expect($t<ASTv1.MustacheStatement>(`{{null}}`)).toEqual(null);
    });
    test("support undefined literals", () => {
      expect($t<ASTv1.MustacheStatement>(`{{undefined}}`)).toEqual(undefined);
    });
    test("support bool,  null, undefined as helper args", () => {
      expect(
        $t<ASTv1.MustacheStatement>(`{{foo true null undefined}}`)
      ).toEqual(`$:() => $:foo(true,null,undefined)`);
    });
  });
  describe("ElementNode", () => {
    test("converts a simple element", () => {
      expect($t<ASTv1.ElementNode>(`<div></div>`)).toEqual({
        events: [],
        children: [],
        selfClosing: false,
        tag: "div",
        attributes: [],
        blockParams: [],
      });
    });
    test("converts a simple element with string attribute", () => {
      expect($t<ASTv1.ElementNode>(`<div class="foo"></div>`)).toEqual(
        $node({
          tag: "div",
          attributes: [["class", "foo"]],
        })
      );
    });
    test("converts a simple element with path attribute", () => {
      expect($t<ASTv1.ElementNode>(`<div class={{foo}}></div>`)).toEqual(
        $node({
          tag: "div",
          attributes: [["class", "$:foo"]],
        })
      );
    });
    test("converts a simple element with path attribute with string literal", () => {
      expect($t<ASTv1.ElementNode>(`<div class={{foo "bar"}}></div>`)).toEqual(
        $node({
          tag: "div",
          attributes: [["class", '$:() => $:foo("bar")']],
        })
      );
    });
    test("converts a simple element with path attribute with path literal", () => {
      expect($t<ASTv1.ElementNode>(`<div class={{foo bar}}></div>`)).toEqual(
        $node({
          tag: "div",
          attributes: [["class", "$:() => $:foo(bar)"]],
        })
      );
    });
    test("converts a simple element with `on` modifier", () => {
        // @todo - likely need to return proper closure here (arrow function)
        expect($t<ASTv1.ElementNode>(`<div {{on "click" foo}}></div>`)).toEqual(
            $node({
                tag: "div",
                events: [["click", '$:($e, $n) => $:foo($e, $n, )']],
            })
        );
    });
    test("converts a simple element with `on` modifier, with composed args", () => {
        // @todo - likely need to return proper closure here (arrow function)
        expect($t<ASTv1.ElementNode>(`<div {{on "click" (foo bar baz)}}></div>`)).toEqual(
            $node({
                tag: "div",
                events: [["click", '$:($e, $n) => $:foo($:bar,$:baz)($e, $n, )']],
            })
        );
    });
    test('support custom modifiers', () => {
        expect($t<ASTv1.ElementNode>(`<div {{foo-bar}}></div>`)).toEqual(
            $node({
                tag: "div",
                events: [["onCreated", '$:($n) => $:foo-bar($n, )']],
            })
        );
    });
  });
});