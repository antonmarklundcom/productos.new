import { describe, it, expect } from "vitest";
import { ROBOTS_TXT } from "../../workers/d1/robots-response.mjs";
import robots from "@/app/robots";

describe("worker robots.txt constant", () => {
  it("keeps every rule of src/app/robots.ts", () => {
    const rules = robots().rules as { disallow: string[] };
    for (const rule of rules.disallow) expect(ROBOTS_TXT).toContain(`Disallow: ${rule}\n`);
    expect(ROBOTS_TXT).toContain("Allow: /\n");
  });
});
