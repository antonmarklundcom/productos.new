import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EditOrderForm } from "@/components/admin/edit-order-form";
import { OrderActions } from "@/components/admin/order-actions";
import { OrderNotes, type OrderNoteView } from "@/components/admin/order-notes";
import { OrderStatusBadge } from "@/components/admin/order-status-badge";
import { RefundForm } from "@/components/admin/refund-form";
import { ReturnForm } from "@/components/admin/return-form";
import { ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/order-labels";
import { ReceiptReview } from "@/components/admin/receipt-review";
import { listAdminShippingMethods } from "@/domain/admin-shipping-methods";
import { getAdminOrder, isRecoverableStatus } from "@/domain/admin-orders";
import { ORDER_TRANSITIONS, getOrderEvents } from "@/domain/orders";
import { listOrderNotes } from "@/domain/order-notes";
import { listReceipts } from "@/domain/receipts";
import {
  canRegisterReturn,
  listReturnsForOrder,
  returnableQuantities,
} from "@/domain/returns";
import { getPaymentForOrder } from "@/domain/payment-recovery";
import {
  buyerWaLink,
  followUpMessage,
  recoveryMessage,
} from "@/domain/order-messages";
import { adminActor } from "@/lib/admin-guard";
import { getDatosBancarios } from "@/lib/comercio";
import { formatGs, ivaIncluded } from "@/lib/money";
import { can } from "@/lib/permissions";
import { VENDEDOR_TRANSITIONS } from "@/lib/session";
import { formatDateTimePY, formatPhonePY } from "@/lib/py";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";
import { getDb } from "@/db";
import { notificationOutbox } from "@/db/schema";
import { eq } from "drizzle-orm";
import { OrderNotices } from "@/components/admin/order-notices";

export const metadata: Metadata = { title: t("panel.pedido.meta") };

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Params;
}) {
  const actor = await adminActor();
  const { id } = await params;
  const orderId = Number(id);
  if (!Number.isInteger(orderId) || orderId <= 0) notFound();

  const found = await getAdminOrder(orderId);
  if (!found) notFound();

  const { order, items, editability } = found;
  const notices =
    actor.role === "owner"
      ? await getDb()
          .select({
            id: notificationOutbox.id,
            kind: notificationOutbox.kind,
            state: notificationOutbox.state,
            attempts: notificationOutbox.attempts,
          })
          .from(notificationOutbox)
          .where(eq(notificationOutbox.orderId, order.id))
      : [];
  const [events, receipts, banco, notes, shippingMethods, payment] =
    await Promise.all([
      getOrderEvents(order.id),
      listReceipts(order.id),
      // Una sola lectura por pantalla: `recoveryMessage` ya no los busca solo
      // (ver `src/domain/order-messages.ts`).
      getDatosBancarios(),
      listOrderNotes(order.id),
      // Sugerencias de courier en el paso de despacho — nombres nada más, no
      // hace falta la ficha completa del método.
      listAdminShippingMethods(),
      // Reembolso total o parcial: el pago cobrado de este pedido, sin
      // importar su estado — un pedido `enviado` con pago es justo el caso de
      // uso (ver `getPaymentForOrder`).
      getPaymentForOrder(order.id),
    ]);

  // Devoluciones de mercadería (capability `devoluciones`, los roles de
  // `stock`). Sin el permiso ni se consultan.
  const verDevoluciones = can(actor.role, "devoluciones");
  const [devoluciones, devolvibles] = verDevoluciones
    ? await Promise.all([
        listReturnsForOrder(order.id),
        returnableQuantities(order.id),
      ])
    : [[], []];

  const noteViews: OrderNoteView[] = notes.map((note) => ({
    id: note.id,
    body: note.body,
    author: note.actorName ?? note.actor,
    createdAt: formatDateTimePY(note.createdAt),
  }));

  // Sólo las activas: una desactivada no es algo que el mostrador debería
  // volver a tipear como courier.
  const courierSuggestions = shippingMethods
    .filter((method) => method.isActive)
    .map((method) => method.name);

  const hasTracking = Boolean(
    order.trackingCarrier || order.trackingCode || order.trackingUrl
  );

  // Los dos mensajes salen del mismo armador que usa "Por cobrar": el link
  // tokenizado y la regla de no listar lo comprado se escriben una sola vez
  // (ver `src/domain/order-messages.ts`).
  const waHref = buyerWaLink(order, followUpMessage(order));
  const recoveryHref = isRecoverableStatus(order.status)
    ? buyerWaLink(order, recoveryMessage(order, banco))
    : null;

  const verPrecios = can(actor.role, "precios");
  const verComprobantes = can(actor.role, "comprobantes");
  // == S17 == Reembolso total o parcial (owner-only, como el resto de "pagos sin
  // pedido vivo") y edición de pedido (owner/staff, capability `pedidos.editar`
  // de O16). `editability.editable` ya viene resuelto por `getAdminOrder` —
  // acá sólo se decide si el rol puede *ver* el botón; el servidor vuelve a
  // chequear las dos cosas dentro de `editPendingOrder`.
  const verReembolsos = can(actor.role, "reembolsos");
  const puedeEditar = can(actor.role, "pedidos.editar");
  // Métodos de envío activos que aceptan el medio de pago del pedido: es un
  // filtro de UX para no ofrecer una combinación que el servidor va a
  // rechazar (ARCH.md "cómo se entrega decide con qué se paga") — la
  // decisión de verdad la vuelve a tomar `editPendingOrder`.
  const editShippingMethods = shippingMethods.filter(
    (method) =>
      method.isActive &&
      method.allowedPaymentMethods.includes(order.paymentMethod)
  );

  // La máquina de estados dice qué transiciones existen desde acá; el rol dice
  // cuáles de ésas puede apretar quien está mirando. `advanceOrder` vuelve a
  // chequear las dos cosas del lado del servidor (`assertCanTransitionTo` +
  // `transitionOrder`), así que un botón fabricado a mano no mueve nada.
  const nextStatuses = ORDER_TRANSITIONS[order.status].filter(
    (status) =>
      status !== "reembolsado" &&
      (actor.role !== "vendedor" || VENDEDOR_TRANSITIONS.includes(status))
  );

  return (
    <div>
      <Link href="/admin/pedidos" className="text-muted-foreground text-sm">
        {t("panel.porCobrar.volver")}
      </Link>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight tabular-nums">
          {order.orderNumber}
        </h1>
        <OrderStatusBadge status={order.status} />
      </div>
      <p className="text-muted-foreground mt-1 text-sm">
        {formatDateTimePY(order.createdAt)} ·{" "}
        {PAYMENT_METHOD_LABEL[order.paymentMethod]}
      </p>
      <OrderNotices orderId={order.id} notices={notices} />
      {order.paymentMethod === "tarjeta" &&
      ["starting", "unknown"].includes(order.cardCheckoutState) ? (
        <p role="alert" className="mt-4 rounded-lg border p-3 text-sm">
          {t("panel.pedido.tarjetaIncierta")}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/admin/pedidos/${order.id}/imprimir`}
          data-testid={TESTIDS.orderPrintLink}
          className="border-border rounded-lg border px-4 py-2 text-sm font-medium"
        >
          {t("panel.pedido.imprimirRemito")}
        </Link>
        {waHref ? (
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border rounded-lg border px-4 py-2 text-sm font-medium"
          >
            {t("panel.pedido.escribir")}
          </a>
        ) : null}
        {recoveryHref ? (
          <a
            href={recoveryHref}
            target="_blank"
            rel="noopener noreferrer"
            className="border-border rounded-lg border px-4 py-2 text-sm font-medium"
          >
            {t("panel.pedido.mandarDatos")}
          </a>
        ) : null}
      </div>

      {/* Arriba de todo y no en la ficha del cliente: esto se mira mientras
          se arma el paquete, y un dato que hay que scrollear para encontrar
          es un dato que se descubre después de cerrar la caja. */}
      {order.isGift ? (
        <section className="border-border bg-muted/40 mt-4 rounded-lg border p-3">
          <h2 className="text-sm font-medium">{t("panel.pedido.esRegalo")}</h2>
          {order.giftNote ? (
            <p className="mt-1 text-sm whitespace-pre-line">
              “{order.giftNote}”
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">
              {t("panel.pedido.sinMensaje")}
            </p>
          )}
        </section>
      ) : null}

      {receipts.length > 0 && verComprobantes ? (
        <section className="mt-6">
          <h2 className="font-medium">{t("panel.pedido.comprobantes")}</h2>
          <div className="mt-2">
            <ReceiptReview
              receipts={receipts.map((receipt) => ({
                id: receipt.id,
                mime: receipt.mime,
                bytes: receipt.bytes,
                review: receipt.review,
                note: receipt.note,
                uploadedAt: formatDateTimePY(receipt.uploadedAt),
              }))}
            />
          </div>
        </section>
      ) : null}

      {/*
        Los ítems los ven los tres roles —sin saber qué armar no se despacha
        nada— pero los montos no: el vendedor arma el paquete, no audita la
        caja (ARCH.md §1). Lo que le queda es qué producto, qué SKU y cuántas
        unidades, que es exactamente su trabajo.
      */}
      <section className="mt-6">
        <h2 className="font-medium">{t("panel.pedido.items")}</h2>
        <ul className="divide-border mt-2 divide-y text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between gap-4 py-2">
              <span>
                {item.nameSnapshot}
                <span className="text-muted-foreground"> × {item.qty}</span>
                <span className="text-muted-foreground block text-xs">
                  {item.skuSnapshot}
                  {verPrecios
                    ? t("panel.pedido.itemDetalle", {
                        precio: formatGs(item.unitPricePyg),
                        tasa: item.ivaRate,
                      })
                    : ""}
                </span>
              </span>
              {verPrecios ? (
                <span className="shrink-0 tabular-nums">
                  {formatGs(item.lineTotalPyg)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>

        {verPrecios ? (
          <>
            <dl className="border-border mt-3 grid grid-cols-2 gap-1 border-t pt-3 text-sm">
              <dt className="text-muted-foreground">
                {t("panel.pedido.subtotal")}
              </dt>
              <dd className="text-right tabular-nums">
                {formatGs(order.subtotalPyg)}
              </dd>
              {order.discountPyg > 0 ? (
                <>
                  <dt className="text-muted-foreground">
                    {order.couponCode
                      ? t("panel.pedido.descuentoCon", {
                          codigo: order.couponCode,
                        })
                      : t("panel.pedido.descuento")}
                  </dt>
                  <dd className="text-right tabular-nums">
                    −{formatGs(order.discountPyg)}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">
                {t("panel.pedido.envio")}
              </dt>
              <dd className="text-right tabular-nums">
                {formatGs(order.shippingPyg)}
              </dd>
              <dt className="font-medium">{t("panel.pedido.total")}</dt>
              {/* == S17 == data-testid: el e2e de edición de pedido lee este
                  total antes y después, y nunca lo calcula del lado del
                  navegador (siempre viene de `order.totalPyg`, releído del
                  servidor tras la edición). */}
              <dd
                data-testid={TESTIDS.adminOrderTotal}
                className="text-right font-semibold tabular-nums"
              >
                {formatGs(order.totalPyg)}
              </dd>
            </dl>

            {/* El IVA está INCLUIDO en el total (convención PY): esto es el
            desglose de lo que ya se cobró, no algo que se suma. */}
            <dl className="border-border bg-muted/40 mt-3 grid grid-cols-2 gap-1 rounded-lg border p-3 text-xs">
              <dt className="text-muted-foreground col-span-2 font-medium">
                {t("panel.pedido.ivaIncluido")}
              </dt>
              <dt className="text-muted-foreground">
                {t("panel.pedido.iva10")}
              </dt>
              <dd className="text-right tabular-nums">
                {formatGs(order.iva10Pyg)}
              </dd>
              <dt className="text-muted-foreground">
                {t("panel.pedido.iva5")}
              </dt>
              <dd className="text-right tabular-nums">
                {formatGs(order.iva5Pyg)}
              </dd>
              <dt className="text-muted-foreground">
                {t("panel.pedido.gravado")}
              </dt>
              <dd className="text-right tabular-nums">
                {formatGs(order.totalPyg - order.iva10Pyg - order.iva5Pyg)}
              </dd>
            </dl>

            <details className="mt-2">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {t("panel.pedido.ivaPorLinea")}
              </summary>
              <ul className="text-muted-foreground mt-2 space-y-1 text-xs">
                {items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-4">
                    <span>
                      {t("panel.pedido.lineaIva", {
                        nombre: item.nameSnapshot,
                        tasa: item.ivaRate,
                      })}
                    </span>
                    <span className="tabular-nums">
                      {formatGs(ivaIncluded(item.lineTotalPyg, item.ivaRate))}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : null}
      </section>

      {/* == S17 == Reembolso total o parcial en la ficha (O14 dejó `getPaymentForOrder`
          + `refundedPyg`): mismo componente que usa "pagos sin pedido vivo",
          owner-only como el resto del ABM de plata. Sin pago acreditado no
          hay nada que devolver, así que la sección ni se dibuja. */}
      {payment && verReembolsos ? (
        <section className="mt-6">
          <h2 className="font-medium">{t("panel.reembolso.titulo")}</h2>
          <div className="mt-2">
            <RefundForm
              paymentId={payment.paymentId}
              orderNumber={order.orderNumber}
              amountPyg={payment.amountPyg}
              refundedPygInicial={payment.refundedPyg}
              allowSettled
            />
          </div>
        </section>
      ) : null}

      {/* Devoluciones de mercadería: qué volvió y si fue al stock. La plata es
          el reembolso de arriba, aparte y owner-only — por eso la línea del
          final apunta ahí en vez de hacerlo desde acá. */}
      {verDevoluciones ? (
        <section className="mt-6" data-testid={TESTIDS.adminReturnsBlock}>
          <h2 className="font-medium">{t("panel.pedido.devoluciones")}</h2>
          {devoluciones.length === 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              {t("panel.pedido.devoluciones.ninguna")}
            </p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {devoluciones.map((devolucion) => (
                <li
                  key={devolucion.id}
                  className="border-border rounded-lg border p-3 text-sm"
                >
                  <ul>
                    {devolucion.items.map((item, index) => (
                      <li key={index}>
                        {t("panel.devoluciones.item", {
                          n: item.qty,
                          producto: item.name,
                        })}{" "}
                        <span className="text-muted-foreground text-xs">
                          ·{" "}
                          {item.restocked
                            ? t("panel.devoluciones.repuesto")
                            : t("panel.devoluciones.noRepuesto")}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 whitespace-pre-line">
                    {t("panel.devoluciones.motivo", {
                      motivo: devolucion.reason,
                    })}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {devolucion.actorName ?? devolucion.actor} ·{" "}
                    {formatDateTimePY(devolucion.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3">
            {canRegisterReturn(order.status) ? (
              <ReturnForm
                orderId={order.id}
                lines={devolvibles.map((line) => ({
                  orderItemId: line.orderItemId,
                  name: line.name,
                  ordered: line.ordered,
                  remaining: line.remaining,
                }))}
              />
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("panel.pedido.devoluciones.noCorresponde")}
              </p>
            )}
          </div>
          <p className="text-muted-foreground mt-2 text-xs">
            {t("panel.pedido.devoluciones.reembolso")}
          </p>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="font-medium">{t("panel.pedido.cliente")}</h2>
        <dl className="mt-2 grid gap-1 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("panel.pedido.nombre")}
            </dt>
            <dd className="text-right">{order.customerName}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("panel.pedido.whatsapp")}
            </dt>
            <dd className="text-right tabular-nums">
              {formatPhonePY(order.customerPhone)}
            </dd>
          </div>
          {order.customerEmail ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {t("panel.pedido.email")}
              </dt>
              <dd className="text-right break-all">{order.customerEmail}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("panel.pedido.documento")}
            </dt>
            <dd className="text-right tabular-nums">
              {order.docType === "NINGUNO"
                ? t("panel.pedido.consumidorFinal")
                : t("panel.pedido.docConNumero", {
                    tipo: order.docType,
                    numero: order.docNumber ?? "",
                  })}
            </dd>
          </div>
          {/* Se muestra sólo si contestó: en los pedidos anteriores a la
              casilla la columna es NULL, y "no se preguntó" no es un "no". */}
          {order.marketingOptIn !== null ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {t("panel.pedido.novedades")}
              </dt>
              <dd className="text-right">
                {order.marketingOptIn
                  ? t("panel.pedido.acepta")
                  : t("panel.pedido.noAcepta")}
                {order.marketingOptInAt ? (
                  <span className="text-muted-foreground block text-xs tabular-nums">
                    {formatDateTimePY(order.marketingOptInAt)}
                  </span>
                ) : null}
              </dd>
            </div>
          ) : null}
          {/* Cómo hay que entregarlo, antes de la dirección: si es retiro en
              el local no hay nada que despachar, y si es la moto propia sale
              alguien. Snapshot del momento de la compra: cambiarle el nombre
              al método hoy no reescribe este pedido. Los pedidos anteriores a
              `shipping_methods` no tienen ninguno y no muestran la fila. */}
          {order.shippingMethodName ? (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">
                {t("panel.pedido.metodoEnvio")}
              </dt>
              <dd className="text-right">{order.shippingMethodName}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("panel.pedido.envio")}</dt>
            <dd className="max-w-[60%] text-right">
              {order.shipAddress}
              {order.shipBarrio ? `, ${order.shipBarrio}` : ""},{" "}
              {order.shipCity}
              {order.shipReference ? (
                <span className="text-muted-foreground block text-xs">
                  {t("panel.pedido.referencia", {
                    referencia: order.shipReference,
                  })}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
      </section>

      {/* Sólo si hay algo cargado: los pedidos que no pasaron por `enviado`
          con courier/guía no muestran una sección vacía (plan-operacion §6.1). */}
      {hasTracking ? (
        <section className="mt-6" data-testid={TESTIDS.orderTrackingBlock}>
          <h2 className="font-medium">{t("panel.pedido.tracking.titulo")}</h2>
          <dl className="mt-2 grid gap-1 text-sm">
            {order.trackingCarrier ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("panel.pedido.tracking.courier")}
                </dt>
                <dd className="text-right">{order.trackingCarrier}</dd>
              </div>
            ) : null}
            {order.trackingCode ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("panel.pedido.tracking.guia")}
                </dt>
                <dd className="text-right tabular-nums">
                  {order.trackingCode}
                </dd>
              </div>
            ) : null}
            {order.trackingUrl ? (
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("panel.pedido.tracking.link")}
                </dt>
                <dd className="max-w-[60%] text-right break-all">
                  <a
                    href={order.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {order.trackingUrl}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="font-medium">{t("panel.pedido.cambiarEstado")}</h2>
        {nextStatuses.length === 0 ? (
          // Dos motivos distintos para no tener botones, y decir el que no es
          // manda a alguien a buscar un problema que no existe: el pedido
          // terminó, o este rol no despacha desde acá.
          <p className="text-muted-foreground mt-2 text-sm">
            {ORDER_TRANSITIONS[order.status].filter(
              (status) => status !== "reembolsado"
            ).length === 0
              ? t("panel.pedido.estadoFinal")
              : t("panel.pedido.sinPermiso")}
          </p>
        ) : (
          <div className="mt-2">
            <OrderActions
              orderId={order.id}
              nextStatuses={[...nextStatuses]}
              courierSuggestions={courierSuggestions}
            />
          </div>
        )}
      </section>

      {/* == S17 == Editar un pedido antes del pago (O16 dejó el dominio y la
          acción; acá va la piel). `editability` ya viene resuelto por
          `getAdminOrder` con la misma regla que revisa el servidor al
          confirmar — este botón puede mentir por treinta segundos si justo
          entra el pago, y por eso `editPendingOrder` la vuelve a chequear con
          la fila bloqueada. Sólo owner/staff: el vendedor no ve montos. */}
      {puedeEditar ? (
        <section className="mt-6">
          <h2 className="font-medium">{t("panel.pedido.editar.titulo")}</h2>
          {editability.editable ? (
            <div className="mt-2">
              <EditOrderForm
                orderId={order.id}
                customerPhone={order.customerPhone}
                items={items.map((item) => ({
                  orderItemId: item.id,
                  nameSnapshot: item.nameSnapshot,
                  qty: item.qty,
                }))}
                shipCity={order.shipCity}
                shipAddress={order.shipAddress}
                shipReference={order.shipReference}
                shippingMethods={editShippingMethods.map((method) => ({
                  id: method.id,
                  name: method.name,
                }))}
                currentShippingMethodId={order.shippingMethodId}
              />
            </div>
          ) : (
            <p className="text-muted-foreground mt-2 text-sm">
              {editability.reason === "tarjeta"
                ? t("panel.pedido.editar.motivoTarjeta")
                : editability.reason === "pagado"
                  ? t("panel.pedido.editar.motivoPagado")
                  : t("panel.pedido.editar.motivoEstado")}
            </p>
          )}
        </section>
      ) : null}

      <section className="mt-6">
        <h2 className="font-medium">{t("panel.pedido.notas")}</h2>
        <div className="mt-2">
          <OrderNotes orderId={order.id} notes={noteViews} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-medium">{t("panel.pedido.historial")}</h2>
        {/* == S17 == `payment_reminder_sent_at` (O14/O15) no es una
            transición — no tiene fila en `order_events` — así que va aparte
            y no adentro de la lista de abajo. */}
        {order.paymentReminderSentAt ? (
          <p className="text-muted-foreground mt-2 text-xs">
            {t("panel.pedido.recordatorioEnviado", {
              fecha: formatDateTimePY(order.paymentReminderSentAt),
            })}
          </p>
        ) : null}
        <ol className="mt-2 space-y-2 text-sm">
          {events.map((event) => (
            <li
              key={event.id}
              className="border-border flex flex-wrap gap-x-3 border-b pb-2"
            >
              <span className="text-muted-foreground w-36 shrink-0 tabular-nums">
                {formatDateTimePY(event.createdAt)}
              </span>
              <span>
                {event.fromStatus
                  ? t("panel.pedido.transicionDesde", {
                      estado: ORDER_STATUS_LABEL[event.fromStatus],
                    })
                  : ""}
                {ORDER_STATUS_LABEL[event.toStatus]}
              </span>
              <span className="text-muted-foreground w-full text-xs">
                {event.actor}
                {event.reason
                  ? t("panel.pedido.motivoEvento", { motivo: event.reason })
                  : ""}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
