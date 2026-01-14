export const TEMPLATE_ONLY = Symbol('template-only-component');
export default function (moduleName: string, name: string) {
  return {
    TEMPLATE_ONLY,
    moduleName,
    name,
  }
}
