export const validEnv: Record<string, string> = {
  APP_URL: "http://localhost:3000",
  APP_ENV: "development",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key-placeholder-0000000000",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-placeholder-000000000",
  GEMINI_API_KEY: "test-gemini-key",
  GEMINI_MODEL_REFINE: "test-refine-model",
  GEMINI_MODEL_CHAT: "test-chat-model",
  IP_HASH_SALT: "x".repeat(32),
  CRON_SECRET: "cron-secret-0000000",
  LOG_LEVEL: "debug",
  TURNSTILE_ENABLED: "false",
};
