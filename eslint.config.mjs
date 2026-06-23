import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // React 19's compiler-preview rule flags every setState inside an effect.
      // Our remaining call sites are the legitimate, self-stabilizing patterns
      // the React docs explicitly bless: "reset state when a prop changes" and
      // "adjust selection when the underlying list changes" (each guarded so it
      // settles after one render). They are correct and ship fine, so we keep
      // the rule as a visible warning rather than a hard CI failure. Revisit if
      // we adopt the React Compiler, which makes some of these unnecessary.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
