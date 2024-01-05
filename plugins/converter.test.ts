import { expect, test, describe } from "vitest";
import { preprocess } from "@glimmer/syntax";

import { convert } from "./converter";
import { ASTv1 } from "@glimmer/syntax";
import { HBSControlExpression, HBSNode } from "./utils";
import { EVENT_TYPE } from "./symbols";

function $t<T extends ASTv1.Node>(tpl: string): T {
  const seenNodes: Set<ASTv1.Node> = new Set();
  const { ToJSType } = convert(seenNodes);
  const ast = preprocess(tpl);
  const node = ast.body[0] as T;
  return ToJSType(node);
}

function $control(
  partial: Partial<HBSControlExpression>
): HBSControlExpression {
  return {
    type: "if",
    isControl: true,
    condition: "",
    blockParams: [],
    children: [],
    inverse: null,
    key: null,
    ...partial,
  };
}

function $node(partial: Partial<HBSNode>): HBSNode {
  return {
    ...partial,
    events: partial.events ?? [],
    children: partial.children ?? [],
    attributes: partial.attributes ?? [],
    properties: partial.properties ?? [],
    blockParams: partial.blockParams ?? [],
    selfClosing: partial.selfClosing ?? false,
    hasStableChild: partial.hasStableChild ?? true,
    tag: partial.tag ?? "",
  };
}

describe("convert function builder", () => {
  describe("TextNode", () => {
    test("converts a simple string", () => {
      expect($t<ASTv1.TextNode>(`"Hello World"`)).toEqual(`"Hello World"`);
    });
    test("non empty text nodes not trimmed", () => {
      expect($t<ASTv1.TextNode>(` foo`)).toEqual(` foo`);
    });
    test("non empty text nodes trimmed", () => {
      expect($t<ASTv1.TextNode>(` `)).toEqual(null);
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
      expect($t<ASTv1.ElementNode>(`<div></div>`)).toEqual(
        $node({ tag: "div" })
      );
    });
    test("converts a simple element with string attribute", () => {
      expect($t<ASTv1.ElementNode>(`<div class="foo"></div>`)).toEqual(
        $node({
          tag: "div",
          properties: [["className", "foo"]],
        })
      );
    });
    test("converts a simple element with string child", () => {
      expect($t<ASTv1.ElementNode>(`<div> sd</div>`)).toEqual(
        $node({
          tag: "div",
          events: [[EVENT_TYPE.TEXT_CONTENT, " sd"]],
        })
      );
    });
    test("converts a simple element with complex child", () => {
      expect($t<ASTv1.ElementNode>(`<div> sd<span></span></div>`)).toEqual(
        $node({
          tag: "div",
          children: [" sd", $node({ tag: "span" })],
        })
      );
    });
    test("converts a simple element with concat string attribute", () => {
      expect(
        $t<ASTv1.ElementNode>(`<div class="{{foo}} bar {{boo baks}}"></div>`)
      ).toEqual(
        $node({
          tag: "div",
          properties: [
            ["className", "$:() => [$:foo,\" bar \",$:boo(baks)].join('')"],
          ],
        })
      );
    });
    test("converts a simple element with path attribute", () => {
      expect($t<ASTv1.ElementNode>(`<div class={{foo}}></div>`)).toEqual(
        $node({
          tag: "div",
          properties: [["className", "$:foo"]],
        })
      );
    });
    test("converts a simple element with path attribute with string literal", () => {
      expect($t<ASTv1.ElementNode>(`<div class={{foo "bar"}}></div>`)).toEqual(
        $node({
          tag: "div",
          properties: [["className", '$:() => $:foo("bar")']],
        })
      );
    });
    test("converts a simple element with path attribute with path literal", () => {
      expect($t<ASTv1.ElementNode>(`<div class={{foo bar}}></div>`)).toEqual(
        $node({
          tag: "div",
          properties: [["className", "$:() => $:foo(bar)"]],
        })
      );
    });
    test("converts a simple element with `on` modifier", () => {
      // @todo - likely need to return proper closure here (arrow function)
      expect($t<ASTv1.ElementNode>(`<div {{on "click" foo}}></div>`)).toEqual(
        $node({
          tag: "div",
          events: [["click", "$:($e, $n) => $:foo($e, $n, )"]],
        })
      );
    });
    test("converts a simple element with `on` modifier, with composed args", () => {
      // @todo - likely need to return proper closure here (arrow function)
      expect(
        $t<ASTv1.ElementNode>(`<div {{on "click" (foo bar baz)}}></div>`)
      ).toEqual(
        $node({
          tag: "div",
          events: [["click", "$:($e, $n) => $:foo($:bar,$:baz)($e, $n, )"]],
        })
      );
    });
    test("support custom modifiers", () => {
      expect($t<ASTv1.ElementNode>(`<div {{foo-bar}}></div>`)).toEqual(
        $node({
          tag: "div",
          events: [["0", "$:($n) => $:foo-bar($n, )"]],
        })
      );
    });
  });
  describe("if condition", () => {
    test("only true part", () => {
      expect(
        $t<ASTv1.BlockStatement>(`{{#if foo}}123{{/if}}`)
      ).toEqual<HBSControlExpression>(
        $control({
          condition: "$:foo",
          children: ["123"],
        })
      );
    });

    test("both parts", () => {
      expect(
        $t<ASTv1.BlockStatement>(`{{#if foo}}123{{else}}456{{/if}}`)
      ).toEqual<HBSControlExpression>(
        $control({
          condition: "$:foo",
          children: ["123"],
          inverse: ["456"],
        })
      );
    });

    test("helper in condition", () => {
      expect(
        $t<ASTv1.BlockStatement>(`{{#if (foo bar)}}123{{else}}456{{/if}}`)
      ).toEqual<HBSControlExpression>(
        $control({
          type: "if",
          condition: "$:foo($:bar)",
          children: ["123"],
          inverse: ["456"],
        })
      );
    });
  });
  describe("each condition", () => {
    test("it works", () => {
      expect(
        $t<ASTv1.BlockStatement>(`{{#each foo as |bar index|}}123{{/each}}`)
      ).toEqual<HBSControlExpression>(
        $control({
          type: "each",
          condition: "$:foo",
          blockParams: ["bar", "index"],
          children: ["123"],
        })
      );
    });
    test("it could provide keys", () => {
      expect(
        $t<ASTv1.BlockStatement>(
          `{{#each foo key="id" as |bar index|}}123{{/each}}`
        )
      ).toEqual<HBSControlExpression>(
        $control({
          type: "each",
          condition: "$:foo",
          blockParams: ["bar", "index"],
          children: ["123"],
          key: "id",
        })
      );
    });
  });
  describe("stableChildDetection", () => {
    test("detects stable child", () => {
      expect($t<ASTv1.ElementNode>(`<div>foo</div>`)).toEqual(
        $node({
          tag: "div",
          hasStableChild: true,
          events: [[EVENT_TYPE.TEXT_CONTENT, "foo"]],
        })
      );
      expect($t<ASTv1.ElementNode>(`<div><p></p></div>`)).toEqual(
        $node({
          tag: "div",
          hasStableChild: true,
          children: [$node({ tag: "p" })],
        })
      );
      expect($t<ASTv1.ElementNode>(`<div><:slot></:slot></div>`)).toEqual(
        $node({
          tag: "div",
          hasStableChild: false,
          children: [$node({ tag: ":slot" })],
        })
      );
      expect($t<ASTv1.ElementNode>(`<div>{{#if foo}}123{{/if}}</div>`)).toEqual(
        $node({
          tag: "div",
          hasStableChild: false,
          children: [
            $control({
              condition: "$:foo",
              children: ["123"],
            }),
          ],
        })
      );
    });
  });

  describe("components", () => {
    test("it forwarding props", () => {
      expect($t<ASTv1.ElementNode>(`<DIV @name={{1}}></DIV>`)).toEqual(
        $node({
          tag: "DIV",
          attributes: [["@name", 1]],
        })
      );
    });
  });
});
