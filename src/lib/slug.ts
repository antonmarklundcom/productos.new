/**
 * El slug de una categoría, un producto o una zona: la parte de la URL.
 *
 * Vivía suelto adentro de `product-form.tsx`, y ahí sólo servía para
 * autocompletar un campo del formulario. Ahora lo usan también los ABMs de
 * categorías y zonas de envío desde el **servidor**, y ahí importa que sea
 * exactamente la misma función: si el navegador propone `ropa-de-bebe` y el
 * servidor normaliza a otra cosa, el dueño guarda una URL que no es la que vio.
 *
 * Qué hace, en orden: separa los acentos de su letra (`NFD`), los tira, pasa
 * todo a minúsculas, convierte cualquier corrida de caracteres que no sea
 * `a-z0-9` en un guion, y recorta los guiones de las puntas.
 *
 * Puede devolver `""` —un nombre escrito entero en cirílico o en emojis no
 * deja nada— y quien llama tiene que decidir qué hacer con eso. El dominio lo
 * rechaza con un mensaje explícito en vez de guardar una URL vacía.
 */
export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
