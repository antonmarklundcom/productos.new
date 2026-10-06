import type { Metadata } from "next";
import Link from "next/link";
import type React from "react";

import {
  HeroImagePanel,
  MarcaImagenPanel,
  SettingsSectionForm,
  type TipoCampo,
} from "@/components/admin/store-settings-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAGINAS_DEFAULT } from "@/config/paginas-default";
import { TIENDA } from "@/config/tienda";
import { DEFAULT_REORDER_POINT } from "@/domain/admin-products";
import { readStoreSettings } from "@/domain/store-settings";
import {
  PAGINAS,
  heroEfectivo,
  lineasDeConfianza,
  type StoreSettings,
} from "@/domain/store-settings-schema";
import { t } from "@/i18n";
import { requireCapabilityPage } from "@/lib/admin-guard";
import { cloudinaryConfigured } from "@/lib/cloudinary";
import { customerSessionConfigured } from "@/lib/customer-session";
import { comercioWhatsApp } from "@/lib/comercio";
import { productImageUrl } from "@/lib/images";
import { paginaEfectiva } from "@/lib/paginas";
import { PLACEHOLDERS } from "@/lib/placeholders";
import { formatDateTimePY, formatPhonePY } from "@/lib/py";

export const metadata: Metadata = { title: t("panel.ajustes.meta") };

export const dynamic = "force-dynamic";

/**
 * `/admin/ajustes` — owner-only.
 *
 * Lo que antes pedía un desarrollador (editar `src/config/tienda.ts` o una
 * variable de entorno y redeployar) y ahora cambia el dueño: la bajada y la
 * portada, la barra de anuncio, el contacto público, las páginas de
 * políticas, los datos de envío y devolución para Google, un par de
 * interruptores de la vidriera, el recuadro de confianza del checkout y el
 * umbral de stock bajo.
 *
 * Cada campo vacío significa "el de siempre", y la pantalla muestra cuál es:
 * esconder el default dejaría al dueño mirando un formulario vacío mientras
 * su tienda muestra un texto que no sabe de dónde sale (mismo criterio que
 * `/admin/banco`).
 *
 * También la **identidad** (nombre, logo, favicon y color de marca) y el
 * interruptor de las **cuentas de cliente**: lo que antes obligaba a editar
 * `tienda.ts` y redeployar para cada tienda clonada. `tienda.ts` sigue siendo
 * el default de todo lo que el dueño no cargó.
 */
export default async function AdminAjustesPage() {
  await requireCapabilityPage("ajustes");

  const { settings, updatedAt } = await readStoreSettings();
  const whatsappEntorno = comercioWhatsApp();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("panel.ajustes.titulo")}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t("panel.ajustes.bajada")}</p>
        {updatedAt ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {t("panel.ajustes.actualizado", { fecha: formatDateTimePY(updatedAt) })}
          </p>
        ) : null}
        <nav className="mt-3 flex flex-wrap gap-2 text-sm" aria-label={t("panel.ajustes.indice")}>
          {INDICE.map(([id, clave]) => (
            <a key={id} href={`#${id}`} className="hover:bg-muted rounded-lg border px-2.5 py-1">
              {t(clave)}
            </a>
          ))}
        </nav>
      </div>

      <IdentidadSection settings={settings} />
      <MarcaSection settings={settings} />
      <AnuncioSection settings={settings} />
      <ContactoSection settings={settings} whatsappEntorno={whatsappEntorno} />
      <EnvioDevolucionSection settings={settings} />
      <PaginasSection settings={settings} />
      <VidrieraSection settings={settings} />
      <CheckoutSection settings={settings} />
      <StockSection settings={settings} />
      <CuentasSection settings={settings} />
    </div>
  );
}

const INDICE = [
  ["identidad", "panel.ajustes.identidad.titulo"],
  ["marca", "panel.ajustes.marca.titulo"],
  ["anuncio", "panel.ajustes.anuncio.titulo"],
  ["contacto", "panel.ajustes.contacto.titulo"],
  ["envio", "panel.ajustes.envio.titulo"],
  ["paginas", "panel.ajustes.paginas.tituloSeccion"],
  ["vidriera", "panel.ajustes.vidriera.titulo"],
  ["checkout", "panel.ajustes.checkout.tituloSeccion"],
  ["stock", "panel.ajustes.stock.titulo"],
  ["cuentas", "panel.ajustes.cuentas.titulo"],
] as const;

// ---------------------------------------------------------------------------
// Secciones
// ---------------------------------------------------------------------------

function MarcaSection({ settings }: { settings: StoreSettings }) {
  const m = settings.marca;
  // La portada que la home dibujaría sin ajustes: `TIENDA.hero` o el texto
  // del template. El botón del template depende de la primera categoría, así
  // que acá sólo se muestra su texto.
  const base = TIENDA.hero ?? {
    titulo: t("home.hero.titulo"),
    texto: t("home.hero.texto"),
    cta: { label: t("home.hero.cta"), href: "" },
  };
  const efectivo = heroEfectivo({ ...m, heroActivo: true }, base);
  const imagenUrl = productImageUrl(efectivo?.imagen?.cloudinaryId, "card");

  const campos: Record<string, TipoCampo> = {
    tagline: "texto",
    seoTitulo: "texto",
    seoDescripcion: "texto",
    heroActivo: "booleano",
    heroTitulo: "texto",
    heroTexto: "texto",
    heroCtaLabel: "texto",
    heroCtaHref: "texto",
    heroImagenId: "texto",
    heroImagenAlt: "texto",
  };

  return (
    <Tarjeta id="marca" titulo={t("panel.ajustes.marca.titulo")} bajada={t("panel.ajustes.marca.bajada")}>
      <SettingsSectionForm seccion="marca" campos={campos}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto
            nombre="tagline"
            etiqueta={t("panel.ajustes.marca.tagline")}
            valor={m.tagline}
            porDefecto={TIENDA.tagline}
            max={200}
          />
          <CampoTexto
            nombre="seoTitulo"
            etiqueta={t("panel.ajustes.marca.seoTitulo")}
            valor={m.seoTitulo}
            porDefecto={TIENDA.titulo}
            max={70}
          />
          <CampoArea
            nombre="seoDescripcion"
            etiqueta={t("panel.ajustes.marca.seoDescripcion")}
            valor={m.seoDescripcion}
            porDefecto={TIENDA.descripcion}
            max={170}
            filas={2}
          />
        </div>

        <fieldset className="border-border grid gap-3 rounded-lg border p-3">
          <legend className="px-1 text-sm font-medium">{t("panel.ajustes.marca.hero")}</legend>
          <CampoCheck
            nombre="heroActivo"
            etiqueta={t("panel.ajustes.marca.heroActivo")}
            valor={m.heroActivo}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <CampoTexto
              nombre="heroTitulo"
              etiqueta={t("panel.ajustes.marca.heroTitulo")}
              valor={m.heroTitulo}
              porDefecto={base.titulo}
              max={120}
            />
            <CampoArea
              nombre="heroTexto"
              etiqueta={t("panel.ajustes.marca.heroTexto")}
              valor={m.heroTexto}
              porDefecto={base.texto ?? null}
              max={300}
              filas={2}
            />
            <CampoTexto
              nombre="heroCtaLabel"
              etiqueta={t("panel.ajustes.marca.heroCtaLabel")}
              valor={m.heroCtaLabel}
              porDefecto={base.cta?.label ?? null}
              max={40}
            />
            <CampoTexto
              nombre="heroCtaHref"
              etiqueta={t("panel.ajustes.marca.heroCtaHref")}
              valor={m.heroCtaHref}
              porDefecto={base.cta?.href || t("panel.ajustes.marca.heroCtaHrefDefecto")}
              max={300}
              ayuda={t("panel.ajustes.marca.heroCtaHrefAyuda")}
            />
            <CampoTexto
              nombre="heroImagenAlt"
              etiqueta={t("panel.ajustes.marca.heroImagenAlt")}
              valor={m.heroImagenAlt}
              porDefecto={base.imagen?.alt ?? null}
              max={160}
            />
          </div>
          {/* La foto se sube aparte (abajo); este campo viaja con el formulario
              para que guardar los textos no la borre. */}
          <input type="hidden" name="heroImagenId" defaultValue={m.heroImagenId ?? ""} />
        </fieldset>
      </SettingsSectionForm>

      <HeroImagePanel imagenUrl={imagenUrl} habilitado={cloudinaryConfigured()} />
    </Tarjeta>
  );
}

function IdentidadSection({ settings }: { settings: StoreSettings }) {
  const i = settings.identidad;
  const cloudinaryListo = cloudinaryConfigured();
  const campos: Record<string, TipoCampo> = {
    nombre: "texto",
    colorPrimario: "texto",
    logoId: "texto",
    faviconId: "texto",
  };
  return (
    <Tarjeta
      id="identidad"
      titulo={t("panel.ajustes.identidad.titulo")}
      bajada={t("panel.ajustes.identidad.bajada")}
    >
      <SettingsSectionForm seccion="identidad" campos={campos}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto
            nombre="nombre"
            etiqueta={t("panel.ajustes.identidad.nombre")}
            valor={i.nombre}
            porDefecto={TIENDA.nombre}
            max={60}
            ayuda={t("panel.ajustes.identidad.nombreAyuda")}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="ajustes-colorPrimario">{t("panel.ajustes.identidad.color")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="ajustes-colorPrimario"
                name="colorPrimario"
                maxLength={7}
                autoComplete="off"
                placeholder="#1f6feb"
                defaultValue={i.colorPrimario ?? ""}
                className="font-mono"
              />
              {i.colorPrimario ? (
                <span
                  aria-hidden
                  className="border-border size-8 shrink-0 rounded-md border"
                  style={{ background: i.colorPrimario }}
                />
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">{t("panel.ajustes.identidad.colorAyuda")}</p>
          </div>
        </div>
        {/* Las imágenes se suben aparte (abajo); viajan con el formulario
            para que guardar el nombre o el color no las borre. */}
        <input type="hidden" name="logoId" defaultValue={i.logoId ?? ""} />
        <input type="hidden" name="faviconId" defaultValue={i.faviconId ?? ""} />
      </SettingsSectionForm>

      <div className="grid gap-3 sm:grid-cols-2">
        <MarcaImagenPanel
          tipo="logo"
          imagenUrl={productImageUrl(i.logoId, "logo")}
          habilitado={cloudinaryListo}
        />
        <MarcaImagenPanel
          tipo="favicon"
          imagenUrl={productImageUrl(i.faviconId, "favicon")}
          habilitado={cloudinaryListo}
        />
      </div>
    </Tarjeta>
  );
}

function CuentasSection({ settings }: { settings: StoreSettings }) {
  const c = settings.cuentas;
  const porDefecto = TIENDA.cuentasClientes ? t("panel.ajustes.si") : t("panel.ajustes.no");
  return (
    <Tarjeta
      id="cuentas"
      titulo={t("panel.ajustes.cuentas.titulo")}
      bajada={t("panel.ajustes.cuentas.bajada")}
    >
      <SettingsSectionForm seccion="cuentas" campos={{ activas: "triestado" }}>
        <CampoSelect
          nombre="activas"
          etiqueta={t("panel.ajustes.cuentas.activas")}
          valor={c.activas === null ? "" : c.activas ? "si" : "no"}
          opciones={[
            ["", t("panel.ajustes.cuentas.porDefecto", { valor: porDefecto })],
            ["si", t("panel.ajustes.cuentas.si")],
            ["no", t("panel.ajustes.cuentas.no")],
          ]}
        />
        {!customerSessionConfigured() ? (
          <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
            {t("panel.ajustes.cuentas.sinSecreto")}
          </p>
        ) : null}
      </SettingsSectionForm>
    </Tarjeta>
  );
}

function AnuncioSection({ settings }: { settings: StoreSettings }) {
  const a = settings.anuncio;
  return (
    <Tarjeta id="anuncio" titulo={t("panel.ajustes.anuncio.titulo")} bajada={t("panel.ajustes.anuncio.bajada")}>
      <SettingsSectionForm seccion="anuncio" campos={{ activo: "booleano", texto: "texto", href: "texto" }}>
        <CampoCheck nombre="activo" etiqueta={t("panel.ajustes.anuncio.activo")} valor={a.activo} />
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto
            nombre="texto"
            etiqueta={t("panel.ajustes.anuncio.texto")}
            valor={a.texto}
            porDefecto={null}
            max={140}
            ejemplo={t("panel.ajustes.anuncio.textoEjemplo")}
          />
          <CampoTexto
            nombre="href"
            etiqueta={t("panel.ajustes.anuncio.href")}
            valor={a.href}
            porDefecto={null}
            max={300}
            ayuda={t("panel.ajustes.marca.heroCtaHrefAyuda")}
          />
        </div>
      </SettingsSectionForm>
    </Tarjeta>
  );
}

function ContactoSection({
  settings,
  whatsappEntorno,
}: {
  settings: StoreSettings;
  whatsappEntorno: string | null;
}) {
  const c = settings.contacto;
  const campos: Record<string, TipoCampo> = {
    whatsapp: "texto",
    email: "texto",
    direccion: "texto",
    horario: "texto",
    instagram: "texto",
    facebook: "texto",
    tiktok: "texto",
  };
  return (
    <Tarjeta id="contacto" titulo={t("panel.ajustes.contacto.titulo")} bajada={t("panel.ajustes.contacto.bajada")}>
      <SettingsSectionForm seccion="contacto" campos={campos}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoTexto
            nombre="whatsapp"
            etiqueta={t("panel.ajustes.contacto.whatsapp")}
            valor={c.whatsapp ? formatPhonePY(c.whatsapp) : null}
            porDefecto={whatsappEntorno ? formatPhonePY(whatsappEntorno) : null}
            max={30}
            tipo="tel"
            ayuda={t("panel.ajustes.contacto.whatsappAyuda")}
          />
          <CampoTexto
            nombre="email"
            etiqueta={t("panel.ajustes.contacto.email")}
            valor={c.email}
            porDefecto={null}
            max={120}
            tipo="email"
          />
          <CampoTexto
            nombre="direccion"
            etiqueta={t("panel.ajustes.contacto.direccion")}
            valor={c.direccion}
            porDefecto={null}
            max={200}
          />
          <CampoTexto
            nombre="horario"
            etiqueta={t("panel.ajustes.contacto.horario")}
            valor={c.horario}
            porDefecto={null}
            max={200}
            ejemplo={t("panel.ajustes.contacto.horarioEjemplo")}
          />
          <CampoTexto nombre="instagram" etiqueta="Instagram" valor={c.instagram} porDefecto={null} max={300} tipo="url" ejemplo="https://instagram.com/…" />
          <CampoTexto nombre="facebook" etiqueta="Facebook" valor={c.facebook} porDefecto={null} max={300} tipo="url" ejemplo="https://facebook.com/…" />
          <CampoTexto nombre="tiktok" etiqueta="TikTok" valor={c.tiktok} porDefecto={null} max={300} tipo="url" ejemplo="https://tiktok.com/@…" />
        </div>
      </SettingsSectionForm>
    </Tarjeta>
  );
}

function EnvioDevolucionSection({ settings }: { settings: StoreSettings }) {
  const e = settings.envioDevolucion;
  const campos: Record<string, TipoCampo> = {
    handlingDaysMin: "texto",
    handlingDaysMax: "texto",
    transitDaysMin: "texto",
    transitDaysMax: "texto",
    shippingFromPyg: "texto",
    acceptsReturns: "triestado",
    returnDays: "texto",
    returnFees: "texto",
    returnMethod: "texto",
  };
  return (
    <Tarjeta id="envio" titulo={t("panel.ajustes.envio.titulo")} bajada={t("panel.ajustes.envio.bajada")}>
      <SettingsSectionForm seccion="envioDevolucion" campos={campos}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoNumero nombre="handlingDaysMin" etiqueta={t("panel.ajustes.envio.preparacionMin")} valor={e.handlingDaysMin} />
          <CampoNumero nombre="handlingDaysMax" etiqueta={t("panel.ajustes.envio.preparacionMax")} valor={e.handlingDaysMax} />
          <CampoNumero nombre="transitDaysMin" etiqueta={t("panel.ajustes.envio.transitoMin")} valor={e.transitDaysMin} />
          <CampoNumero nombre="transitDaysMax" etiqueta={t("panel.ajustes.envio.transitoMax")} valor={e.transitDaysMax} />
          <CampoNumero
            nombre="shippingFromPyg"
            etiqueta={t("panel.ajustes.envio.desde")}
            valor={e.shippingFromPyg}
            ayuda={t("panel.ajustes.envio.desdeAyuda")}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <CampoSelect
            nombre="acceptsReturns"
            etiqueta={t("panel.ajustes.envio.aceptaDevoluciones")}
            valor={e.acceptsReturns === null ? "" : e.acceptsReturns ? "si" : "no"}
            opciones={[
              ["", t("panel.ajustes.envio.sinResponder")],
              ["si", t("panel.ajustes.si")],
              ["no", t("panel.ajustes.no")],
            ]}
          />
          <CampoNumero nombre="returnDays" etiqueta={t("panel.ajustes.envio.diasDevolucion")} valor={e.returnDays} />
          <CampoSelect
            nombre="returnFees"
            etiqueta={t("panel.ajustes.envio.costoDevolucion")}
            valor={e.returnFees ?? ""}
            opciones={[
              ["", t("panel.ajustes.envio.sinResponder")],
              ["cliente", t("panel.ajustes.envio.costoCliente")],
              ["gratis", t("panel.ajustes.envio.costoGratis")],
            ]}
          />
          <CampoSelect
            nombre="returnMethod"
            etiqueta={t("panel.ajustes.envio.metodoDevolucion")}
            valor={e.returnMethod ?? ""}
            opciones={[
              ["", t("panel.ajustes.envio.sinResponder")],
              ["envio", t("panel.ajustes.envio.metodoEnvio")],
              ["local", t("panel.ajustes.envio.metodoLocal")],
              ["ambos", t("panel.ajustes.envio.metodoAmbos")],
            ]}
          />
        </div>
        <p className="text-muted-foreground text-xs">{t("panel.ajustes.envio.ayuda")}</p>
      </SettingsSectionForm>
    </Tarjeta>
  );
}

function PaginasSection({ settings }: { settings: StoreSettings }) {
  return (
    <Tarjeta
      id="paginas"
      titulo={t("panel.ajustes.paginas.tituloSeccion")}
      bajada={t("panel.ajustes.paginas.bajada", {
        placeholders: PLACEHOLDERS.map((nombre) => `{{${nombre}}}`).join(" "),
      })}
    >
      {PAGINAS.map((slug) => {
        const pagina = paginaEfectiva(settings, slug);
        return (
          <div key={slug} className="border-border grid gap-3 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{pagina.titulo}</h3>
              <Link href={`/${slug}`} target="_blank" className="text-sm underline">
                {t("panel.ajustes.paginas.ver", { ruta: `/${slug}` })}
              </Link>
            </div>
            {pagina.cuerpoPorDefecto ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                {t("panel.ajustes.paginas.porDefecto")}
              </p>
            ) : null}
            <SettingsSectionForm
              seccion="paginas"
              anidarEn={slug}
              campos={{ activo: "booleano", titulo: "texto", cuerpo: "texto" }}
              restaurar={{ [slug]: { activo: pagina.activo, titulo: null, cuerpo: null } }}
              restaurarLabel={t("panel.ajustes.paginas.restaurar")}
            >
              <CampoCheck nombre="activo" etiqueta={t("panel.ajustes.paginas.activo")} valor={pagina.activo} id={`pagina-${slug}-activo`} />
              <CampoTexto
                nombre="titulo"
                etiqueta={t("panel.ajustes.paginas.titulo")}
                valor={settings.paginas[slug].titulo}
                porDefecto={PAGINAS_DEFAULT[slug].titulo}
                max={80}
                id={`pagina-${slug}-titulo`}
              />
              <div className="grid gap-1.5">
                <Label htmlFor={`pagina-${slug}-cuerpo`}>{t("panel.ajustes.paginas.cuerpo")}</Label>
                <textarea
                  id={`pagina-${slug}-cuerpo`}
                  name="cuerpo"
                  rows={10}
                  maxLength={20_000}
                  defaultValue={pagina.cuerpo}
                  className="border-input bg-background rounded-md border px-3 py-2 font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">{t("panel.markdown.ayuda")}</p>
              </div>
            </SettingsSectionForm>
          </div>
        );
      })}
    </Tarjeta>
  );
}

function VidrieraSection({ settings }: { settings: StoreSettings }) {
  const v = settings.vidriera;
  return (
    <Tarjeta id="vidriera" titulo={t("panel.ajustes.vidriera.titulo")} bajada={t("panel.ajustes.vidriera.bajada")}>
      <SettingsSectionForm
        seccion="vidriera"
        campos={{ estrellasEnTarjetas: "booleano", barraCompraMovil: "booleano" }}
      >
        <CampoCheck
          nombre="estrellasEnTarjetas"
          etiqueta={t("panel.ajustes.vidriera.estrellas")}
          valor={v.estrellasEnTarjetas}
          ayuda={t("panel.ajustes.vidriera.estrellasAyuda")}
        />
        <CampoCheck
          nombre="barraCompraMovil"
          etiqueta={t("panel.ajustes.vidriera.barra")}
          valor={v.barraCompraMovil}
          ayuda={t("panel.ajustes.vidriera.barraAyuda")}
        />
      </SettingsSectionForm>
    </Tarjeta>
  );
}

function CheckoutSection({ settings }: { settings: StoreSettings }) {
  const c = settings.checkout;
  const porDefecto = lineasDeConfianza({ ...c, confianzaLineas: null });
  const propias = c.confianzaLineas ?? [];
  return (
    <Tarjeta
      id="checkout"
      titulo={t("panel.ajustes.checkout.tituloSeccion")}
      bajada={t("panel.ajustes.checkout.bajada")}
    >
      <SettingsSectionForm
        seccion="checkout"
        campos={{ confianzaActiva: "booleano", confianzaTitulo: "texto", confianzaLineas: "lista" }}
      >
        <CampoCheck nombre="confianzaActiva" etiqueta={t("panel.ajustes.checkout.activo")} valor={c.confianzaActiva} />
        <CampoTexto
          nombre="confianzaTitulo"
          etiqueta={t("panel.ajustes.checkout.titulo")}
          valor={c.confianzaTitulo}
          porDefecto={t("checkout.confianza.titulo")}
          max={60}
        />
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t("panel.ajustes.checkout.lineas")}</p>
          {[0, 1, 2, 3].map((indice) => (
            <Input
              key={indice}
              name="confianzaLineas"
              aria-label={t("panel.ajustes.checkout.lineaN", { n: indice + 1 })}
              maxLength={120}
              defaultValue={propias[indice] ?? ""}
              placeholder={propias.length === 0 ? (porDefecto[indice] ?? "") : ""}
            />
          ))}
          <p className="text-muted-foreground text-xs">{t("panel.ajustes.checkout.lineasAyuda")}</p>
        </div>
      </SettingsSectionForm>
    </Tarjeta>
  );
}

function StockSection({ settings }: { settings: StoreSettings }) {
  return (
    <Tarjeta id="stock" titulo={t("panel.ajustes.stock.titulo")} bajada={t("panel.ajustes.stock.bajada")}>
      <SettingsSectionForm seccion="stock" campos={{ umbralStockBajo: "texto" }}>
        <CampoNumero
          nombre="umbralStockBajo"
          etiqueta={t("panel.ajustes.stock.umbral")}
          valor={settings.stock.umbralStockBajo}
          porDefecto={DEFAULT_REORDER_POINT}
        />
      </SettingsSectionForm>
    </Tarjeta>
  );
}

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

function Tarjeta({
  id,
  titulo,
  bajada,
  children,
}: {
  id: string;
  titulo: string;
  bajada: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="border-border grid scroll-mt-20 gap-4 rounded-xl border p-4">
      <div>
        <h2 className="font-medium">{titulo}</h2>
        <p className="text-muted-foreground mt-1 text-sm">{bajada}</p>
      </div>
      {children}
    </section>
  );
}

/** "Vacío: se usa …" — el valor efectivo cuando el campo queda sin cargar. */
function Defecto({ valor }: { valor: string | null }) {
  return (
    <p className="text-muted-foreground text-xs">
      {valor
        ? t("panel.ajustes.vacioUsa", { valor })
        : t("panel.ajustes.vacioNada")}
    </p>
  );
}

function CampoTexto({
  nombre,
  etiqueta,
  valor,
  porDefecto,
  max,
  tipo = "text",
  ayuda,
  ejemplo,
  id,
}: {
  nombre: string;
  etiqueta: string;
  valor: string | null;
  porDefecto: string | null;
  max: number;
  tipo?: "text" | "tel" | "email" | "url";
  ayuda?: string;
  ejemplo?: string;
  id?: string;
}) {
  const inputId = id ?? `ajustes-${nombre}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{etiqueta}</Label>
      <Input
        id={inputId}
        name={nombre}
        type={tipo}
        maxLength={max}
        autoComplete="off"
        defaultValue={valor ?? ""}
        placeholder={porDefecto ?? ejemplo ?? ""}
      />
      {ayuda ? <p className="text-muted-foreground text-xs">{ayuda}</p> : null}
      <Defecto valor={porDefecto} />
    </div>
  );
}

function CampoArea({
  nombre,
  etiqueta,
  valor,
  porDefecto,
  max,
  filas,
}: {
  nombre: string;
  etiqueta: string;
  valor: string | null;
  porDefecto: string | null;
  max: number;
  filas: number;
}) {
  const inputId = `ajustes-${nombre}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{etiqueta}</Label>
      <textarea
        id={inputId}
        name={nombre}
        rows={filas}
        maxLength={max}
        defaultValue={valor ?? ""}
        placeholder={porDefecto ?? ""}
        className="border-input bg-background rounded-md border px-3 py-2 text-sm"
      />
      <Defecto valor={porDefecto} />
    </div>
  );
}

function CampoNumero({
  nombre,
  etiqueta,
  valor,
  porDefecto,
  ayuda,
}: {
  nombre: string;
  etiqueta: string;
  valor: number | null;
  porDefecto?: number;
  ayuda?: string;
}) {
  const inputId = `ajustes-${nombre}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{etiqueta}</Label>
      <Input
        id={inputId}
        name={nombre}
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        defaultValue={valor ?? ""}
        placeholder={porDefecto !== undefined ? String(porDefecto) : ""}
      />
      {ayuda ? <p className="text-muted-foreground text-xs">{ayuda}</p> : null}
      <Defecto valor={porDefecto !== undefined ? String(porDefecto) : null} />
    </div>
  );
}

function CampoCheck({
  nombre,
  etiqueta,
  valor,
  ayuda,
  id,
}: {
  nombre: string;
  etiqueta: string;
  valor: boolean;
  ayuda?: string;
  id?: string;
}) {
  const inputId = id ?? `ajustes-${nombre}`;
  return (
    <div className="grid gap-1">
      <label htmlFor={inputId} className="flex items-center gap-2 text-sm">
        <input id={inputId} name={nombre} type="checkbox" defaultChecked={valor} className="size-4" />
        {etiqueta}
      </label>
      {ayuda ? <p className="text-muted-foreground pl-6 text-xs">{ayuda}</p> : null}
    </div>
  );
}

function CampoSelect({
  nombre,
  etiqueta,
  valor,
  opciones,
}: {
  nombre: string;
  etiqueta: string;
  valor: string;
  opciones: [string, string][];
}) {
  const inputId = `ajustes-${nombre}`;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>{etiqueta}</Label>
      <select
        id={inputId}
        name={nombre}
        defaultValue={valor}
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
      >
        {opciones.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
