import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({resolve:{alias:[{find:'@',replacement:resolve(process.cwd(),'app/src')},{find:/^firebase\/(.*)$/,replacement:resolve(process.cwd(),'app/node_modules/firebase')+'/$1/dist/esm/index.esm.js'}]},test:{include:['tests/flows/**/*.test.ts'],testTimeout:30000,hookTimeout:30000,fileParallelism:false}});
