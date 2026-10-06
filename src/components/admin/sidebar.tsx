"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  ChartNoAxesCombined,
  ChevronRight,
  FolderTree,
  GripVertical,
  History,
  Menu,
  Package,
  Pencil,
  Plug,
  RotateCcw,
  Settings,
  ShoppingBag,
  Star,
  Store,
  TicketPercent,
  Truck,
  UserRoundCog,
  Users,
} from "lucide-react";

import { LogoutButton } from "@/components/admin/logout-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

const icons = {
  resumen: ChartNoAxesCombined,
  pedidos: ShoppingBag,
  productos: Package,
  resenas: Star,
  devoluciones: RotateCcw,
  clientes: Users,
  cupones: TicketPercent,
  actividad: History,
  categorias: FolderTree,
  envios: Truck,
  banco: Banknote,
  ajustes: Settings,
  integraciones: Plug,
  usuarios: UserRoundCog,
};

export type AdminNavItem = {
  id: keyof typeof icons;
  href: string;
  label: string;
  testId?: string;
  badge?: number;
};

const preferenceEvent = "admin-menu-order-changed";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(preferenceEvent, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(preferenceEvent, onChange);
  };
}

/** Stored IDs can only reorder the navigation already authorized by the server. */
function orderItems(items: AdminNavItem[], stored: string | null) {
  try {
    const ids: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(ids)) return items;
    const remaining = new Map(items.map((item) => [item.id, item]));
    const ordered: AdminNavItem[] = [];
    for (const id of ids) {
      const item = remaining.get(id);
      if (!item) continue;
      ordered.push(item);
      remaining.delete(item.id);
    }
    return [...ordered, ...remaining.values()];
  } catch {
    return items;
  }
}

export function AdminSidebar({
  items,
  userId,
}: {
  items: AdminNavItem[];
  userId: number;
}) {
  const pathname = usePathname();
  const storageKey = `admin-menu-order:v1:${userId}`;
  const preference = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return localStorage.getItem(storageKey);
      } catch {
        return null;
      }
    },
    () => null
  );
  const saved = orderItems(items, preference);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [dragged, setDragged] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [message, setMessage] = useState("");
  const ordered = editing ? orderItems(items, JSON.stringify(draft)) : saved;

  function move(id: string, target: number) {
    const next = ordered.map((item) => item.id);
    const from = next.indexOf(id as AdminNavItem["id"]);
    if (from < 0 || target < 0 || target >= next.length) return;
    next.splice(target, 0, ...next.splice(from, 1));
    setDraft(next);
    setMessage(
      t("panel.menu.moved", {
        item: items.find((item) => item.id === id)?.label ?? "",
        n: target + 1,
      })
    );
  }

  function save() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify(ordered.map((item) => item.id))
      );
      window.dispatchEvent(new Event(preferenceEvent));
      setEditing(false);
      setMessage(t("panel.menu.saved"));
    } catch {
      setMessage(t("panel.menu.storageError"));
    }
  }

  function navigation() {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="border-border border-b px-4 py-4">
          <Link
            href={items[0]?.href ?? "/admin/pedidos"}
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-3 font-semibold tracking-tight"
          >
            <span className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl">
              <Store className="size-5" aria-hidden="true" />
            </span>
            {t("panel.titulo")}
          </Link>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t("panel.menu.navigation")}
            </span>
            {!editing && items.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraft(saved.map((item) => item.id));
                  setEditing(true);
                  setMessage("");
                }}
              >
                <Pencil aria-hidden="true" />
                {t("panel.menu.edit")}
              </Button>
            ) : null}
          </div>
          {editing ? (
            <p className="text-muted-foreground mb-3 px-1 text-xs">
              {t("panel.menu.help")}
            </p>
          ) : null}
          <nav aria-label={t("panel.menu.navigation")}>
            <ol className="space-y-1">
              {ordered.map((item, index) => {
                const Icon = icons[item.id];
                const active =
                  item.href === "/admin"
                    ? pathname === item.href
                    : pathname === item.href ||
                      pathname.startsWith(`${item.href}/`);
                const label = (
                  <>
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">
                      {item.label}
                    </span>
                    {item.badge ? (
                      <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-semibold">
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <li
                    key={item.id}
                    onDragOver={
                      editing ? (event) => event.preventDefault() : undefined
                    }
                    onDrop={
                      editing
                        ? (event) => {
                            event.preventDefault();
                            if (dragged) move(dragged, index);
                            setDragged(null);
                          }
                        : undefined
                    }
                    className={cn(
                      "rounded-lg",
                      dragged === item.id && "opacity-50"
                    )}
                  >
                    {editing ? (
                      <div className="bg-muted/50 flex items-center gap-2 rounded-lg px-2 py-2">
                        <span
                          draggable
                          onDragStart={(event) => {
                            setDragged(item.id);
                            event.dataTransfer.setData("text/plain", item.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDragged(null)}
                          title={t("panel.menu.drag", { item: item.label })}
                          className="text-muted-foreground cursor-grab"
                        >
                          <GripVertical className="size-4" aria-hidden="true" />
                        </span>
                        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                          {label}
                        </span>
                        <div className="flex shrink-0 gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={index === 0}
                            aria-label={t("panel.menu.up", {
                              item: item.label,
                            })}
                            onClick={() => move(item.id, index - 1)}
                          >
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            disabled={index === ordered.length - 1}
                            aria-label={t("panel.menu.down", {
                              item: item.label,
                            })}
                            onClick={() => move(item.id, index + 1)}
                          >
                            <ArrowDown
                              className="size-3.5"
                              aria-hidden="true"
                            />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Link
                        href={item.href}
                        data-testid={item.testId}
                        aria-current={active ? "page" : undefined}
                        aria-label={
                          item.id === "resenas" && item.badge
                            ? t("panel.nav.resenasPendientes", {
                                n: item.badge,
                              })
                            : undefined
                        }
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          "focus-visible:ring-ring flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors outline-none focus-visible:ring-2",
                          active
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {label}
                        {active ? (
                          <ChevronRight
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                        ) : null}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
          {editing ? (
            <div className="mt-4 space-y-2 border-t pt-3">
              <div className="flex gap-2">
                <Button size="sm" className="flex-1" onClick={save}>
                  {t("panel.menu.save")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(false);
                    setDragged(null);
                    setMessage("");
                  }}
                >
                  {t("panel.menu.cancel")}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => {
                  setDraft(items.map((item) => item.id));
                  setMessage(t("panel.menu.resetDraft"));
                }}
              >
                <RotateCcw aria-hidden="true" />
                {t("panel.menu.reset")}
              </Button>
              <p className="text-muted-foreground text-xs">
                {t("panel.menu.local")}
              </p>
            </div>
          ) : null}
          <p role="status" className="text-muted-foreground mt-2 text-xs">
            {message}
          </p>
        </div>
        <div className="border-border space-y-2 border-t p-3">
          <Link
            href="/"
            className="text-muted-foreground hover:bg-muted hover:text-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm"
          >
            <Store className="size-4" aria-hidden="true" />
            {t("panel.menu.store")}
          </Link>
          <LogoutButton />
        </div>
      </div>
    );
  }

  return (
    <>
      <aside
        className="border-border bg-background s9-no-print sticky top-0 hidden h-dvh border-r md:block"
        aria-label={t("panel.menu.navigation")}
      >
        {navigation()}
      </aside>
      <header className="border-border bg-background sticky top-0 z-20 flex items-center gap-3 border-b px-4 py-3 md:hidden">
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("panel.menu.open")}
            >
              <Menu aria-hidden="true" />
            </Button>
          </SheetTrigger>
          <SheetContent
            side="left"
            className="s9-no-print w-[min(20rem,90vw)] gap-0"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t("panel.titulo")}</SheetTitle>
              <SheetDescription>{t("panel.menu.navigation")}</SheetDescription>
            </SheetHeader>
            {navigation()}
          </SheetContent>
        </Sheet>
        <span className="font-semibold">
          {ordered.find(
            (item) =>
              item.href === pathname ||
              (item.href !== "/admin" && pathname.startsWith(`${item.href}/`))
          )?.label ?? t("panel.titulo")}
        </span>
      </header>
    </>
  );
}
