import {
  fireEvent,
  render,
  screen,
  cleanup,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopStoreNavigation, MobileStoreMenu } from "./store-navigation";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("next/link", () => ({
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
afterEach(cleanup);
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});
const categories = [
  { slug: "autos-y-motos", name: "Autos y motos" },
  { slug: "tecnologia-y-accesorios", name: "Tecnología y accesorios" },
  { slug: "bebes-y-maternidad", name: "Bebés y maternidad" },
];
const links = [
  { href: "/", label: "Inicio" },
  { href: "/contacto", label: "Contacto" },
];

describe("store navigation", () => {
  it("shows supplied category URLs and page links; closes the desktop panel on Escape and outside click", () => {
    render(<DesktopStoreNavigation categories={categories} links={links} />);
    const trigger = screen.getByTestId("header-categories-trigger");
    const panel = trigger.closest("details")!;
    panel.open = true;
    expect(screen.getByRole("link", { name: "Autos y motos" })).toHaveAttribute(
      "href",
      "/categoria/autos-y-motos"
    );
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(panel.open).toBe(false);
    expect(trigger).toHaveFocus();
    panel.open = true;
    fireEvent.pointerDown(document.body);
    expect(panel.open).toBe(false);
    expect(screen.getByRole("link", { name: "Contacto" })).toHaveAttribute(
      "href",
      "/contacto"
    );
  });
  it("opens a labelled mobile dialog with all supplied categories and closes after navigation", () => {
    render(
      <MobileStoreMenu
        categories={categories}
        links={links}
        account={<a href="/cuenta">Mi cuenta</a>}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialog = screen.getByRole("dialog", { name: "Menú" });
    expect(within(dialog).getAllByTestId("header-category-link")).toHaveLength(
      3
    );
    expect(
      within(dialog).getByRole("link", { name: "Mi cuenta" })
    ).toHaveAttribute("href", "/cuenta");
    fireEvent.click(
      within(dialog).getByRole("link", { name: "Autos y motos" })
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("closes the mobile dialog with its accessible close button", () => {
    render(
      <MobileStoreMenu categories={categories} links={links} account={null} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar menú" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
