import { hbs, scope } from "@/utils/template";
import type { Application } from "./Application";
import { Header } from "./Header";
import { Row } from "./Row";
export function App({ app }: { app: Application }) {
  const actions = {
    run: () => app.create_1_000_Items(),
    add: () => app.append_1_000_Items(),
    update: () => app.updateEvery_10th_row(),
    clear: () => app.clear(),
    swaprows: () => app.swapRows(),
    runlots: () => app.create_5_000_Items(),
  };

  scope({ app, actions, Row, Header });

  return hbs`
        <div class="container">
            <Header 
                @run={{actions.run}} 
                @add={{actions.add}} 
                @update={{actions.update}} 
                @clear={{actions.clear}} 
                @swaprows={{actions.swaprows}} 
                @runlots={{actions.runlots}}
            />
            <table class="table table-hover table-striped test-data">
                <tbody id="tbody">
                    {{#each app._items as |item|}}
                        <Row 
                            @item={{item}} 
                            @selectedCell={{app.selectedCell}} 
                            @onRemove={{app.removeItem}}
                        />
                    {{/each}}
                </tbody>
            </table>
        </div>
    `;
}
