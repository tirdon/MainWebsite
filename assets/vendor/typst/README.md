# Typst web compiler (JavaScript glue)

`typst_ts_web_compiler.mjs` is copied unchanged from the npm package
`@myriaddreamin/typst-ts-web-compiler` version 0.7.0 (`pkg/typst_ts_web_compiler.mjs`),
part of [typst.ts](https://github.com/Myriad-Dreamin/typst.ts), licensed under Apache-2.0.

It is the loader for the Typst WebAssembly compiler used by `assets/js/ui/cv.js`.
The matching `.wasm` binary is not stored here; `cv.js` fetches the same version
from jsDelivr. When upgrading, replace this file and change the version in
`COMPILER_WASM` (and `COMPILER_BYTES`) in `cv.js` together.
