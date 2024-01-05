export function hbs(tpl: TemplateStringsArray) {
    return {
        nodes: [],
        slots: {},
        index: 0,
        tpl,
    }
}
export function scope(items: Record<string, unknown>): void {
    if (typeof items !== 'object' || items === null) {
        throw new Error('scope() accepts only object')
    }
   // TODO: implement
}