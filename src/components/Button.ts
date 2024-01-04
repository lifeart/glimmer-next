import { hbs, scope } from "@/utils/template";

export function Button({
  onClick,
  text,
  id,
}: {
  onClick: () => void;
  text: string;
  id: string;
}) {
  scope({ onClick, text, id });
  return hbs`
        <button id={{id}} class="btn" ...attributes {{on 'click' onClick}}>
            {{yield to="slot"}}
        </button>
    `;
}
