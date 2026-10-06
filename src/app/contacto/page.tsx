import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, MapPin, Clock, ArrowUpRight } from "lucide-react";
import { contactoPublico } from "@/lib/comercio";
import { siteOrigin } from "@/lib/site-url";
import { formatPhonePY, waLink } from "@/lib/py";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  const origin = siteOrigin();
  return {
    title: "Contacto",
    description:
      "Conocé nuestros canales de atención y encontrá ayuda para consultar el catálogo o seguir tu pedido.",
    ...(origin
      ? { alternates: { canonical: new URL("/contacto", origin).toString() } }
      : {}),
  };
}
export default async function ContactPage() {
  const contact = await contactoPublico();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <p className="eyebrow text-muted-foreground">Estamos para ayudarte</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Hablemos.</h1>
      <p className="text-muted-foreground mt-4 max-w-xl text-sm leading-relaxed">
        Encontrá acá nuestros canales de atención. Si ya tenés un pedido, guardá
        su número para consultarlo.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {contact.whatsapp ? (
          <a
            className="rounded-2xl border p-6"
            href={waLink(
              contact.whatsapp,
              "Hola, quisiera consultar el catálogo."
            )}
          >
            <MessageCircle size={25} aria-hidden />
            <h2 className="mt-4 font-medium">WhatsApp</h2>
            <p className="mt-2 text-sm">{formatPhonePY(contact.whatsapp)}</p>
          </a>
        ) : null}
        {contact.email ? (
          <a
            className="rounded-2xl border p-6"
            href={`mailto:${contact.email}`}
          >
            <Mail size={25} aria-hidden />
            <h2 className="mt-4 font-medium">Email</h2>
            <p className="mt-2 text-sm break-all">{contact.email}</p>
          </a>
        ) : null}
        {contact.direccion ? (
          <div className="rounded-2xl border p-6">
            <MapPin size={25} aria-hidden />
            <h2 className="mt-4 font-medium">Dirección</h2>
            <p className="mt-2 text-sm">{contact.direccion}</p>
          </div>
        ) : null}
        {contact.horario ? (
          <div className="rounded-2xl border p-6">
            <Clock size={25} aria-hidden />
            <h2 className="mt-4 font-medium">Horario de atención</h2>
            <p className="mt-2 text-sm">{contact.horario}</p>
          </div>
        ) : null}
      </div>
      {!contact.whatsapp && !contact.email ? (
        <div className="bg-muted mt-8 rounded-2xl p-6">
          <h2 className="font-medium">Canales de atención en preparación</h2>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            Todavía no publicamos un número ni un email de contacto. El catálogo
            comercial y la recepción de pedidos están en preparación.
          </p>
        </div>
      ) : null}
      <Link
        href="/pedido/buscar"
        className="mt-8 inline-flex items-center gap-4 text-sm underline underline-offset-4"
      >
        Consultá un pedido
        <ArrowUpRight size={16} aria-hidden />
      </Link>
    </main>
  );
}
