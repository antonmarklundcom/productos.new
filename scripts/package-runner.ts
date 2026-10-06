import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";

/** pnpm supplies its JS entry point; executing it with Node also works on Windows. */
export function runPnpm(
  args: string[],
  options: ExecFileSyncOptions = {}
): void {
  const entry = process.env.npm_execpath;
  if (
    entry &&
    /pnpm.*\.(?:[cm]?js)$/i.test(basename(entry)) &&
    existsSync(entry)
  ) {
    execFileSync(process.execPath, [entry, ...args], options);
  } else if (process.platform !== "win32") {
    execFileSync("pnpm", args, options);
  } else {
    throw new Error(
      "Run this script through pnpm so npm_execpath identifies its JavaScript entry point."
    );
  }
}
