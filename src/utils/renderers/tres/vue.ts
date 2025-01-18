import { isTag } from '@/utils/helpers/-private';
import { cell } from '@lifeart/gxt';

export const ref = cell;
export function unref(el: any) {
    if (isTag(el)) {
        console.log('unref-tag', el);
        return el.value;
    }
    console.log('unref', el);
    return el;
}
export function useFps() {
    console.log('useFps', ...arguments);
}
export function unrefElement(node) {
    console.log('unrefElement', node);
    return node;
}
export function useMemory() {
    console.log('useMemory', ...arguments);
    return {
        isSupported: false,
        memory: 100,
    }
}

export function useRafFn() {
    console.log('useRafFn', ...arguments);
    return {
        pause() {
            debugger;
        }
    }
}
export function computed(fn: any) {
    console.log('computed');
    return {
        get value() {
            return fn();
        }
    }
}
export function inject() {
    console.log('inject', ...arguments);
}
export function provide() {
    console.log('provide', ...arguments);
}
export function readonly(v) {
    console.log('readOnly', ...arguments);
    return v;
}
export function onUnmounted(fn: any) {
    console.log('onUnmounted', fn);
}
export function watchEffect(fn: any) {
    console.log('watchEffect', fn);
    // fn();
}
export type MaybeRef = any;

export function shallowRef(el) {
    console.log('shallowRef', ...arguments);
    return el;
}
export function watch() {
    console.log('watch', ...arguments);
}
