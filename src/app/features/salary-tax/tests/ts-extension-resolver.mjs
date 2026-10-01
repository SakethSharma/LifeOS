// Lets plain `node --experimental-strip-types` run the app's extensionless
// relative TS imports (the Angular convention used throughout this repo)
// without changing any source file's import style.
import { register } from 'node:module';

register('./ts-extension-loader.mjs', import.meta.url);
