"use client";

import {
  browserOperation,
  finishBrowserOperation,
} from "@/lib/browser-operation";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { submitCheckout } from "@/app/actions/checkout";
import {
  quoteCartShipping,
  type CartQuote,
} from "@/app/actions/shipping-quote";
import { TIENDA } from "@/config/tienda";
import { FreeShippingBar } from "@/components/free-shipping-bar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n/client";
import { couponRejectionMessage } from "@/lib/coupon-messages";
import { Label } from "@/components/ui/label";
import { describeIssue } from "@/lib/cart-issues";
import { cartSubtotal, useCart } from "@/lib/cart-store";
import { formatGs } from "@/lib/money";
import { TESTIDS } from "@/lib/testids";

/**
 * Los medios de pago, en el orden en que se ofrecen.
 *
 * Escritos acá y no importados de `@/db/schema`: este archivo corre en el
 * navegador y traerse drizzle sólo para conocer tres strings serían kilobytes
 * de más en la pantalla que más importa. El enum del servidor sigue siendo el
 * que manda — `submitCheckout` valida contra él.
 */
const PAGOS = ["transferencia", "contra_entrega", "tarjeta"] as const;
type MedioDePago = (typeof PAGOS)[number];

/** Título y aclaración de cada medio de pago. */
const PAGO_TEXTOS: Record<MedioDePago, [string, string]> = {
  transferencia: [
    t("checkout.pago.transferencia"),
    t("checkout.pago.transferencia.ayuda"),
  ],
  contra_entrega: [
    t("checkout.pago.contraEntrega"),
    t("checkout.pago.contraEntrega.ayuda"),
  ],
  tarjeta: [t("checkout.pago.tarjeta"), t("checkout.pago.tarjeta.ayuda")],
};

/**
 * Formulario de checkout.
 *
 * Ojo con lo que NO manda: ningún monto. El total que se ve acá es
 * informativo; el que se cobra lo calcula `createOrder` desde la DB.
 */
export function CheckoutForm({
  cities,
  pagoparEnabled = false,
  readyPayments = ["contra_entrega"],
  contactHref = null,
  prefill,
  hayCupones = false,
  nombreTienda = TIENDA.nombre,
}: {
  cities: string[];
  pagoparEnabled?: boolean;
  readyPayments?: readonly MedioDePago[];
  contactHref?: string | null;
  /**
   * ¿Esta tienda tiene algún cupón usable? Lo cuenta el servidor. Sin cupones
   * cargados el campo no se dibuja: cero filas = invisible.
   */
  hayCupones?: boolean;
  /**
   * Datos de la cuenta, cuando hay sesión de cliente (PR E.5). Los arma el
   * servidor desde la cookie; el checkout de invitado los recibe vacíos y se
   * comporta exactamente igual que siempre.
   *
   * Es un prefill y nada más: los campos siguen siendo editables, y el
   * servidor recalcula todo lo que importa igual que antes.
   */
  prefill?: { name?: string; phone?: string; email?: string };
  /** El nombre efectivo (panel o `tienda.ts`), resuelto en el servidor. */
  nombreTienda?: string;
}) {
  const router = useRouter();
  const { lines, clear, freeShipping } = useCart();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [docType, setDocType] = useState<"NINGUNO" | "CI" | "RUC">("NINGUNO");
  const [paymentMethod, setPaymentMethod] = useState<MedioDePago>(
    readyPayments[0] ?? "contra_entrega"
  );
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [isGift, setIsGift] = useState(false);
  const [city, setCity] = useState("");
  /**
   * El método de envío marcado. Es un **id**, nunca un precio: el precio lo
   * resuelve el servidor en cada cotización y lo vuelve a resolver al
   * confirmar. `null` = todavía no cotizamos, o esta tienda no configuró
   * métodos y sólo existe el implícito.
   */
  const [shippingMethodId, setShippingMethodId] = useState<number | null>(null);
  const [quote, setQuote] = useState<(CartQuote & { itemsKey: string }) | null>(
    null
  );
  const [isQuoting, setIsQuoting] = useState(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteTicket = useRef(0);
  /**
   * El total que ella ya vio y aceptó tras un aviso de cambio. Se manda para
   * comparar, nunca para cobrar (`expectedTotalPyg`). Se invalida en cuanto
   * cambia la ciudad o el carrito: a partir de ahí manda la cotización nueva.
   */
  const [acceptedTotal, setAcceptedTotal] = useState<number | null>(null);
  /**
   * El código de descuento. Se guarda el texto tipeado y se manda al servidor
   * con cada cotización: el descuento **nunca** se calcula acá (README
   * §"Reglas no negociables"). Lo que vuelve es cuánto descontó o por qué no.
   */
  const [couponInput, setCouponInput] = useState("");
  const [couponApplied, setCouponApplied] = useState("");
  const [couponOpen, setCouponOpen] = useState(false);

  const subtotal = cartSubtotal(lines);

  /**
   * Los medios de pago que esta pantalla puede ofrecer: los que habilita el
   * método de envío elegido, menos tarjeta si la tienda no tiene Pagopar.
   *
   * Es UX, no la defensa: `createOrder` vuelve a chequear que el método de
   * envío acepte el medio de pago, adentro de su transacción. Esconder un
   * radio no frena un POST armado a mano (ARCH.md §1 regla 2).
   */
  const opcionesDePago = (allowed: readonly MedioDePago[]): MedioDePago[] =>
    PAGOS.filter(
      (value) =>
        allowed.includes(value) &&
        readyPayments.includes(value) &&
        (value !== "tarjeta" || pagoparEnabled)
    );

  /**
   * Al cambiar de método de envío, el medio de pago que tenía marcado puede
   * dejar de existir —elegir el courier nacional después de haber marcado
   * contra entrega—. Se pasa al primero que sí valga en vez de dejar marcada
   * una opción que el servidor va a rechazar al confirmar.
   */
  const ajustarPago = (allowed: readonly MedioDePago[]): void => {
    const posibles = opcionesDePago(allowed);
    setPaymentMethod((actual) =>
      posibles.includes(actual) ? actual : (posibles[0] ?? actual)
    );
  };

  /**
   * Cotización del envío, disparada por lo que hace la compradora al tipear la
   * ciudad y no por un efecto — mismo criterio que la revalidación del
   * carrito. Es sólo lectura y no crea nada (ver `quoteCartShipping`), así que
   * se puede volver a pedir en cada corrección.
   */
  const itemsKey = lines
    .map((line) => `${line.variantId}x${line.qty}`)
    .join(",");

  const requestQuote = (
    nextCity: string,
    delayMs = 400,
    code = couponApplied,
    methodId: number | null = shippingMethodId
  ) => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);

    const target = nextCity.trim();
    const items = useCart
      .getState()
      .lines.map((line) => ({ variantId: line.variantId, qty: line.qty }));

    if (target.length < 2 || items.length === 0) {
      setQuote(null);
      setIsQuoting(false);
      return;
    }

    // Cada pedido lleva su número: la respuesta de una ciudad ya corregida
    // llega tarde y no tiene que pisar a la actual.
    const ticket = ++quoteTicket.current;
    setIsQuoting(true);
    quoteTimer.current = setTimeout(() => {
      void quoteCartShipping({
        items,
        city: target,
        couponCode: code || undefined,
        shippingMethodId: methodId ?? undefined,
      })
        .then((result) => {
          if (ticket !== quoteTicket.current) return;

          // El método que tenía marcado dejó de valer para esta ciudad (otra
          // zona, o el dueño lo apagó). Se marca el primero válido y se vuelve
          // a cotizar: el total que quedaría en pantalla salió con el método
          // rechazado, y no es el que se va a cobrar.
          const primero = result.methods[0];
          if (result.shippingMethodRejection !== null && primero) {
            setShippingMethodId(primero.id);
            ajustarPago(primero.allowedPaymentMethods);
            requestQuote(target, 0, code, primero.id);
            return;
          }

          setQuote(result.shipping ? { ...result, itemsKey } : null);
          setShippingMethodId(result.shippingMethodId);
          const elegido = result.methods.find(
            (method) => method.id === result.shippingMethodId
          );
          if (elegido) ajustarPago(elegido.allowedPaymentMethods);
          setIsQuoting(false);
        })
        .catch(() => {
          if (ticket !== quoteTicket.current) return;
          setQuote(null);
          setIsQuoting(false);
        });
    }, delayMs);
  };

  // Si el carrito cambió desde el slide-over, la cotización de recién ya no
  // corresponde: se muestra el subtotal del navegador hasta que se vuelva a
  // cotizar, en vez de un total de otro carrito.
  const currentQuote = quote?.itemsKey === itemsKey ? quote : null;
  // Un total aceptado deja de valer si el carrito cambió debajo.
  const expectedTotal = quote?.itemsKey === itemsKey ? acceptedTotal : null;

  /**
   * El método marcado y lo que habilita. Sin cotización todavía —o en una
   * tienda que no configuró métodos— quedan los tres medios de pago de
   * siempre: el checkout de antes, sin una sola pantalla nueva.
   */
  const metodoElegido =
    currentQuote?.methods.find((method) => method.id === shippingMethodId) ??
    null;
  const pagosVisibles = opcionesDePago(
    metodoElegido?.allowedPaymentMethods ?? PAGOS
  );
  /**
   * ¿Esta tienda tiene métodos de verdad, o sólo el implícito? Con el
   * implícito no se dibuja ninguna pregunta nueva: es literalmente el envío a
   * domicilio de siempre, y una sola opción no es una elección.
   */
  const metodosConfigurados =
    currentQuote?.methods.some((method) => method.id !== null) ?? false;

  if (lines.length === 0) {
    return (
      <div className="border-border rounded-xl border border-dashed p-10 text-center">
        <p className="font-medium">{t("checkout.carritoVacio")}</p>
        <Button className="mt-4" onClick={() => router.push("/")}>
          {t("checkout.verProductos")}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        const data = new FormData(event.currentTarget);

        startTransition(async () => {
          const payload = {
            items: lines.map((line) => ({
              variantId: line.variantId,
              qty: line.qty,
            })),
            customerName: String(data.get("customerName") ?? ""),
            customerPhone: String(data.get("customerPhone") ?? ""),
            customerEmail: String(data.get("customerEmail") ?? ""),
            docType,
            docNumber: String(data.get("docNumber") ?? ""),
            isConsumidorFinal: docType === "NINGUNO",
            shipCity: String(data.get("shipCity") ?? ""),
            shipBarrio: String(data.get("shipBarrio") ?? ""),
            shipAddress: String(data.get("shipAddress") ?? ""),
            shipReference: String(data.get("shipReference") ?? ""),
            paymentMethod,
            // El id, nunca el precio: el servidor lo re-valida y lo re-cotiza.
            shippingMethodId: shippingMethodId ?? undefined,
            couponCode: couponApplied || undefined,
            marketingOptIn,
            isGift,
            giftNote: String(data.get("giftNote") ?? ""),
            // Lo que hay en pantalla, para que el servidor pueda avisar si no
            // coincide con lo que corresponde cobrar. Si nunca vio un total
            // —no llegó a poner la ciudad— no va nada y no hay nada que
            // comparar.
            expectedTotalPyg:
              expectedTotal ?? currentQuote?.totalPyg ?? undefined,
          };
          const operationKey = await browserOperation("checkout", payload);
          const result = await submitCheckout({ ...payload, operationKey });

          if (!result.ok) {
            setError(result.error);
            result.issues?.forEach((issue) =>
              toast.error(describeIssue(issue))
            );
            if (result.totalChanged) {
              // El pedido NO se creó. Se guarda el total nuevo —el que acaba
              // de calcular el servidor— para que el segundo click pase, y se
              // vuelve a cotizar para que la pantalla muestre de dónde sale.
              setAcceptedTotal(result.totalChanged.after);
              // Sin esperar los 400ms del debounce: la pantalla tiene que
              // mostrar el número nuevo antes de que ella vuelva a apretar.
              requestQuote(city, 0);
            }
            return;
          }

          finishBrowserOperation("checkout");
          clear();
          // La pasarela de Pagopar vive en otro dominio: `router.push` es
          // para rutas internas, así que un link externo necesita navegación
          // real del navegador.
          if (/^https?:\/\//.test(result.redirectTo)) {
            window.location.href = result.redirectTo;
          } else {
            router.push(result.redirectTo);
          }
        });
      }}
    >
      {error ? (
        <p className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="customerName">{t("checkout.nombre")}</Label>
          <Input
            id="customerName"
            name="customerName"
            data-testid={TESTIDS.checkoutName}
            required
            minLength={3}
            defaultValue={prefill?.name ?? ""}
            autoComplete="name"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="customerPhone">{t("checkout.whatsapp")}</Label>
          <Input
            id="customerPhone"
            name="customerPhone"
            data-testid={TESTIDS.checkoutPhone}
            required
            defaultValue={prefill?.phone ?? ""}
            placeholder={t("checkout.whatsapp.placeholder")}
            inputMode="tel"
            autoComplete="tel"
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="customerEmail">
          {t("checkout.email")}{" "}
          <span className="text-muted-foreground font-normal">
            {t("checkout.opcional")}
          </span>
        </Label>
        <Input
          id="customerEmail"
          name="customerEmail"
          type="email"
          inputMode="email"
          defaultValue={prefill?.email ?? ""}
          autoComplete="email"
          placeholder={t("checkout.email.placeholder")}
        />
        <p className="text-muted-foreground text-xs">
          {t("checkout.email.ayuda")}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="docType">{t("checkout.documento")}</Label>
          <select
            id="docType"
            name="docType"
            data-testid={TESTIDS.checkoutDocType}
            value={docType}
            onChange={(event) =>
              setDocType(event.target.value as typeof docType)
            }
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="NINGUNO">{t("checkout.documento.ninguno")}</option>
            <option value="CI">{t("checkout.documento.ci")}</option>
            <option value="RUC">{t("checkout.documento.ruc")}</option>
          </select>
        </div>
        {docType !== "NINGUNO" ? (
          <div className="grid gap-1.5">
            <Label htmlFor="docNumber">
              {docType === "RUC"
                ? t("checkout.documento.rucLabel")
                : t("checkout.documento.ciLabel")}
            </Label>
            <Input
              id="docNumber"
              name="docNumber"
              data-testid={TESTIDS.checkoutDocNumber}
              required
              inputMode="numeric"
            />
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="shipCity">{t("checkout.ciudad")}</Label>
          <Input
            id="shipCity"
            name="shipCity"
            data-testid={TESTIDS.checkoutCity}
            required
            list="ciudades"
            autoComplete="address-level2"
            value={city}
            onChange={(event) => {
              setCity(event.target.value);
              // Otra ciudad es otro envío: lo que aceptó para la anterior no
              // vale más.
              setAcceptedTotal(null);
              requestQuote(event.target.value);
            }}
          />
          <datalist id="ciudades">
            {cities.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="shipBarrio">{t("checkout.barrio")}</Label>
          <Input id="shipBarrio" name="shipBarrio" />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="shipAddress">{t("checkout.direccion")}</Label>
        <Input
          id="shipAddress"
          name="shipAddress"
          data-testid={TESTIDS.checkoutAddress}
          required
          minLength={5}
          autoComplete="street-address"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="shipReference">{t("checkout.referencia")}</Label>
        <Input
          id="shipReference"
          name="shipReference"
          placeholder={t("checkout.referencia.placeholder")}
        />
      </div>

      {/*
        Cómo se entrega, antes de con qué se paga: es el método el que decide
        qué medios de pago existen. Sólo se dibuja si la tienda configuró
        métodos de verdad — con el implícito no hay nada que elegir.
      */}
      {metodosConfigurados && currentQuote ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">
            {t("checkout.envio.pregunta")}
          </legend>
          {currentQuote.methods.map((method) => (
            <label
              key={method.id ?? "implicito"}
              className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <input
                type="radio"
                name="shippingMethodId"
                data-testid={TESTIDS.checkoutShippingMethod}
                data-slug={method.slug}
                value={String(method.id ?? "")}
                checked={shippingMethodId === method.id}
                onChange={() => {
                  setShippingMethodId(method.id);
                  ajustarPago(method.allowedPaymentMethods);
                  // Otro método es otro flete: lo que aceptó para el anterior
                  // no vale más, y el total se vuelve a pedir sin debounce.
                  setAcceptedTotal(null);
                  requestQuote(city, 0, couponApplied, method.id);
                }}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{method.name}</span>
                  <span className="tabular-nums">
                    {method.isFree
                      ? t("checkout.envioGratis")
                      : formatGs(method.shippingPyg)}
                  </span>
                </span>
                {method.description ? (
                  <span className="text-muted-foreground block text-xs">
                    {method.description}
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {/* Una tienda con métodos configurados y ninguno que llegue a esa
          ciudad. Decirlo acá es mucho mejor que dejarla confirmar y recibir
          el rechazo del servidor con el formulario entero completado. */}
      {currentQuote && currentQuote.methods.length === 0 ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {t("checkout.envio.sinMetodos")}
        </p>
      ) : null}

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">
          {t("checkout.pago.pregunta")}
        </legend>
        {pagosVisibles.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("checkout.pago.sinOpciones")}
          </p>
        ) : null}
        {pagosVisibles.map((value) => {
          const [label, hint] = PAGO_TEXTOS[value];
          return (
            <label
              key={value}
              className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm"
            >
              <input
                type="radio"
                name="paymentMethod"
                data-testid={TESTIDS.checkoutPaymentMethod}
                data-value={value}
                value={value}
                checked={paymentMethod === value}
                onChange={() => setPaymentMethod(value)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">{label}</span>
                <span className="text-muted-foreground block text-xs">
                  {hint}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <div className="grid gap-2">
        <label className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            name="isGift"
            checked={isGift}
            onChange={(event) => setIsGift(event.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium">{t("checkout.regalo")}</span>
            <span className="text-muted-foreground block text-xs">
              {t("checkout.regalo.ayuda")}
            </span>
          </span>
        </label>

        {isGift ? (
          <div className="grid gap-1.5">
            <Label htmlFor="giftNote">{t("checkout.regalo.mensaje")}</Label>
            <textarea
              id="giftNote"
              name="giftNote"
              rows={2}
              maxLength={300}
              placeholder={t("checkout.regalo.mensaje.placeholder")}
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
            />
          </div>
        ) : null}
      </div>

      {/* Sin tildar de entrada y con el texto completo al lado: un permiso
          pre-aceptado no es un permiso. Lo que se guarda es la respuesta, no
          la ausencia de respuesta (ver `orders.marketing_opt_in`). */}
      <label className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          name="marketingOptIn"
          checked={marketingOptIn}
          onChange={(event) => setMarketingOptIn(event.target.checked)}
          className="mt-1"
        />
        <span>
          <span className="font-medium">{t("checkout.novedades")}</span>
          <span className="text-muted-foreground block text-xs">
            {t("checkout.novedades.ayuda", { tienda: nombreTienda })}
          </span>
        </span>
      </label>

      {/* Lo que el servidor encontró al re-preciar. Sin esto, un carrito con
          stock parcial mostraba un total más chico que el carrito —el
          re-precio recorta la cantidad a lo que hay— sin decir por qué, y el
          error recién aparecía al confirmar. */}
      {currentQuote && currentQuote.issues.length > 0 ? (
        <ul className="border-border bg-muted/40 space-y-1 rounded-lg border p-3 text-xs">
          {currentQuote.issues.map((issue) => (
            <li key={`${issue.type}-${issue.variantId}`}>
              {describeIssue(issue)}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        El campo de descuento, plegado. Sólo existe si la tienda tiene cupones
        cargados: cero filas = nada visible (guardarraíl 1 del PLAN.md).
      */}
      {hayCupones ? (
        <div className="border-border border-t pt-4 text-sm">
          {couponOpen || couponApplied ? (
            <div className="grid gap-2">
              <Label htmlFor="couponCode">{t("checkout.cupon.label")}</Label>
              <div className="flex gap-2">
                <Input
                  id="couponCode"
                  value={couponInput}
                  onChange={(event) =>
                    setCouponInput(event.target.value.toUpperCase())
                  }
                  placeholder={t("checkout.cupon.placeholder")}
                  maxLength={40}
                  autoComplete="off"
                  className="uppercase"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={isQuoting || couponInput.trim() === ""}
                  onClick={() => {
                    const code = couponInput.trim().toUpperCase();
                    setCouponApplied(code);
                    // El total lo recalcula el servidor: se re-cotiza sin
                    // esperar el debounce, con el código puesto.
                    setAcceptedTotal(null);
                    requestQuote(city, 0, code);
                  }}
                >
                  {t("checkout.cupon.aplicar")}
                </Button>
              </div>

              {currentQuote?.couponRejection ? (
                <p role="alert" className="text-destructive text-xs">
                  {couponRejectionMessage(currentQuote.couponRejection, {
                    minOrderPyg: currentQuote.couponMinOrderPyg,
                    subtotalPyg: currentQuote.subtotalPyg,
                  })}
                </p>
              ) : null}

              {currentQuote && currentQuote.discountPyg > 0 ? (
                <p className="text-muted-foreground text-xs">
                  {t("checkout.cupon.aplicado", {
                    codigo: currentQuote.couponCode ?? "",
                    monto: formatGs(currentQuote.discountPyg),
                  })}{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => {
                      setCouponInput("");
                      setCouponApplied("");
                      setAcceptedTotal(null);
                      requestQuote(city, 0, "");
                    }}
                  >
                    {t("checkout.cupon.quitar")}
                  </button>
                </p>
              ) : null}

              {city.trim().length < 2 ? (
                <p className="text-muted-foreground text-xs">
                  {t("checkout.cupon.faltaCiudad")}
                </p>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              className="text-muted-foreground underline"
              onClick={() => setCouponOpen(true)}
            >
              {t("checkout.cupon.pregunta")}
            </button>
          )}
        </div>
      ) : null}

      <div className="border-border grid gap-1 border-t pt-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">
            {t("checkout.subtotal")}
          </span>
          <span className="tabular-nums">
            {formatGs(currentQuote?.subtotalPyg ?? subtotal)}
          </span>
        </div>

        {/* El descuento se muestra **arriba** del envío y con signo, porque es
            lo que explica por qué el total no es la suma de lo de arriba. */}
        {currentQuote && currentQuote.discountPyg > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              {currentQuote.couponCode
                ? t("checkout.descuentoCon", {
                    codigo: currentQuote.couponCode,
                  })
                : t("checkout.descuento")}
            </span>
            <span className="tabular-nums">
              −{formatGs(currentQuote.discountPyg)}
            </span>
          </div>
        ) : null}

        {currentQuote?.shipping ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {currentQuote.shipping.match === "exacta"
                  ? t("checkout.envioCon", {
                      zona: currentQuote.shipping.zoneName,
                    })
                  : t("checkout.envio")}
                {isQuoting ? "…" : ""}
              </span>
              <span className="tabular-nums">
                {currentQuote.shipping.isFree
                  ? t("checkout.envioGratis")
                  : formatGs(currentQuote.shipping.shippingPyg)}
              </span>
            </div>
            <div
              className="flex items-center justify-between pt-1"
              data-testid={TESTIDS.checkoutTotal}
            >
              <span className="font-medium">{t("checkout.total")}</span>
              <span className="text-base font-semibold tabular-nums">
                {formatGs(currentQuote.totalPyg ?? 0)}
              </span>
            </div>
          </>
        ) : null}
      </div>

      {/* La cotización es para mostrar. El total que se cobra lo recalcula
          `createOrder` desde la DB cuando se confirma, así que decirlo acá no
          es una nota al pie: es lo que pasa. */}
      <p className="text-muted-foreground -mt-3 text-xs">
        {!currentQuote?.shipping
          ? t("checkout.nota.faltaCiudad")
          : currentQuote.shipping.match === "mas_cara"
            ? t("checkout.nota.masCara", {
                zona: currentQuote.shipping.zoneName,
              })
            : // `exacta` y `sin_zonas` comparten esta línea: en la segunda el
              // envío es ₲0 de verdad, así que no hay nada que aclararle a
              // quien compra (el que tiene que configurar zonas es el dueño).
              t("checkout.nota.exacta")}
      </p>

      {/* Con la ciudad puesta el número es el de su zona; sin ella, el que
          dejó la revalidación del carrito, que se dibuja aclarado. */}
      <FreeShippingBar
        progress={currentQuote?.freeShipping ?? freeShipping}
        subtotalPyg={currentQuote?.subtotalPyg ?? subtotal}
      />

      <Button
        type="submit"
        size="lg"
        data-testid={TESTIDS.checkoutSubmit}
        disabled={
          isPending ||
          pagosVisibles.length === 0 ||
          currentQuote?.methods.length === 0
        }
      >
        {isPending ? t("checkout.confirmando") : t("checkout.confirmar")}
      </Button>
      {contactHref &&
      (pagosVisibles.length === 0 || currentQuote?.methods.length === 0) ? (
        <a
          href={contactHref}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          {t("checkout.consultar")}
        </a>
      ) : null}
    </form>
  );
}
