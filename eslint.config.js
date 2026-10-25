// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "coverage/", "build/", "node_modules/"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { console: "readonly", process: "readonly", Buffer: "readonly", URL: "readonly" },
    },
    rules: {
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: { require: "readonly", module: "writable" } },
  },
  {
    files: ["test/**", "smoke/**", "scripts/**"],
    rules: { "no-console": "off", "@typescript-eslint/no-non-null-assertion": "off", "@typescript-eslint/no-require-imports": "off" },
  },
);
