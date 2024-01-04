import { Button } from "@/components/Button";
import { hbs, scope } from "@/utils/template";

export function ButtonWrapper({
  onClick,
  text,
  id,
}: {
  onClick: () => void;
  text: string;
  id: string;
}) {
  scope({ Button, text, id, onClick });
  return hbs`
        <div class="col-sm-6 smallpad">
            <Button @onClick={{onClick}} @text={{text}} ...attributes @id={{id}}>
                <:slot as |texts|>
                    {{texts}}
                </:slot>
            </Button>
        </div>
    `;
}
