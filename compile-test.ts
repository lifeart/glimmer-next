import { Preprocessor } from 'content-tag';
import { transform } from './plugins/test';
import { defaultFlags } from './plugins/flags';
import * as fs from 'fs';

const p = new Preprocessor();

function fixContentTagOutput(code: string): string {
  return code.split('static{').join('$static() {');
}

const file = './src/tests/integration/hash-test.gts';
const content = fs.readFileSync(file, 'utf-8');
const flags = defaultFlags();
const processed = fixContentTagOutput(p.process(content, { filename: file }));
const result = await transform(processed, file, 'development', false, flags, content);

if (result) {
  console.log(result.code);
} else {
  console.log('Transform returned null');
}
