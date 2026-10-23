import { expect, it } from "vitest";
import { mayFocusRoute } from "../../workers/d1/navigation-focus";
it("focus requires an initiated path change with no newly used control or modal", () => {
  const link = { tagName: "A" } as Element, input = { tagName: "INPUT" } as Element;
  const base = { initiated: true, changedPath: true, source: link, active: link, modalOpen: false };
  expect(mayFocusRoute(base)).toBe(true);
  for (const override of [{ initiated: false }, { changedPath: false }, { active: input }, { modalOpen: true }]) expect(mayFocusRoute({ ...base, ...override })).toBe(false);
  expect(mayFocusRoute({ ...base, active: { tagName: "BODY" } as Element })).toBe(true);
});
