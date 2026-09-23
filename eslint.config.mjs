import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  // Type safety is enforced by `npm run typecheck`; this intentionally lean
  // foundation config leaves room for the UI run to add project-specific rules.
  globalIgnores([".next/**", "node_modules/**", "out/**"]),
]);
