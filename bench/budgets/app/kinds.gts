// The three row shapes the budget harness renders. All three produce the
// same DOM per row (krausest markup); they differ only in which gxt path
// builds it:
//   inline    — a non-component each-body WITH `{{on}}` (the `$_blk` path;
//               event slots keep it off frame mode today)
//   component — a class component row (krausest's gxt Row)
//   frames    — the inline body WITHOUT events (frame mode; a reference
//               point for what the event-free fast path costs)
// Formatting note: keep the row markup on single lines — prettier's template
// formatter would add whitespace text nodes to the rows.
import { Component } from '@lifeart/gxt';
import type { Item } from './data';
import type { Store } from './store';

type RootArgs = { Args: { store: Store } };

export const InlineRows = <template>
  <table class='table'><tbody>
    {{#each @store.items key='id' sync=true as |item|}}
      <tr class={{if (eq @store.selected item.id) 'danger'}}>
        <td class='col-md-1'>{{item.id}}</td>
        <td class='col-md-4'><a {{on 'click' (fn @store.select item)}}>{{item.label}}</a></td>
        <td class='col-md-1'><a {{on 'click' (fn @store.remove item)}}><span class='glyphicon glyphicon-remove' aria-hidden='true'></span></a></td>
        <td class='col-md-6'></td>
      </tr>
    {{/each}}
  </tbody></table>
</template>;

export const FrameRows = <template>
  <table class='table'><tbody>
    {{#each @store.items key='id' sync=true as |item|}}
      <tr class={{if (eq @store.selected item.id) 'danger'}}>
        <td class='col-md-1'>{{item.id}}</td>
        <td class='col-md-4'><a>{{item.label}}</a></td>
        <td class='col-md-1'><a><span class='glyphicon glyphicon-remove' aria-hidden='true'></span></a></td>
        <td class='col-md-6'></td>
      </tr>
    {{/each}}
  </tbody></table>
</template>;

type RowArgs = {
  Args: {
    item: Item;
    selected: number;
    onSelect: (item: Item) => void;
    onRemove: (item: Item) => void;
  };
};

export class Row extends Component<RowArgs> {
  get className() {
    return this.args.selected === this.args.item.id ? 'danger' : '';
  }
  onClick = () => {
    this.args.onSelect(this.args.item);
  };
  onClickRemove = () => {
    this.args.onRemove(this.args.item);
  };
  <template>
    <tr class={{this.className}}>
      <td class='col-md-1'>{{@item.id}}</td>
      <td class='col-md-4'><a {{on 'click' this.onClick}}>{{@item.label}}</a></td>
      <td class='col-md-1'><a {{on 'click' this.onClickRemove}}><span class='glyphicon glyphicon-remove' aria-hidden='true'></span></a></td>
      <td class='col-md-6'></td>
    </tr>
  </template>
}

export class ComponentRows extends Component<RootArgs> {
  <template>
    <table class='table'><tbody>
      {{#each @store.items key='id' sync=true as |item|}}
        <Row
          @item={{item}}
          @selected={{@store.selected}}
          @onSelect={{@store.select}}
          @onRemove={{@store.remove}}
        />
      {{/each}}
    </tbody></table>
  </template>
}
