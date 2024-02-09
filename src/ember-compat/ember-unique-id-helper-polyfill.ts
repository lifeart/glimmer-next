export default function uniqId() {
  return `uid-` + Math.random().toString(36).slice(2);
}
