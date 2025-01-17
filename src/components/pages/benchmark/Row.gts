import { RemoveIcon } from './RemoveIcon.gts';
import type { Item } from '@/utils/data';
import { type Cell, Component, cellFor, formula } from '@lifeart/gxt';

type RowArgs = {
  Args: {
    item: Item;
    selected: number | Cell<number>;
    onRemove: (item: Item) => void;
    onSelect: (item: Item) => void;
  };
  Element: HTMLTableRowElement;
};

export class Row extends Component<RowArgs> {
  isClicked = false;
  get labelCell() {
    return cellFor(this.args.item, 'label');
  }
  get id() {
    return this.args.item.id;
  }
  get isSelected() {
    const selected = this.args.selected;
    if (IS_GLIMMER_COMPAT_MODE) {
      return (selected as unknown as number) === this.id;
    } else {
      return (selected as unknown as Cell<number>).value === this.id;
    }
  }
  get className() {
    if (IS_GLIMMER_COMPAT_MODE) {
      return this.isSelected ? 'bg-blue-500' : '';
    } else {
      return formula(
        () => (this.isSelected ? 'bg-blue-500' : ''),
        'isSelected',
      );
    }
  }
  onClick = () => {
    this.args.onSelect(this.args.item);
  };
  onClickRemove = (e: Event) => {
    if (e.isTrusted) {
      this.isClicked = true;
    }
    this.args.onRemove(this.args.item);
  };
  modifier = (element: HTMLDivElement) => {
    const result = async () => {
      if (!this.isClicked) {
        return;
      }
      const scrollTop = document.documentElement.scrollTop;
      const rect = element.getBoundingClientRect();
      if (Math.random() > 0.5) {
        element.style.position = 'absolute';
        element.style.top = `${rect.top + (scrollTop || -80)}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = 'blue';
        element.style.transition = 'all 1.4s ease';
        element.style.transform = 'scale(0)';
      } else {
        element.style.position = 'absolute';
        element.style.top = `${rect.top + (scrollTop || -80)}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = 'blue';
        element.style.transition = 'all 1.4s ease';
        element.style.transform = 'translateX(100%)';
      }
      await Promise.allSettled(element.getAnimations().map((a) => a.finished));
    };
    return result;
  };
  <template>
    <tr ...attributes {{this.modifier}}>
      <th
        scope='row'
        class={{this.className}}
        class='px-6 py-4 font-medium text-gray-900 whitespace-nowrap dark:text-white'
      >{{this.id}}</th>
      <td class='px-6 py-4' class={{this.className}}>
        <a
          class='cursor-pointer'
          {{on 'click' this.onClick}}
          data-no-router
          data-test-select
        >{{this.labelCell}}</a>
      </td>
      <td class='px-6 py-4' class={{this.className}}>
        <a
          {{on 'click' this.onClickRemove}}
          data-no-router
          data-test-remove
          class='cursor-pointer mr-1 rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600'
        >
          <RemoveIcon />
        </a>
      </td>
    </tr>
  </template>
}
