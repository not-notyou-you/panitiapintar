// Runs once when the server boots: fail fast on incomplete env (ARCHITECTURE §6).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { env } = await import("./lib/env");
    env();
  }
}
