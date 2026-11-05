import { Writable } from "node:stream";
import { createLogger } from "@/lib/log/create-logger";

/** Logger writing to memory; returns the logger and every emitted line. */
export function captureLogger(level: "debug" | "info" = "debug") {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(...String(chunk).split("\n").filter(Boolean));
      cb();
    },
  });
  const log = createLogger({ level, env: "test", destination });
  return { log, lines, output: () => lines.join("\n"), json: () => lines.map((l) => JSON.parse(l)) };
}
