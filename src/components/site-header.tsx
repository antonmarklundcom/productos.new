import { Suspense } from "react";
import { catalogOnly } from "@/config/catalog-capabilities";
import Link from "next/link";
import Image from "next/image";
import { PackageCheck } from "lucide-react";
import { CartButton } from "@/components/cart-button";
import { CuentaHeaderEntry } from "@/components/cuenta/header-entry";
import { SearchBox } from "@/components/search-box";
import { WishlistHeaderLink } from "@/components/wishlist-header-link";
import { storeCategories } from "@/components/store-categories";
import { marcaEfectiva } from "@/lib/marca";
import { paginasActivas } from "@/lib/paginas";
import {
  DesktopStoreNavigation,
  MobileStoreMenu,
  type NavigationLink,
} from "@/components/store-navigation";

export async function SiteHeader() {
  const [categories, marca, pages] = await Promise.all([
    storeCategories(),
    marcaEfectiva(),
    paginasActivas(),
  ]);
  const links: NavigationLink[] = [
    { href: "/", label: "Inicio" },
    ...pages
      .filter(
        (page) => page.slug === "envios" || page.slug === "preguntas-frecuentes"
      )
      .map((page) => ({
        href: `/${page.slug}`,
        label: page.slug === "envios" ? "Envíos" : "Preguntas frecuentes",
      })),
    { href: "/contacto", label: "Contacto" },
  ];
  return (
    <header className="store-header bg-background sticky top-0 z-30">
      <div className="store-topline">
        <div className="store-width flex items-center justify-between gap-4">
          <span>Un lugar para encontrar lo que necesitás.</span>
          {!catalogOnly ? <Link href="/pedido/buscar" className="flex items-center gap-2">
            <PackageCheck size={14} aria-hidden />
            Seguí tu pedido
          </Link> : null}
        </div>
      </div>
      <div className="store-width flex min-w-0 items-center gap-2 py-4 sm:gap-5 lg:gap-12">
        <Link
          href="/"
          className="brand-link flex min-w-0 items-center gap-1.5 sm:gap-2.5"
          aria-label={`${marca.nombre} — Inicio`}
        >
          {marca.logoUrl ? (
            <Image
              src={marca.logoUrl}
              width={160}
              height={40}
              alt={marca.nombre}
              unoptimized
              className="h-8 w-auto max-w-32 object-contain sm:h-10 sm:max-w-40"
            />
          ) : (
            <>
              <Image
                src="/brand/mark.svg"
                width={40}
                height={40}
                alt=""
                className="size-7 shrink-0 sm:size-10"
              />
              <span className="truncate text-lg font-bold tracking-[-0.06em] sm:text-3xl">
                {marca.nombre}
                <span className="brand-dot">.</span>
              </span>
            </>
          )}
        </Link>
        <Suspense fallback={null}>
          <SearchBox className="store-search hidden flex-1 md:block" />
        </Suspense>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-4">
          {!catalogOnly ? <div className="hidden lg:block">
            <Suspense fallback={null}>
              <CuentaHeaderEntry />
            </Suspense>
          </div> : null}
          {!catalogOnly ? <WishlistHeaderLink /> : null}
          {!catalogOnly ? <CartButton /> : null}
          <MobileStoreMenu
            categories={categories}
            links={links}
            showOrderTracking={!catalogOnly}
            account={!catalogOnly ?
              <Suspense fallback={null}>
                <CuentaHeaderEntry />
              </Suspense> : null
            }
          />
        </div>
      </div>
      <div className="store-width pb-3 md:hidden">
        <Suspense fallback={null}>
          <SearchBox className="store-search" />
        </Suspense>
      </div>
      <DesktopStoreNavigation categories={categories} links={links} />
    </header>
  );
}
