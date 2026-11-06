// Seed accounts (supabase/seed.sql, all fictional @contoh.test). Shared by scripts/build-seed.ts and the
// login page, which lists them only when APP_ENV !== "production". The password is for the local seed
// only; a real deployment never runs seed.sql.
export const TEST_PASSWORD = "panitia-uji-2026";

export const TEST_ACCOUNTS = [
  { email: "superadmin@contoh.test", role: "Super admin", note: "semua acara + log" },
  { email: "admin.festek@contoh.test", role: "Admin", note: "Festival Teknologi Fiktif" },
  { email: "admin.lomba@contoh.test", role: "Admin", note: "Lomba Desain Poster Fiktif" },
  { email: "admin.seminar@contoh.test", role: "Admin", note: "Seminar Karier Fiktif" },
  { email: "anggota.festek@contoh.test", role: "Anggota", note: "Festival Teknologi Fiktif" },
] as const;
