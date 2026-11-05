import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const noDangerousHtml = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: "dangerouslySetInnerHTML is forbidden (SEC-09). Render text or restricted Markdown.",
  },
  {
    selector: "Property[key.name='dangerouslySetInnerHTML']",
    message: "dangerouslySetInnerHTML is forbidden (SEC-09). Render text or restricted Markdown.",
  },
];

const config = [
  { ignores: [".next/**", ".next-e2e/**", ".next-eval/**", "test-results/**", "playwright-report/**", "node_modules/**", "panitiapintar-docs/**", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
      // Use lib/log/logger.ts (CLAUDE.md "Aturan logging").
      "no-console": "error",
      "react/no-danger": "error",
      "no-restricted-syntax": ["error", ...noDangerousHtml],
    },
  },
  {
    // SEC-01: public paths never touch the service role, directly or by building their own client.
    files: ["app/e/**", "app/api/chat/public/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@supabase/supabase-js",
              message: "Public paths must not create Supabase clients; read via public_context() only.",
            },
          ],
          patterns: [
            {
              group: ["**/supabase/service", "**/supabase/service.ts", "@/lib/supabase/service"],
              message: "Service role client is forbidden in public paths (SEC-01).",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        ...noDangerousHtml,
        {
          selector: "MemberExpression[property.name='SUPABASE_SERVICE_ROLE_KEY']",
          message: "Service role key is forbidden in public paths (SEC-01).",
        },
      ],
    },
  },
  {
    // SEC-01: the public context loader must stay on the anon client so the DB decides visibility.
    files: ["lib/context/public.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/supabase/service", "**/supabase/service.ts", "@/lib/supabase/service"],
              message: "Public context must read via the anon client and public_context() only (SEC-01).",
            },
          ],
        },
      ],
    },
  },
];

export default config;
