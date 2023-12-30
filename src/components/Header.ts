import { hbs, scope } from "@/utils/template";
import { ButtonWrapper } from "./ButtonWrapper";
import { Smile } from "./Smile";
import { Clock } from "./Clock";

type Cb = () => void;
type HeaderArgs = {
  run: Cb;
  add: Cb;
  update: Cb;
  clear: Cb;
  swaprows: Cb;
  runlots: Cb;
};
export function Header({
  run,
  add,
  update,
  clear,
  swaprows,
  runlots,
}: HeaderArgs) {
  scope({ ButtonWrapper, run, add, Clock, update, clear, swaprows, runlots, Smile });
  return hbs`
    <div class="jumbotron">
        <div class="row">
            <div class="col-md-6">
                <h1>GlimmerC<a href="https://github.com/lifeart/glimmer-next" target="_blank"><Smile/></a>re <Clock /></h1>
            </div>
            <div class="col-md-6">
                <div class="row">
                    <ButtonWrapper @onClick={{run}} @text="Create 1 000 items" @id="run" />
                    <ButtonWrapper @onClick={{runlots}} @text="Create 5 000 items" @id="runlots" />
                    <ButtonWrapper @onClick={{add}} @text="Append 1 000 rows" @id="add" />
                    <ButtonWrapper @onClick={{update}} @text="Update every 10th row" @id="update" />
                    <ButtonWrapper @onClick={{clear}} @text="Clear" @id="clear" />
                    <ButtonWrapper @onClick={{swaprows}} @text="Swap rows" @id="swaprows" />
                </div>
            </div>
        </div>
    </div>
    `;
}
