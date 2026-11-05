import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Service role bypasses RLS. System tasks only (audit writes, retention, document pipeline) — CLAUDE.md rule 4.
// Never import this from public routes; ESLint enforces it for app/e/** and app/api/chat/public/**.
let client: SupabaseClient | undefined;

export function serviceClient(): SupabaseClient {
  client ??= createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
