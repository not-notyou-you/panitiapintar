import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env.public";

/** Supabase client bound to the signed-in user's JWT, so RLS applies. */
export async function serverClient() {
  const store = await cookies();
  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component where cookies are read-only; middleware refreshes the session.
        }
      },
    },
  });
}
