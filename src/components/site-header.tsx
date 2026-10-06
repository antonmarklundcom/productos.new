import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, PackageCheck } from "lucide-react";
import { CartButton } from "@/components/cart-button";
import { CuentaHeaderEntry } from "@/components/cuenta/header-entry";
import { SearchBox } from "@/components/search-box";
import { WishlistHeaderLink } from "@/components/wishlist-header-link";
import { storeCategories } from "@/components/store-categories";
import { marcaEfectiva } from "@/lib/marca";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n/client";

export async function SiteHeader() {
  const [categories, marca] = await Promise.all([
    storeCategories(),
    marcaEfectiva(),
  ]);
  return (
    <header className="store-header bg-background sticky top-0 z-30">
      <div className="store-topline">
        <div className="store-width flex items-center justify-between gap-4">
          <span>Un lugar para encontrar lo que necesitás.</span>
          <Link href="/pedido/buscar" className="flex items-center gap-2">
            <PackageCheck size={14} aria-hidden />
            Seguí tu pedido
          </Link>
        </div>
      </div>
      <div className="store-width flex items-center gap-5 py-4 lg:gap-12">
        <Link
          href="/"
          className="brand-link flex shrink-0 items-center gap-2.5"
          aria-label={`${marca.nombre} — Inicio`}
        >
          {marca.logoUrl ? (
            <Image
              src={marca.logoUrl}
              width={160}
              height={40}
              alt={marca.nombre}
              unoptimized
              className="h-10 w-auto"
            />
          ) : (
            <>
              <Image src="/brand/mark.svg" width={40} height={40} alt="" />
              <span className="text-2xl font-bold tracking-[-0.06em] sm:text-3xl">
                {marca.nombre}
                <span className="brand-dot">.</span>
              </span>
            </>
          )}
        </Link>
        <Suspense fallback={null}>
          <SearchBox className="store-search hidden flex-1 md:block" />
        </Suspense>
        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <Suspense fallback={null}>
            <CuentaHeaderEntry />
          </Suspense>
          <WishlistHeaderLink />
          <CartButton />
        </div>
      </div>
      <div className="store-width pb-3 md:hidden">
        <Suspense fallback={null}>
          <SearchBox className="store-search" />
        </Suspense>
      </div>
      <nav
        aria-label={t("header.categorias")}
        className="border-border border-t"
      >
        <div className="store-width category-nav flex items-center gap-6 overflow-x-auto py-3 text-xs font-medium lg:justify-between lg:text-sm">
          {categories.map((category) => (
            <Link
              key={category.slug}
              href={`/categoria/${category.slug}`}
              data-testid={TESTIDS.headerCategoryLink}
              data-slug={category.slug}
              className="hover:text-primary shrink-0 whitespace-nowrap transition-colors"
            >
              {category.name}
            </Link>
          ))}
          <Link
            href="/contacto"
            className="border-border hidden shrink-0 items-center gap-1 border-l pl-5 lg:flex"
          >
            Ayuda
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>
      </nav>
    </header>
  );
}
