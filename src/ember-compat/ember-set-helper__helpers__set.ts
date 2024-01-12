export default function set(obj: any, key: string) {
  return (value: any) => {
    obj[key] = value;
  };
}
