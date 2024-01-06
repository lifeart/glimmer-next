import { writeFileSync } from 'node:fs';
import path from "node:path";
import { fileURLToPath } from "node:url";

const self = import.meta.url;
const currentPath = path.dirname(fileURLToPath(self));
writeFileSync(path.join(currentPath, '..', 'compiler.d.ts'), `export * from './dist/plugins/compiler'`);