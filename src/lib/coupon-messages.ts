import type { CouponRejection } from "@/domain/coupons";

import { t } from "@/i18n/client";

import { formatGs } from "./money";

/**
 * Por qué no anduvo el código, en castellano y sin culpar a nadie.
 *
 * "No existe" e "inactivo" dicen **lo mismo** hacia afuera: si se
 * distinguieran, el campo del checkout se convertiría en un buscador de qué
 * códigos existen en esta tienda, y probar mil combinaciones es gratis.
 *
 * Los demás sí se distinguen, y a propósito: "te falta ₲20.000 para llegar al
 * mínimo" es información que la hace agregar algo al carrito. "Ese código no
 * sirve" ahí sería esconder una venta.
 */
export function couponRejectionMessage(
  reason: CouponRejection,
  options: { minOrderPyg?: number | null; subtotalPyg?: number | null } = {}
): string {
  switch (reason) {
    case "no_existe":
    case "inactivo":
      return t("cupon.rechazo.noExiste");

    case "no_empezo":
      return t("cupon.rechazo.noEmpezo");

    case "vencido":
      return t("cupon.rechazo.vencido");

    case "agotado":
      return t("cupon.rechazo.agotado");

    case "agotado_para_vos":
      return t("cupon.rechazo.agotadoParaVos");

    case "minimo_no_alcanzado": {
      const min = options.minOrderPyg;
      if (!min) return t("cupon.rechazo.minimo");

      const falta =
        options.subtotalPyg != null ? min - options.subtotalPyg : null;
      return falta && falta > 0
        ? t("cupon.rechazo.minimoConFalta", {
            minimo: formatGs(min),
            falta: formatGs(falta),
          })
        : t("cupon.rechazo.minimoConMonto", { minimo: formatGs(min) });
    }

    case "solo_clientes":
      return t("cupon.rechazo.soloClientes");
  }
}
