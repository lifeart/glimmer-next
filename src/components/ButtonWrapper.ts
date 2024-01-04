import { Button } from "@/components/Button";
import { hbs, scope } from "@/utils/template";

export function ButtonWrapper({
  onClick,
  text,
}: {
  onClick: () => void;
  text: string;
}) {
  scope({ Button, text, onClick });
  return hbs`
        <div class="col-sm-6 smallpad">
            <Button @onClick={{onClick}} ...attributes>
                <:slot>
                   {{yield}}
                </:slot>
            </Button>
        </div>
    `;
}
