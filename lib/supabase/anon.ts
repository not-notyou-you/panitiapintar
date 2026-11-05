import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env.public";

// Anonymous, sessionless client for public pages and the public chat route: RLS applies as `anon`.
let client: SupabaseClient | undefined;

export function anonClient(): SupabaseClient {
  client ??= createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
