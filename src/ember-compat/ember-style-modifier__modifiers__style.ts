export default function style(
  element: HTMLElement,
  style: Record<string, string>,
) {
  const styleStr: string[] = [];
  Object.keys(style).forEach((key) => {
    let value = style[key];
    if (value === 'inlineBlock') {
      value = 'inline-block';
    }
    styleStr.push(`${key}:${value}`);
  });
  element.setAttribute('style', styleStr.join(';'));
}
