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

// Animation variations for row removal
const animations = [
  // Fly up and rotate left
  { transform: 'translateY(-300px) translateX(-100px) rotate(-30deg) scale(0.5)', opacity: '0' },
  // Fly up and rotate right
  { transform: 'translateY(-300px) translateX(100px) rotate(30deg) scale(0.5)', opacity: '0' },
  // Fly left
  { transform: 'translateX(-500px) rotate(-15deg) scale(0.7)', opacity: '0' },
  // Fly right
  { transform: 'translateX(500px) rotate(15deg) scale(0.7)', opacity: '0' },
  // Shrink and spin
  { transform: 'scale(0) rotate(360deg)', opacity: '0' },
  // Fly up fast
  { transform: 'translateY(-400px) scale(0.3)', opacity: '0' },
  // Fall and fade
  { transform: 'translateY(200px) rotate(10deg) scale(0.8)', opacity: '0' },
  // Zoom out
  { transform: 'scale(1.5) translateY(-50px)', opacity: '0' },
];

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
      return this.isSelected ? 'bg-blue-500/20' : '';
    } else {
      return formula(
        () => (this.isSelected ? 'bg-blue-500/20' : ''),
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

  modifier = (element: HTMLTableRowElement) => {
    const result = async () => {
      if (!this.isClicked) {
        return;
      }

      // Get current position
      const rect = element.getBoundingClientRect();

      // Lock cell widths
      const cells = element.querySelectorAll('td, th');
      cells.forEach((cell) => {
        const htmlCell = cell as HTMLElement;
        htmlCell.style.width = `${htmlCell.offsetWidth}px`;
      });

      // Position element fixed at its current location
      element.style.position = 'fixed';
      element.style.top = `${rect.top}px`;
      element.style.left = `${rect.left}px`;
      element.style.width = `${rect.width}px`;
      element.style.height = `${rect.height}px`;
      element.style.margin = '0';
      element.style.zIndex = '9999';
      element.style.pointerEvents = 'none';
      element.style.transformOrigin = 'center center';
      element.style.background = 'linear-gradient(135deg, rgba(239, 68, 68, 0.4), rgba(239, 68, 68, 0.2))';
      element.style.borderRadius = '8px';
      element.style.boxShadow = '0 4px 20px rgba(239, 68, 68, 0.3)';

      // Pick random animation
      const animation = animations[Math.floor(Math.random() * animations.length)];
      const duration = 500 + Math.random() * 300;

      // Force reflow
      element.offsetHeight;

      // Apply transition
      element.style.transition = `all ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;

      // Start animation
      requestAnimationFrame(() => {
        element.style.transform = animation.transform;
        element.style.opacity = animation.opacity;
      });

      // Wait for animation
      await new Promise(resolve => setTimeout(resolve, duration));
    };

    return result;
  };

  <template>
    <tr class='border-b border-slate-700/50 hover:bg-slate-700/30 transition-colors' ...attributes {{this.modifier}}>
      <td
        scope='row'
        class={{this.className}}
        class='px-4 py-2.5 font-medium text-slate-400 text-sm'
      >{{this.id}}</td>
      <td class='px-4 py-2.5' class={{this.className}}>
        <a
          class='cursor-pointer text-slate-200 hover:text-blue-400 transition-colors'
          {{on 'click' this.onClick}}
          data-no-router
          data-test-select
        >{{this.labelCell}}</a>
      </td>
      <td class='px-4 py-2.5' class={{this.className}}>
        <a
          {{on 'click' this.onClickRemove}}
          data-no-router
          data-test-remove
          class='cursor-pointer inline-flex items-center justify-center w-7 h-7 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors'
        >
          <RemoveIcon />
        </a>
      </td>
    </tr>
  </template>
}
