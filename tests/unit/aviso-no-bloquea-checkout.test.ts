import { describe, expect, it } from "vitest";
import { readCode, stripComments } from "../helpers/source";
describe("external sends do not block order transactions", () => {
  it("checkout and order transactions contain no external sender call", async () => {
    for (const file of [
      "src/app/actions/checkout.ts",
      "src/domain/create-order.ts",
      "src/domain/orders.ts",
    ]) {
      const code = stripComments(await readCode(file));
      expect(code).not.toMatch(/sender\.send\s*\(/);
      expect(code).not.toMatch(
        /notify(?:OwnerNewOrder|CustomerOrderEvent)\s*\(/
      );
    }
  });
});
