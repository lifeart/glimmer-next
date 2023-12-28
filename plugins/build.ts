import { DOM } from '@/utils/dom';
import { Cell } from "@/utils/reactive";

const id = new Cell("id", "id");
const title = new Cell("title", "title");
const body = new Cell("body", "body");
const MyFunction = (props: { name: Record<string, unknown> }) => {
  return {
    nodes: [],
    destructors: [],
    index: 0,
  };
};
const items = new Cell(
  [{ name: "item 1" }, { name: "item 2" }, { name: "item 3" }],
  "items"
);

function MyComponent() {
  return () => {
    const roots = [
      DOM(
        "div",
        {
          attributes: [["class", "entry"]],
        },
        DOM(
          "h1",
          {
            attributes: [],
          },
          title
        ),
        DOM(
          "div",
          {
            attributes: [["class", "body"]],
          },
          body
        ),
        DOM.each(items, (item) => {
          return MyFunction({
            item: item,
          });
        })
      ),
    ];

    return {
      nodes: roots.reduce((acc, root) => {
        return [...acc, ...root.nodes];
      }, []),
      destructors: roots.reduce((acc, root) => {
        return [...acc, ...root.destructors];
      }, []),
      index: 0,
    };
  };
}
