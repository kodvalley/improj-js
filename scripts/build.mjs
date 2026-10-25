// Builds dist/esm (ES modules) and dist/cjs (CommonJS), each with its own
// type declarations, using only the TypeScript compiler.
//
// The CommonJS build compiles a copy of src/ inside a folder whose
// package.json says "type": "commonjs", so the same NodeNext settings emit
// CommonJS there; dist/cjs/package.json marks the output the same way.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const run = (args) => execFileSync(process.execPath, [tsc, ...args], { cwd: root, stdio: "inherit" });

rmSync(join(root, "dist"), { recursive: true, force: true });

// ES modules.
run(["-p", "tsconfig.build.json"]);

// CommonJS.
const tmp = join(root, "build", "cjs");
rmSync(join(root, "build"), { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
cpSync(join(root, "src"), join(tmp, "src"), { recursive: true });
writeFileSync(join(tmp, "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
writeFileSync(
  join(tmp, "tsconfig.json"),
  JSON.stringify(
    {
      extends: "../../tsconfig.build.json",
      compilerOptions: { rootDir: "src", outDir: "../../dist/cjs", sourceMap: false, declarationMap: false },
      include: ["src"],
    },
    null,
    2,
  ),
);
run(["-p", join("build", "cjs", "tsconfig.json")]);
writeFileSync(join(root, "dist", "cjs", "package.json"), JSON.stringify({ type: "commonjs" }) + "\n");
rmSync(join(root, "build"), { recursive: true, force: true });
console.log("Built dist/esm and dist/cjs");
