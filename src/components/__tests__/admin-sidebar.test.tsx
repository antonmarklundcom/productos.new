import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminSidebar, type AdminNavItem } from "@/components/admin/sidebar";
import { StorefrontOnly } from "@/components/storefront-only";
import { t } from "@/i18n";

const route = vi.hoisted(() => ({ pathname: "/admin/productos/42" }));
vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("@/components/admin/logout-button", () => ({
  LogoutButton: () => <button>Salir</button>,
}));

const productLabel = t("panel.nav.productos");
const items: AdminNavItem[] = [
  { id: "resumen", href: "/admin", label: "Resumen" },
  {
    id: "pedidos",
    href: "/admin/pedidos",
    label: "Pedidos",
    testId: "admin-nav-orders",
  },
  { id: "productos", href: "/admin/productos", label: productLabel },
];
const key = "admin-menu-order:v1:1";
const links = () =>
  within(screen.getByRole("navigation"))
    .getAllByRole("link")
    .map((link) => link.textContent);

beforeEach(() => {
  localStorage.clear();
  route.pathname = "/admin/productos/42";
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AdminSidebar", () => {
  it("hides shopping chrome in admin and restores it on returning to the store", () => {
    const view = render(
      <StorefrontOnly>
        <span>Shopping navigation</span>
      </StorefrontOnly>
    );
    expect(screen.queryByText("Shopping navigation")).not.toBeInTheDocument();
    route.pathname = "/";
    view.rerender(
      <StorefrontOnly>
        <span>Shopping navigation</span>
      </StorefrontOnly>
    );
    expect(screen.getByText("Shopping navigation")).toBeVisible();
    route.pathname = "/admin/login";
    view.rerender(
      <StorefrontOnly>
        <span>Shopping navigation</span>
      </StorefrontOnly>
    );
    expect(screen.queryByText("Shopping navigation")).not.toBeInTheDocument();
  });
  it("reorders items by dragging without navigating away", () => {
    render(<AdminSidebar items={items} userId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar menú" }));
    const handle = screen.getByTitle(`Arrastrar ${productLabel}`);
    fireEvent.dragStart(handle, { dataTransfer: { setData: vi.fn() } });
    const first = screen.getByTitle("Arrastrar Resumen").closest("li");
    if (!first) throw new Error("Missing drop target");
    fireEvent.dragOver(first);
    fireEvent.drop(first);
    fireEvent.click(screen.getByRole("button", { name: "Guardar orden" }));
    expect(links()).toEqual([productLabel, "Resumen", "Pedidos"]);
  });
  it("highlights nested pages and keeps the orders navigation contract", () => {
    render(<AdminSidebar items={items} userId={1} />);
    expect(screen.getByRole("link", { name: productLabel })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(screen.getByRole("link", { name: "Resumen" })).not.toHaveAttribute(
      "aria-current"
    );
    expect(screen.getByTestId("admin-nav-orders")).toHaveAttribute(
      "href",
      "/admin/pedidos"
    );
  });

  it("saves a reordered menu across remounts, separately for each account", () => {
    const view = render(<AdminSidebar items={items} userId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar menú" }));
    expect(
      screen.getByRole("button", { name: "Subir Resumen" })
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Subir Pedidos" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar orden" }));
    expect(links()).toEqual(["Pedidos", "Resumen", productLabel]);
    view.unmount();
    const restored = render(<AdminSidebar items={items} userId={1} />);
    expect(links()).toEqual(["Pedidos", "Resumen", productLabel]);
    restored.unmount();
    render(<AdminSidebar items={items} userId={2} />);
    expect(links()).toEqual(["Resumen", "Pedidos", productLabel]);
  });

  it("cancels draft changes and only applies the default order when saved", () => {
    localStorage.setItem(
      key,
      JSON.stringify(["productos", "pedidos", "resumen"])
    );
    render(<AdminSidebar items={items} userId={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Editar menú" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Restaurar orden original" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(links()).toEqual([productLabel, "Pedidos", "Resumen"]);
    fireEvent.click(screen.getByRole("button", { name: "Editar menú" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Restaurar orden original" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Guardar orden" }));
    expect(links()).toEqual(["Resumen", "Pedidos", productLabel]);
  });

  it("ignores unauthorized, duplicate and stale IDs and appends new entries", () => {
    localStorage.setItem(
      key,
      JSON.stringify(["usuarios", "pedidos", "pedidos", "removed"])
    );
    render(<AdminSidebar items={items} userId={1} />);
    expect(links()).toEqual(["Pedidos", "Resumen", productLabel]);
    expect(
      screen.queryByRole("link", { name: "Usuarios" })
    ).not.toBeInTheDocument();
  });

  it("uses the default order if storage is malformed", () => {
    localStorage.setItem(key, "not-json");
    render(<AdminSidebar items={items} userId={1} />);
    expect(links()).toEqual(["Resumen", "Pedidos", productLabel]);
  });

  it("allows cancellation when browser storage cannot save", () => {
    render(<AdminSidebar items={items} userId={1} />);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    fireEvent.click(screen.getByRole("button", { name: "Editar menú" }));
    fireEvent.click(screen.getByRole("button", { name: "Subir Pedidos" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar orden" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "El navegador no permite guardar el orden"
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(links()).toEqual(["Resumen", "Pedidos", productLabel]);
  });
  it("keeps pending sections visible and routes them to their safe availability screen", () => {
    render(
      <AdminSidebar
        items={[
          ...items,
          {
            id: "ajustes",
            label: "Ajustes",
            href: "/admin/estado?seccion=ajustes",
            availabilityLabel: "Pendiente",
          },
        ]}
        userId={1}
      />
    );
    const link = screen.getByRole("link", { name: "Ajustes Pendiente" });
    expect(link).toHaveAttribute("href", "/admin/estado?seccion=ajustes");
    expect(
      screen.queryByRole("link", { name: "Usuarios" })
    ).not.toBeInTheDocument();
  });
});
