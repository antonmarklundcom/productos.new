import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { Hero } from "@/config/tienda";
import { CATEGORIAS_INICIALES } from "@/config/tienda";
import { CategoryIcon } from "@/components/category-icon";
import { productImageUrl } from "@/lib/images";

export function HomeHero({ hero }: { hero: Hero }) {
  const src = productImageUrl(hero.imagen?.cloudinaryId, "hero");
  return (
    <section
      className={`store-hero relative isolate overflow-hidden rounded-3xl ${src ? "with-photo" : ""}`}
    >
      {src ? (
        <>
          <Image
            src={src}
            alt={hero.imagen?.alt ?? ""}
            fill
            priority
            unoptimized
            sizes="(max-width: 1200px) 100vw, 1200px"
            className="object-cover"
          />
          <div className="absolute inset-0 bg-black/55" aria-hidden />
        </>
      ) : null}
      <div className="hero-copy relative z-10">
        <p className="eyebrow flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-current" />
          Hecho para tu día a día
        </p>
        <h1>{hero.titulo}</h1>
        {hero.texto ? <p className="hero-description">{hero.texto}</p> : null}
        {hero.cta ? (
          <Link href={hero.cta.href} className="hero-cta">
            {hero.cta.label}
            <ArrowUpRight size={19} aria-hidden />
          </Link>
        ) : null}
        <p className="hero-footnote">Seis categorías. Un solo lugar.</p>
      </div>
      {!src ? (
        <div className="hero-art" aria-hidden>
          <div className="hero-orbit" />
          <div className="hero-bag">
            <div className="bag-handle" />
            <Image src="/brand/mark.svg" width={88} height={88} alt="" />
            <span>para vos.</span>
          </div>
          <div className="hero-tag">
            Un mundo
            <br />
            <strong>de posibilidades.</strong>
            <ArrowUpRight size={24} />
          </div>
          {CATEGORIAS_INICIALES.map((category, index) => (
            <div
              key={category.slug}
              className={`orbit-item orbit-${index} tone-${category.tone}`}
            >
              <CategoryIcon name={category.icon} strokeWidth={1.6} />
            </div>
          ))}
          <div className="hero-star">✳</div>
        </div>
      ) : null}
    </section>
  );
}
