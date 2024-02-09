const guids = new WeakMap();
let cnt = 0;
export function guidFor(obj: any) {
  if (guids.has(obj)) {
    return guids.get(obj);
  } else {
    cnt++;
    guids.set(obj, cnt);
    return cnt;
  }
}
