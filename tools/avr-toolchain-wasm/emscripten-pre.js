// Linked into every tool with `--pre-js` (runs inside the module factory, before
// the generated runtime reads Module.thisProgram).
//
// Emscripten < 4.x always defaulted argv[0] ("thisProgram") to "./this.program";
// Emscripten 6.x defaults it to process.argv[1] under Node. GCC and binutils
// derive their diagnostic prefix ("cc1plus: error: ...") and, for ld, the
// linker-script search directory from argv[0]. Pin the old default so that a
// tool behaves the same in Node and in a Web Worker and prints the same stderr
// as the @horang-corp/avr-gcc-wasm 0.2.0 binaries it replaces. Callers can still
// override it by passing { thisProgram: "..." } to the factory.
if (!Module['thisProgram']) Module['thisProgram'] = './this.program';
