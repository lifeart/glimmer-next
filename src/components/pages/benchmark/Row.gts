import { RemoveIcon } from './RemoveIcon.gts';
import type { Item } from '@/utils/data';
import { Component, cellFor } from '@lifeart/gxt';
import type { ModifierReturn } from '@glint/template/-private/integration';

type RowArgs = {
  Args: {
    item: Item;
    selected: number;
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
    return this.args.selected === this.id;
  }
  get className() {
    return this.isSelected ? 'bg-blue-500' : '';
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
  modifier = (element: HTMLDivElement): ModifierReturn => {
    const result = async () => {
      if (!this.isClicked) {
        return;
      }
      const scrollTop = document.documentElement.scrollTop;
      if (Math.random() > 0.5) {
        const rect = element.getBoundingClientRect();
        element.style.position = 'absolute';
        element.style.top = `${rect.top + scrollTop}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = 'blue';
        element.style.transition = 'all 1.4s ease';
        element.style.transform = 'scale(0)';
        await new Promise((resolve) => setTimeout(resolve, 1400));
      } else {
        const rect = element.getBoundingClientRect();
        element.style.position = 'absolute';
        element.style.top = `${rect.top + scrollTop}px`;
        element.style.left = `${rect.left}px`;
        element.style.width = `${rect.width}px`;
        element.style.height = `${rect.height}px`;
        element.style.backgroundColor = 'blue';
        element.style.transition = 'all 1.4s ease';
        element.style.transform = 'translateX(100%)';
        await new Promise((resolve) => setTimeout(resolve, 1400));
      }
    };
    return result as unknown as ModifierReturn;
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
