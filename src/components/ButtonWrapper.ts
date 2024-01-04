import { Button } from "@/components/Button";
import { cell } from "@/utils/reactive";
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
  scope({ Button, text, id, onClick, className });
  return hbs`
        <div class="col-sm-6 smallpad">
            <Button @onClick={{onClick}} @text={{text}} class="btn-primary btn-block" type="button" @id={{id}} />
        </div>
    `;
}
