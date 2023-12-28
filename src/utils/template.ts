export function hbs(tpl: TemplateStringsArray) {
    return {
        nodes: [],
        destructors: [],
        index: 0,
        tpl,
    }
}