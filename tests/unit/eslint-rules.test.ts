// ROADMAP 0.6: lint must fail when security rules are broken.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

async function ruleIds(code: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? []).map((m) => m.ruleId ?? "fatal");
}

const PUBLIC_PATHS = ["app/e/[slug]/page.tsx", "app/api/chat/public/route.ts"];

describe("security lint rules", () => {
  it("rejects console.log anywhere", async () => {
    expect(await ruleIds(`console.log("x");\n`, "lib/foo.ts")).toContain("no-console");
  });

  it("rejects dangerouslySetInnerHTML in JSX", async () => {
    const code = `export function A({ h }: { h: string }) {\n  return <div dangerouslySetInnerHTML={{ __html: h }} />;\n}\n`;
    const ids = await ruleIds(code, "components/ui/A.tsx");
    expect(ids).toContain("react/no-danger");
    expect(ids).toContain("no-restricted-syntax");
  });

  it("rejects dangerouslySetInnerHTML passed as an object prop", async () => {
    const code = `export const props = { dangerouslySetInnerHTML: { __html: "x" } };\n`;
    expect(await ruleIds(code, "components/ui/B.tsx")).toContain("no-restricted-syntax");
  });

  it.each(PUBLIC_PATHS)("rejects the service client import in %s", async (file) => {
    for (const spec of ["@/lib/supabase/service", "../../../lib/supabase/service"]) {
      const code = `import { serviceClient } from "${spec}";\nexport const c = serviceClient;\n`;
      expect(await ruleIds(code, file), spec).toContain("no-restricted-imports");
    }
  });

  it.each(PUBLIC_PATHS)("rejects building a raw Supabase client in %s", async (file) => {
    const code = `import { createClient } from "@supabase/supabase-js";\nexport const c = createClient;\n`;
    expect(await ruleIds(code, file)).toContain("no-restricted-imports");
  });

  it.each(PUBLIC_PATHS)("rejects reading the service role key in %s", async (file) => {
    const code = `export const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`;
    expect(await ruleIds(code, file)).toContain("no-restricted-syntax");
  });

  it("still allows the service client in system code", async () => {
    const code = `import { serviceClient } from "@/lib/supabase/service";\nexport const c = serviceClient;\n`;
    expect(await ruleIds(code, "app/api/cron/retention/route.ts")).not.toContain("no-restricted-imports");
  });
});
