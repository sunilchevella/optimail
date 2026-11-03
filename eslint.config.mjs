import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: { '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }] },
  },
  // The generic record layer works across every table, so it uses loose types on purpose.
  {
    files: ['lib/resources.ts', 'lib/records.ts', 'components/**', 'app/(app)/r/**', 'scripts/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
