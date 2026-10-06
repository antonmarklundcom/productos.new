import { renderMarkdown } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Descripción de producto o categoría, renderizada desde markdown seguro
 * (plan-operacion §6.3 / §5.3 D).
 *
 * `dangerouslySetInnerHTML` con la salida de `renderMarkdown` **y sólo con
 * eso** — es el único lugar del template que usa esta prop. Es seguro porque
 * `renderMarkdown` escapa TODO el texto de entrada antes de agregar cualquier
 * etiqueta propia (ver el comentario grande en `src/lib/markdown.ts`): no
 * existe un camino por el que un carácter del texto original —del comercio o
 * de quien sea que haya cargado esa descripción— llegue a la salida sin pasar
 * por `escapar()`. Si algún día este componente recibiera texto que no vino
 * de `renderMarkdown`, dejaría de ser seguro; por eso el tipo del prop es
 * `string` a secas y no algo que invite a pasarle HTML de otro origen.
 *
 * Server component: no hay estado ni interacción, y así no viaja al bundle
 * del cliente.
 */
export function ProductDescription({
  markdown,
  className,
}: {
  markdown: string | null | undefined;
  className?: string;
}) {
  const html = renderMarkdown(markdown);
  if (!html) return null;

  return <div className={cn("prose", className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
