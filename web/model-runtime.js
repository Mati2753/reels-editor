export function localModelRuntime() {
  if (!self.ort) {
    const root = new URL("assets/portrait/", self.location.href).href;
    importScripts(root + "ort.wasm.min.js");
    self.ort.env.wasm.numThreads = 1;
    self.ort.env.wasm.wasmPaths = root;
  }
  return self.ort;
}
