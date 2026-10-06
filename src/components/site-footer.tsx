import Link from "next/link";
import Image from "next/image";
import { TIENDA } from "@/config/tienda";
import { storeCategories } from "@/components/store-categories";
import { getStoreSettings } from "@/domain/store-settings";
import { contactoPublico } from "@/lib/comercio";
import { marcaEfectiva } from "@/lib/marca";
import { formatPhonePY, waLink } from "@/lib/py";
import { t } from "@/i18n/client";

const HELP = [
  ["Envíos y entregas", "/envios"],
  ["Cambios y devoluciones", "/devoluciones"],
  ["Preguntas frecuentes", "/preguntas-frecuentes"],
  ["Contacto", "/contacto"],
  [t("footer.seguirPedido"), "/pedido/buscar"],
] as const;
export async function SiteFooter() {
  const [categories, ajustes, contacto, marca] = await Promise.all([
    storeCategories(),
    getStoreSettings(),
    contactoPublico(),
    marcaEfectiva(),
  ]);
  return (
    <footer className="store-footer">
      <div className="store-width grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Link href="/" className="flex items-center gap-2">
            <Image src="/brand/mark.svg" width={32} height={32} alt="" />
            <span className="text-2xl font-bold tracking-[-0.06em]">
              {marca.nombre}.
            </span>
          </Link>
          <p className="text-muted-foreground mt-4 max-w-56 text-sm leading-relaxed">
            {ajustes.marca.tagline ?? TIENDA.tagline}
          </p>
          <p className="text-muted-foreground mt-4 text-xs">Paraguay · PYG</p>
        </div>
        <div>
          <h2>{t("footer.categorias")}</h2>
          <ul>
            {categories.map((category) => (
              <li key={category.slug}>
                <Link href={`/categoria/${category.slug}`}>
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>{t("footer.ayuda")}</h2>
          <ul>
            {HELP.map(([label, href]) => (
              <li key={href}>
                <Link href={href}>{label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h2>{t("footer.contacto")}</h2>
          <ul>
            {contacto.whatsapp ? (
              <li>
                <a
                  href={waLink(
                    contacto.whatsapp,
                    "Hola, quisiera consultar el catálogo."
                  )}
                >
                  {t("footer.whatsapp", {
                    telefono: formatPhonePY(contacto.whatsapp),
                  })}
                </a>
              </li>
            ) : null}
            {contacto.email ? (
              <li>
                <a href={`mailto:${contacto.email}`}>{contacto.email}</a>
              </li>
            ) : null}
            {contacto.direccion ? <li>{contacto.direccion}</li> : null}
            {contacto.horario ? <li>{contacto.horario}</li> : null}
            {!contacto.whatsapp && !contacto.email ? (
              <li className="text-muted-foreground max-w-56 leading-relaxed">
                Pronto vamos a publicar nuestros canales de atención.
              </li>
            ) : null}
            {contacto.redes.map((red) => (
              <li key={red.red}>
                <a
                  href={red.url}
                  aria-label={`${t("footer.redes")}: ${red.red}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="capitalize"
                >
                  {red.red}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="footer-bottom">
        <div className="store-width flex flex-wrap items-center justify-between gap-4 py-5">
          <span>
            © {new Date().getFullYear()} {marca.nombre}
          </span>
          <div className="flex gap-5">
            <Link href="/privacidad">Privacidad</Link>
            <Link href="/terminos">Términos y condiciones</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
