import { TIENDA } from "@/config/tienda";

import { esPY } from "./es-PY";

/**
 * Un idioma por tienda, elegido en `tienda.ts` (PLAN.md FASE 2, PR P — Nivel A).
 *
 * ### Por qué no hay una librería
 *
 * `next-intl` y compañía resuelven dos problemas que este template **no
 * tiene**: rutas por locale (`/es/…`, `/en/…`) y un idioma que cambia por
 * request. Acá el idioma es una constante de build —lo elige el dueño una vez,
 * en `TIENDA.lang`— y las URLs quedan en español para siempre, que es una
 * decisión tomada (PLAN.md: son parte del template). Con eso, todo lo que
 * queda es buscar un string en un objeto.
 *
 * La consecuencia práctica es que `t()` es **síncrona y sin contexto**: anda
 * igual en un Server Component, en un `"use client"`, en `generateMetadata` y
 * en un script de Node. Un provider de React no serviría para lo último, y
 * medio catálogo vive en `order-messages.ts`, que corre fuera de React.
 *
 * ### Cómo se agrega un idioma
 *
 * 1. Copiar `es-PY.ts` a `<lang>.ts` y traducir los valores. Las **claves no
 *    se tocan**: son el contrato.
 * 2. Agregarlo a `CATALOGOS` acá abajo.
 * 3. Poner `lang: "<lang>"` en `tienda.ts`.
 *
 * `es-PY` es el default y además el **fallback por clave**: una traducción a
 * medias muestra el español donde falte, nunca un `undefined` ni el nombre
 * crudo de la clave en la cara de la compradora. Eso es a propósito y no es
 * una red de seguridad silenciosa — hay un test de CI que exige que todo
 * catálogo registrado tenga exactamente las mismas claves que `es-PY`, así que
 * el fallback sólo puede salvar a alguien a mitad de una traducción en curso,
 * nunca a un catálogo que se mergeó incompleto.
 *
 * ### Qué NO entra acá
 *
 * **La plata.** `money.ts` sigue siendo PYG entero con su `₲` literal: cambiar
 * de moneda no es traducir, es tocar el camino del dinero, y está fuera de
 * alcance por escrito (PLAN.md, PR P–S).
 */

export type Catalogo = typeof esPY;
export type MessageKey = keyof Catalogo;

const CATALOGOS: Record<string, Partial<Catalogo>> = {
  "es-PY": esPY,
};

/**
 * El catálogo de esta tienda, resuelto una vez al importar el módulo.
 *
 * Un `lang` que no está registrado **no rompe la tienda**: cae en `es-PY` y lo
 * avisa por consola. Una tienda entera caída porque alguien tipeó `"es_PY"` en
 * vez de `"es-PY"` sería un castigo desproporcionado para un error de guion.
 */
const CATALOGO: Partial<Catalogo> = (() => {
  const elegido = CATALOGOS[TIENDA.lang];
  if (elegido) return elegido;
  console.warn(
    `[i18n] No hay catálogo para "${TIENDA.lang}"; se usa es-PY. ` +
      "Agregalo en src/i18n/index.ts o corregí TIENDA.lang.",
  );
  return esPY;
})();

/** Los valores que se pueden interpolar en un mensaje. */
export type Params = Record<string, string | number>;

/**
 * El texto de una clave, con sus `{parámetros}` reemplazados.
 *
 * ```ts
 * t("carrito.vacio")                       // "Tu carrito está vacío"
 * t("catalogo.productos", { n: 3 })        // "3 productos"
 * ```
 *
 * Un parámetro que el mensaje no nombra se ignora; un `{hueco}` sin valor se
 * deja tal cual, visible. Es feo a propósito: un hueco vacío pasa
 * desapercibido en una revisión y `{n}` en pantalla no.
 */
export function t(key: MessageKey, params?: Params): string {
  const template = CATALOGO[key] ?? esPY[key];
  if (params === undefined) return template;

  return template.replace(/\{(\w+)\}/g, (hueco, name: string) => {
    const value = params[name];
    return value === undefined ? hueco : String(value);
  });
}

/**
 * Singular o plural, según `n`.
 *
 * Espera dos claves, `<key>.uno` y `<key>.varios`, y le pasa `n` a las dos.
 * Dos formas alcanzan para el español y el inglés; un idioma con más
 * (el ruso tiene tres, el árabe seis) necesita `Intl.PluralRules` acá adentro,
 * y este es el único lugar que habría que tocar.
 *
 * ```ts
 * tPlural("catalogo.productos", 1)   // "1 producto"
 * tPlural("catalogo.productos", 7)   // "7 productos"
 * ```
 */
export function tPlural(
  key: PluralKey,
  n: number,
  params?: Params,
): string {
  const sufijo = n === 1 ? "uno" : "varios";
  return t(`${key}.${sufijo}` as MessageKey, { ...params, n });
}

/**
 * Las claves que tienen las dos formas. Sale del catálogo, así que pedir un
 * plural que no existe no compila.
 */
export type PluralKey = {
  [K in MessageKey]: K extends `${infer Base}.uno` ? Base : never;
}[MessageKey];

/** El idioma efectivo, para `<html lang>` y para los tests. */
export function idiomaActivo(): string {
  return CATALOGOS[TIENDA.lang] ? TIENDA.lang : "es-PY";
}

/** Los idiomas registrados. Sólo lo usa el test de completitud. */
export function catalogosRegistrados(): Record<string, Partial<Catalogo>> {
  return CATALOGOS;
}
