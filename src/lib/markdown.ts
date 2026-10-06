/**
 * Markdown seguro para la descripción de un producto (plan-operacion §5.3 D).
 *
 * ### Por qué un parser propio de ochenta líneas y no una librería
 *
 * No es orgullo: es el CSP. `src/proxy.ts` sirve las páginas con sesión y con
 * plata bajo un CSP con nonce y **sin `'unsafe-inline'`**, y las librerías de
 * markdown más usadas o traen su propio sanitizador con su propia lista de
 * excepciones, o esperan poder inyectar estilos. Sumar una dependencia de
 * runtime para renderizar seis marcas de formato es sumar su superficie de
 * ataque, su cadena de dependencias transitivas y su próxima CVE al camino que
 * dibuja la descripción de un producto.
 *
 * El subconjunto es a propósito chico: párrafos, `**negrita**`, `*cursiva*`,
 * listas con `- `, saltos de línea y links `[texto](https://…)`. Es lo que un
 * comercio usa para describir una remera. **No hay** HTML crudo, ni imágenes,
 * ni encabezados, ni tablas.
 *
 * ### La regla que hace que esto sea seguro
 *
 * **Se escapa TODO primero y recién después se agrega el HTML propio.** No hay
 * ningún camino por el que un carácter del texto original llegue a la salida
 * sin pasar por `escapar()`. Eso invierte la carga: en vez de tener que
 * acordarse de bloquear cada vector conocido (`<script>`, `<img onerror>`,
 * `<svg onload>`, entidades dobles), no hay vector — el `<` de la entrada ya es
 * `&lt;` antes de que este archivo escriba su primer `<p>`.
 *
 * Los links son el único lugar donde entra un dato del usuario adentro de un
 * atributo, y por eso son el único con lista blanca: **sólo `https://`**, y con
 * `rel="nofollow noopener"` para no regalar PageRank ni la referencia a
 * `window.opener`. Un `javascript:`, un `data:` o un `http://` no producen un
 * link: producen el texto tal cual, escapado.
 *
 * ### Sin APIs de Node
 *
 * S10 importa esto en un componente `"use client"` para la vista previa del
 * formulario, así que no puede haber `Buffer`, ni `node:*`, ni nada que no
 * exista en el navegador. Es JavaScript y expresiones regulares, nada más.
 */

/** Los cuatro caracteres que convierten texto en HTML. Se van todos, siempre. */
function escapar(texto: string): string {
  return texto
    // El `&` va primero o se re-escaparían los `&` que este mismo paso genera.
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Las marcas de línea, sobre texto **ya escapado**.
 *
 * El orden importa: los links primero (para que su texto no se coma un `*`
 * suelto de la URL), después negrita y recién después cursiva — `**` tiene que
 * ganarle a `*` o `**x**` sale como `<em>*x</em>*`.
 */
function marcasEnLinea(escapado: string): string {
  return escapado
    .replace(
      // El texto del link no puede tener `]`, y la URL no puede tener espacios
      // ni paréntesis: sin eso, un `)` en la URL rompe el cierre y se lleva
      // media línea adentro del atributo.
      /\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g,
      (_todo, texto: string, url: string) =>
        // La URL ya viene escapada (el `"` es `&quot;`), así que no puede
        // cerrar el atributo. Igual se vuelve a chequear el esquema: la
        // expresión de arriba lo exige, y esto es el cinturón.
        url.startsWith('https://')
          ? `<a href="${url}" rel="nofollow noopener" target="_blank">${texto}</a>`
          : `[${texto}](${url})`,
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * Markdown → HTML seguro.
 *
 * La salida no lleva `class` ni `style`: la piel la estila desde afuera
 * (`.prose p`, `.prose li`), que es lo que le permite a cada tienda
 * rediseñarla sin tocar este archivo.
 */
export function renderMarkdown(texto: string | null | undefined): string {
  if (!texto) return '';

  const bloques: string[] = [];
  let lista: string[] = [];

  const cerrarLista = (): void => {
    if (lista.length === 0) return;
    bloques.push(`<ul>${lista.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    lista = [];
  };

  // Se normalizan los saltos de Windows antes de partir: una descripción
  // pegada desde Word trae `\r\n` y si no, cada línea termina con un `\r`
  // invisible que se cuela en la salida.
  for (const parrafo of texto.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lineas = parrafo.split('\n').filter((linea) => linea.trim() !== '');
    if (lineas.length === 0) continue;

    for (const linea of lineas) {
      const item = /^\s*[-*]\s+(.*)$/.exec(linea);
      if (item) {
        lista.push(marcasEnLinea(escapar(item[1]!.trim())));
        continue;
      }

      // Una línea normal cierra la lista que venía: `- a\ntexto` son una lista
      // y un párrafo, no un ítem con texto pegado.
      cerrarLista();
      bloques.push(`<p>${marcasEnLinea(escapar(linea.trim()))}</p>`);
    }

    cerrarLista();
  }

  cerrarLista();
  return bloques.join('');
}

/**
 * Markdown → texto plano, para el `<meta name="description">` y el JSON-LD.
 *
 * Existe porque hoy la descripción va cruda al `<meta>`: una que empiece con
 * `**Importado**` publica literalmente los asteriscos en el resultado de
 * Google. Saca las marcas, deja el texto del link (no la URL, que no le sirve
 * a nadie en un snippet) y aplasta los saltos.
 *
 * **No escapa nada**: la salida es texto plano y quien la use se encarga de su
 * propio contexto. Next escapa solo lo que pone en un `<meta>`.
 */
export function markdownToText(texto: string | null | undefined): string {
  if (!texto) return '';

  return texto
    .replace(/\r\n?/g, '\n')
    // Del link queda el texto: la URL en un snippet de Google es ruido.
    .replace(/\[([^\]]+)\]\(https:\/\/[^\s)]+\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    // El guion de la lista se va con su espacio; el texto del ítem queda.
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
