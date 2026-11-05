// TESTING §3 scenarios 1–3, at 360 px with AI_MOCK=true.
import { expect, test, type Page } from "@playwright/test";

const SLUG = "festival-teknologi-fiktif";

// A fresh IP per test so the per-IP rate limit (10/min) never couples tests or repeated runs.
test.beforeEach(async ({ page }) => {
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
});

async function ask(page: Page, question: string) {
  await page.getByLabel("Pertanyaan").fill(question);
  await page.getByRole("button", { name: "Kirim" }).click();
}

const log = (page: Page) => page.getByRole("log", { name: "Percakapan" });

test("1. visitor asks the location and gets an answer with its source", async ({ page }) => {
  await page.goto(`/e/${SLUG}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /Festival Teknologi Fiktif 2026/i }),
  ).toBeVisible();
  await expect(page.getByText("Jangan ketik data pribadi.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Di mana lokasinya?" })).toBeVisible();

  const response = page.waitForResponse("**/api/chat/public");
  await ask(page, "Di mana lokasi acaranya?");
  const res = await response;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { answered: boolean; requestId: string };
  expect(body.answered).toBe(true);
  expect(res.headers()["x-request-id"]).toBe(body.requestId);

  await expect(log(page).getByText("Aula Utama Gedung C")).toBeVisible();
  await expect(log(page).getByText("SUMBER")).toBeVisible();
  await expect(log(page).getByText(/Guidebook Festival Teknologi Fiktif 2026/)).toBeVisible();

  // No horizontal scroll at 360 px.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("1b. a suggestion chip sends its question", async ({ page }) => {
  await page.goto(`/e/${SLUG}`);
  await page.getByRole("button", { name: "Di mana lokasinya?" }).click();
  await expect(log(page).getByText("Di mana lokasinya?")).toBeVisible();
  await expect(log(page).getByText("SUMBER")).toBeVisible();
});

test("2. visitor asks about the budget and is told it is not available, with the official contact", async ({
  page,
}) => {
  await page.goto(`/e/${SLUG}`);
  await ask(page, "Berapa anggaran acara ini?");
  await expect(log(page).getByText(/belum tersedia/)).toBeVisible();
  await expect(log(page).getByText(/@festekfiktif/)).toBeVisible();
  await expect(log(page)).not.toContainText("CANARY");
  await expect(log(page)).not.toContainText("SUMBER");
});

test("3. typing a phone number shows a warning before anything is sent", async ({ page }) => {
  let posts = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/chat/public") && r.method() === "POST") posts++;
  });
  await page.goto(`/e/${SLUG}`);
  await ask(page, "Tolong hubungi saya di 0812-0000-1234 ya");

  const warning = page.getByTestId("pii-warning");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("nomor HP");
  await expect(warning).not.toContainText("0812");
  expect(posts).toBe(0);

  await warning.getByRole("button", { name: "Hapus" }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByLabel("Pertanyaan")).toHaveValue("Tolong hubungi saya di ya");
  expect(posts).toBe(0);
});

test("3b. 'Kirim tetap' sends, and the server redacts the number", async ({ page }) => {
  await page.goto(`/e/${SLUG}`);
  await ask(page, "Parkir motor di mana? HP saya 0812-0000-1234");
  const response = page.waitForResponse("**/api/chat/public");
  await page.getByTestId("pii-warning").getByRole("button", { name: "Kirim tetap" }).click();
  expect((await response).status()).toBe(200);
  await expect(
    log(page)
      .getByText(/Parkir/)
      .last(),
  ).toBeVisible();
});

test("unknown event shows the not-found page", async ({ page }) => {
  const res = await page.goto("/e/acara-tidak-ada");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("Halaman tidak ditemukan")).toBeVisible();
});

test("home lists the three active events", async ({ page }) => {
  await page.goto("/");
  for (const name of [
    "Festival Teknologi Fiktif 2026",
    "Lomba Desain Poster Fiktif 2027",
    "Seminar Karier Fiktif 2026",
  ]) {
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
  }
});
