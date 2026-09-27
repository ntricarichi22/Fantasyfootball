// Use the already-installed TypeScript compiler; emit no build files into the repo.
import fs from "node:fs";
import path from "node:path";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { fileURLToPath } from "node:url";
const load = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const resolved = request.startsWith("@/")
    ? path.join(__dirname, "../src", request.slice(2))
    : request;
  return originalResolve.call(this, resolved, parent, ...rest);
};
load.extensions[".ts"] = function (module, filename) {
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(source.outputText, filename);
};
load("../src/home/prototype/coaching.test.ts");
