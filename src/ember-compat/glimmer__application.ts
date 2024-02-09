export function capabilities() {
  return {};
}
const managers = new WeakMap();
export function setComponentManager(manager: any, componet: any) {
  managers.set(componet, manager);
  return componet;
}
