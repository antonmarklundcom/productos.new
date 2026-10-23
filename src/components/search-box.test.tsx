import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const nav = vi.hoisted(() => ({ query: "q=alpha", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }), useSearchParams: () => new URLSearchParams(nav.query) }));
vi.mock("@/app/actions/search-suggest", () => ({ sugerirProductos: async () => [] }));
import { SearchBox } from "./search-box";
beforeEach(() => { nav.query = "q=alpha"; nav.push.mockReset(); });
it("shares responsive typing and follows committed history/client queries", () => {
  const view = render(<><SearchBox /><SearchBox /></>);
  const inputs = () => screen.getAllByRole("combobox") as HTMLInputElement[];
  fireEvent.change(inputs()[0]!, { target: { value: "unfinished" } });
  expect(inputs().map(input => input.value)).toEqual(["unfinished", "unfinished"]);
  view.rerender(<><SearchBox /><SearchBox /></>);
  expect(inputs()[0]!.value).toBe("unfinished");
  for (const query of ["q=beta", "q=alpha", "q=beta"]) {
    nav.query = query;
    view.rerender(<><SearchBox /><SearchBox /></>);
    expect(inputs().map(input => input.value)).toEqual([new URLSearchParams(query).get("q"), new URLSearchParams(query).get("q")]);
  }
  fireEvent.submit(inputs()[1]!.closest("form")!);
  expect(nav.push).toHaveBeenCalledWith("/buscar?q=beta");
});
