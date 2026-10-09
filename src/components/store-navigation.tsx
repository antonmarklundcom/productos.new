"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n/client";

type Category = { slug: string; name: string };
export type NavigationLink = { href: string; label: string };
type NavigationProps = {
  categories: readonly Category[];
  links: NavigationLink[];
};

function CategoryLinks({
  categories,
  onNavigate,
}: {
  categories: readonly Category[];
  onNavigate?: () => void;
}) {
  return categories.map((category) => (
    <Link
      key={category.slug}
      href={`/categoria/${category.slug}`}
      data-testid={TESTIDS.headerCategoryLink}
      data-slug={category.slug}
      onClick={onNavigate}
      className="hover:bg-muted focus-visible:ring-ring flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-3 text-sm leading-snug break-words focus-visible:ring-2 focus-visible:outline-none"
    >
      <span>{category.name}</span>
      <ChevronRight size={16} className="shrink-0 opacity-50" aria-hidden />
    </Link>
  ));
}

export function DesktopStoreNavigation({ categories, links }: NavigationProps) {
  const details = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    if (details.current) details.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node))
        details.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <nav
      aria-label="Navegación principal"
      className="border-border hidden border-t lg:block"
    >
      <div className="store-width flex min-w-0 items-center gap-2 py-2">
        <details
          ref={details}
          className="group relative shrink-0"
          onKeyDown={(event) => {
            if (event.key === "Escape" && details.current?.open) {
              details.current.open = false;
              details.current.querySelector("summary")?.focus();
            }
          }}
        >
          <summary
            data-testid={TESTIDS.headerCategoriesTrigger}
            className="bg-primary text-primary-foreground flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg px-5 text-sm font-semibold [&::-webkit-details-marker]:hidden"
          >
            <Menu size={18} aria-hidden /> {t("header.categorias")}
            <ChevronDown
              size={16}
              className="transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="bg-background border-border absolute top-full left-0 mt-2 grid w-[min(42rem,calc(100vw-3rem))] grid-cols-2 gap-1 rounded-xl border p-3 shadow-xl xl:grid-cols-3">
            <CategoryLinks
              categories={categories}
              onNavigate={() => {
                if (details.current) details.current.open = false;
              }}
            />
          </div>
        </details>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            aria-current={pathname === link.href ? "page" : undefined}
            className="hover:bg-muted aria-[current=page]:text-primary rounded-lg px-4 py-3 text-sm font-medium whitespace-nowrap"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

export function MobileStoreMenu({
  categories,
  links,
  account,
}: NavigationProps & { account: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          data-testid={TESTIDS.headerMenuTrigger}
          aria-label="Abrir menú"
          className="border-border hover:bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg border lg:hidden"
        >
          <Menu size={22} aria-hidden />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content className="bg-background fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(100%,24rem)] max-w-full flex-col border-l shadow-xl">
          <div className="border-border flex shrink-0 items-center justify-between border-b p-5">
            <Dialog.Title className="text-lg font-semibold">Menú</Dialog.Title>
            <Dialog.Description className="sr-only">
              Categorías y enlaces de la tienda
            </Dialog.Description>
            <Dialog.Close
              aria-label="Cerrar menú"
              className="hover:bg-muted flex size-11 items-center justify-center rounded-lg"
            >
              <X size={22} aria-hidden />
            </Dialog.Close>
          </div>
          <nav
            aria-label="Navegación móvil"
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
          >
            <p className="text-muted-foreground px-3 pt-2 pb-3 text-xs font-semibold tracking-wider uppercase">
              Explorá las categorías
            </p>
            <CategoryLinks
              categories={categories}
              onNavigate={() => setOpen(false)}
            />
            <div className="border-border mt-4 border-t pt-4">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="hover:bg-muted flex min-h-12 items-center rounded-lg px-3 py-3 text-sm font-medium"
                >
                  {link.label}
                </Link>
              ))}
              <Link
                href="/pedido/buscar"
                onClick={() => setOpen(false)}
                className="hover:bg-muted flex min-h-12 items-center rounded-lg px-3 py-3 text-sm font-medium"
              >
                Seguí tu pedido
              </Link>
              <div className="px-3 py-3" onClick={() => setOpen(false)}>
                {account}
              </div>
            </div>
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
