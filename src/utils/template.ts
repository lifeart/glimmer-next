export function hbs(tpl: TemplateStringsArray) {
    return {
        nodes: [],
        destructors: [],
        index: 0,
        tpl,
    }
}
export function scope(items: Record<string, unknown>): void {
   // TODO: implement
}