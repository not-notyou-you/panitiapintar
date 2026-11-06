// TESTING §3 scenarios 4–7 (AI_MOCK=true, local Supabase with seed, email + password login).
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { TEST_PASSWORD } from "../../lib/auth/test-accounts";
import { DOCX_MIME, makeDocx } from "../helpers/files";

const SLUG = "festival-teknologi-fiktif";
const OTHER_SLUG = "lomba-desain-fiktif";

function localEnv(key: string): string {
  if (process.env[key]) return process.env[key] as string;
  const text = readFileSync(path.resolve(__dirname, "../../.env.local"), "utf8");
  return text.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim() ?? "";
}

async function committeeId(slug: string): Promise<string> {
  const url = localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = localEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const res = await fetch(`${url}/rest/v1/committees?slug=eq.${slug}&select=id`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const rows = (await res.json()) as { id: string }[];
  if (!rows[0]) throw new Error(`committee ${slug} missing: run npx supabase db reset`);
  return rows[0].id;
}

// Login is rate limited per email (SEC-07, 5/hour); repeated local runs would exhaust it. Test hygiene only.
test.beforeAll(async () => {
  const url = localEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = localEnv("SUPABASE_SERVICE_ROLE_KEY");
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  await fetch(`${url}/rest/v1/rate_limits?bucket=like.login:*`, { method: "DELETE", headers });
  // Documents left by earlier runs of scenario 4 would fill the 10-document quota of the seed event.
  await fetch(`${url}/rest/v1/documents?title=like.Info%20Booth%20Zetaprima*`, { method: "DELETE", headers });
});

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-forwarded-for": `10.7.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
  });
});

/** Signs in through the login form with the seed password. */
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email panitia").fill(email);
  await page.getByLabel("Kata sandi").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: "Masuk", exact: true }).click();
  await expect(page).toHaveURL(/\/(panitia|admin)/);
}

test("0. tanpa sesi, /admin dan /panitia dialihkan ke /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin/);
  await page.goto("/panitia");
  await expect(page).toHaveURL(/\/login/);
});

test("4. admin unggah DOCX → dirapikan → tinjau → edit → setujui → publik → terjawab di /e/<slug>", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const id = await committeeId(SLUG);
  const marker = `Zetaprima${Date.now().toString(36)}`;
  await login(page, "admin.festek@contoh.test");

  await page.goto(`/admin/${id}?tab=dokumen`);
  const title = `Info Booth ${marker}`;
  await page.getByLabel("Judul dokumen").fill(title);
  await page.getByLabel(/^File/).setInputFiles({
    name: "booth.docx",
    mimeType: DOCX_MIME,
    buffer: Buffer.from(
      makeDocx([
        `Booth ${marker} berada di lantai 3 Gedung C dekat lift.`,
        "Hubungi panitia di 0812-0000-4321.",
      ]),
    ),
  });
  await page.getByRole("button", { name: "+ Unggah dokumen" }).click();
  await expect(page.getByRole("status")).toContainText("Disensor otomatis: 1 nomor HP");

  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row.getByText(/Sedang dirapikan|Perlu ditinjau/)).toBeVisible();
  await expect(row.getByText("Perlu ditinjau")).toBeVisible({ timeout: 30_000 });
  await row.getByRole("link", { name: "Tinjau" }).click();

  // 360 px: the two panes become tabs "Asli" / "Hasil AI" (INTERFACE §4.7).
  await page.getByRole("tab", { name: "Asli" }).click();
  await expect(page.getByText("Teks asli (sudah diredaksi)")).toBeVisible();
  await expect(page.getByText("Disensor otomatis: 1 nomor HP")).toBeVisible();
  await page.getByRole("tab", { name: "Hasil AI" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  const editor = page.getByLabel("Isi Markdown hasil perapihan");
  await expect(editor).toHaveValue(/\[NOMOR_HP\]/);
  await editor.fill(`# ${title}\n\n## Lokasi\n\nBooth ${marker} berada di lantai 3 Gedung C dekat lift.`);
  await page.getByRole("button", { name: "Setujui" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Setujui" }).click();

  await expect(page).toHaveURL(new RegExp(`/admin/${id}\\?tab=dokumen`));
  const approvedRow = page.getByRole("row", { name: new RegExp(title) });
  await expect(approvedRow.getByText("Disetujui")).toBeVisible();
  await approvedRow.getByLabel(`Visibilitas ${title}`).selectOption("public");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("akan bisa dibaca chatbot publik");
  await dialog.getByRole("button", { name: "Jadikan Publik" }).click();
  await expect(approvedRow.getByLabel(`Visibilitas ${title}`)).toHaveValue("public");

  // Straight away answerable on the public page.
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.8.${Math.floor(Math.random() * 250)}.1` });
  await page.goto(`/e/${SLUG}`);
  await page.getByLabel("Pertanyaan").fill(`Di mana booth ${marker}?`);
  await page.getByRole("button", { name: "Kirim" }).click();
  const chat = page.getByRole("log", { name: "Percakapan" });
  await expect(chat.getByText(/lantai 3 Gedung C/)).toBeVisible();
  await expect(chat.getByText(new RegExp(`Info Booth ${marker}`))).toBeVisible();
});

test("5. anggota acara A membuka halaman acara B → bukan anggota", async ({ page }) => {
  const other = await committeeId(OTHER_SLUG);
  await login(page, "anggota.festek@contoh.test");
  await page.goto(`/admin/${other}`);
  await expect(page.getByText("Kamu bukan anggota kepanitiaan ini.")).toBeVisible();
  await page.goto(`/admin/${other}/documents/00000000-0000-4000-8000-000000000000/review`);
  await expect(page.getByText("Kamu bukan anggota kepanitiaan ini.")).toBeVisible();
  const qr = await page.request.get(`/api/qr/${OTHER_SLUG}`);
  expect(qr.status()).toBe(403);
  await page.goto(`/panitia/${other}`);
  await expect(page.getByText("Kamu bukan anggota kepanitiaan ini.")).toBeVisible();
});

test("6. panitia membuat rundown → tabel tampil → tombol Salin", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const id = await committeeId(SLUG);
  await login(page, "anggota.festek@contoh.test");
  await page.goto(`/panitia/${id}?tab=rundown`);
  // next dev compiles client chunks on first visit; filling before that settles gets reset by Fast Refresh.
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

  await page.getByLabel("Tanggal acara").fill("2026-12-05");
  await page.getByLabel("Mulai").fill("09:00");
  await page.getByLabel("Selesai").fill("12:00");
  await page.getByLabel("Isi acara").fill("Seminar, lomba UI/UX, awarding");
  await page.getByRole("button", { name: "Buat draf rundown" }).click();
  const table = page.getByRole("table", { name: "Draf rundown" });
  await expect(table.getByRole("cell", { name: "Seminar" })).toBeVisible();
  await expect(table.getByRole("cell", { name: "awarding" })).toBeVisible();
  await expect(page.getByText("DRAF AI · periksa sebelum dipakai")).toBeVisible();
  await page.getByRole("button", { name: "Salin" }).click();
  await expect(page.getByRole("button", { name: "Tersalin" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("Waktu\tDurasi (menit)\tKegiatan\tPIC divisi");
  expect(copied).toContain("Seminar");

  // Internal chat on the same workspace: internal answer carries the INTERNAL label.
  await page.goto(`/panitia/${id}?tab=tanya`);
  await page.getByLabel("Pertanyaan").fill("Berapa total anggaran konsumsi?");
  await page.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByText("INTERNAL · jangan dibagikan ke publik")).toBeVisible();
});

test("7. super admin membuka /admin/logs → aksi approve terlihat dengan requestId", async ({ page }) => {
  const id = await committeeId(SLUG);
  await login(page, "superadmin@contoh.test");
  await page.goto(`/admin/logs?tab=audit&range=1&committee=${id}&action=document.approve`);
  await page.waitForLoadState("networkidle");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  const row = page.getByRole("row", { name: /document\.approve/ }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText("SUCCESS")).toBeVisible();
  await expect(row.getByText(/^req_/)).toBeVisible();
  await row.getByRole("link", { name: "document.approve" }).click();
  const detail = page.getByRole("complementary", { name: "Detail catatan" });
  await expect(detail.getByText(/^req_[0-9A-Z]{26}$/)).toBeVisible();
  await expect(detail).toContainText('"edited"');

  await page.getByRole("link", { name: "AI", exact: true }).click();
  await expect(page.getByText("Panggilan hari ini")).toBeVisible();
  await expect(page.getByRole("img", { name: /Grafik batang panggilan AI per jam/ })).toBeVisible();
  const csv = await page.request.get(`/api/admin/logs/export?tab=audit&range=1&committee=${id}`);
  expect(csv.status()).toBe(200);
  expect(await csv.text()).toContain("document.approve");
});
