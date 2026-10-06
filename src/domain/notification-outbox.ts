import { and, eq, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { withLockRetry } from "@/db/retry";
import { notificationOutbox, orders, type OrderStatus } from "@/db/schema";
import { safeError } from "@/lib/safe-error";
import { log } from "@/lib/log";
import { nombreTienda } from "@/lib/marca";
import type { Executor } from "./executor";
import {
  customerNoticeBody,
  resolveCustomerNotifier,
  type CustomerNoticeKind,
  type CustomerNotifier,
} from "./order-customer-notifications";
import {
  newOrderNoticeBody,
  resolveOwnerNotifier,
  type OwnerNotifier,
} from "./order-notifications";
import { MessageSendError } from "./messaging/sender";
import { withTimeout } from "./notify-timing";
import { NOTICE_REASON_PREFIX, recordOrderEvent } from "./order-events";

export type NoticeKind = CustomerNoticeKind | "dueno";
type Notifier = CustomerNotifier | OwnerNotifier;
function configured(kind: NoticeKind): Notifier | null {
  return kind === "dueno"
    ? resolveOwnerNotifier()
    : resolveCustomerNotifier(kind);
}

/** Call inside the order transaction. No network call occurs here. */
export async function enqueueOrderNotice(
  tx: Executor,
  orderId: number,
  kind: NoticeKind,
  status: OrderStatus,
  note?: string | null,
  force = false
): Promise<void> {
  if (!force && !configured(kind)) return;
  const eventKey = `${orderId}:${kind}`;
  await tx
    .insert(notificationOutbox)
    .values({
      eventKey,
      orderId,
      kind,
      status,
      note: note?.slice(0, 500) ?? null,
    })
    .onDuplicateKeyUpdate({ set: { eventKey } });
}

/** A crashed sender may already have delivered. Never automatically resend its lease. */
export async function dispatchOrderNotices(
  options: { orderId?: number; limit?: number; notifier?: Notifier | null } = {}
): Promise<{ sent: number; failed: number; unknown: number }> {
  const db = getDb();
  const report = { sent: 0, failed: 0, unknown: 0 };
  await db
    .update(notificationOutbox)
    .set({
      state: "unknown",
      lastError: "Delivery lease expired; review before resend",
    })
    .where(
      and(
        eq(notificationOutbox.state, "sending"),
        sql`${notificationOutbox.claimedAt} < NOW() - INTERVAL 2 MINUTE`
      )
    );
  for (let i = 0; i < (options.limit ?? 20); i++) {
    const row = await withLockRetry(() =>
      db.transaction(async (tx) => {
        const [pending] = await tx
          .select()
          .from(notificationOutbox)
          .where(
            and(
              or(
                eq(notificationOutbox.state, "pending"),
                eq(notificationOutbox.state, "failed")
              ),
              lte(notificationOutbox.nextAttemptAt, new Date()),
              sql`${notificationOutbox.attempts} < 5`,
              ...(options.orderId === undefined
                ? []
                : [eq(notificationOutbox.orderId, options.orderId)])
            )
          )
          .orderBy(notificationOutbox.id)
          .limit(1)
          .for("update");
        if (!pending) return null;
        const notifier =
          options.notifier === undefined
            ? configured(pending.kind)
            : options.notifier;
        if (!notifier) {
          await tx
            .update(notificationOutbox)
            .set({ nextAttemptAt: new Date(Date.now() + 15 * 60_000) })
            .where(eq(notificationOutbox.id, pending.id));
          return null;
        }
        await tx
          .update(notificationOutbox)
          .set({
            state: "sending",
            claimedAt: new Date(),
            attempts: pending.attempts + 1,
          })
          .where(eq(notificationOutbox.id, pending.id));
        return { ...pending, notifier };
      })
    );
    if (!row) break;
    let outcome: "sent" | "failed" | "unknown" = "unknown";
    let messageId: string | null = null;
    let errorCode: string | null = null;
    try {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, row.orderId))
        .limit(1);
      if (!order) throw new MessageSendError("Order missing", "rejected");
      const body =
        row.kind === "dueno"
          ? newOrderNoticeBody({ ...order, orderId: order.id })
          : customerNoticeBody(
              row.kind,
              { ...order, orderId: order.id },
              { note: row.note, tienda: await nombreTienda() }
            );
      const result = await withTimeout(
        row.notifier.sender.send({
          to:
            row.kind === "dueno" &&
            "to" in row.notifier &&
            typeof row.notifier.to === "string"
              ? row.notifier.to
              : order.customerPhone,
          body,
          templateName: row.notifier.templateName,
        }),
        12_000
      );
      messageId = result?.messageId ?? null;
      outcome = "sent";
    } catch (error) {
      // Only an explicit provider rejection establishes non-delivery.
      outcome =
        error instanceof MessageSendError && error.outcome === "rejected"
          ? "failed"
          : "unknown";
      errorCode = safeError(error).message;
    }
    try {
      await db.transaction(async (tx) => {
        await tx
          .update(notificationOutbox)
          .set({
            state: outcome,
            providerMessageId: messageId,
            lastError: errorCode,
            sentAt: outcome === "sent" ? new Date() : null,
            nextAttemptAt: new Date(Date.now() + 15 * 60_000),
          })
          .where(
            and(
              eq(notificationOutbox.id, row.id),
              eq(notificationOutbox.state, "sending")
            )
          );
        await recordOrderEvent(
          {
            orderId: row.orderId,
            status: row.status,
            fromStatus: row.status,
            actor: "sistema",
            reason: `${NOTICE_REASON_PREFIX}${row.kind === "dueno" ? (outcome === "sent" ? "dueno_enviado" : "dueno_fallido") : `cliente_${row.kind}${outcome === "sent" ? "" : "_fallido"}`}${errorCode ? `: ${errorCode}` : ""}`,
          },
          { executor: tx }
        );
      });
    } catch (error) {
      // Leave the claimed row for lease recovery: delivery may have succeeded.
      log.error("notification outbox: result persistence failed", {
        error: safeError(error),
      });
      outcome = "unknown";
    }
    report[outcome]++;
  }
  return report;
}

export function kickOrderNotices(orderId: number): void {
  if (
    !resolveOwnerNotifier() &&
    !(
      ["confirmado", "pagado", "enviado", "recordatorio", "resena"] as const
    ).some((kind) => resolveCustomerNotifier(kind))
  )
    return;
  void dispatchOrderNotices({ orderId }).catch((error) =>
    log.error("notification outbox: dispatch failed", {
      error: safeError(error),
    })
  );
}

/** Explicit operator choice; ambiguous delivery can produce a duplicate. */
export async function retryOrderNotice(
  orderId: number,
  id: number
): Promise<void> {
  await getDb()
    .update(notificationOutbox)
    .set({
      state: "pending",
      attempts: 0,
      nextAttemptAt: new Date(),
      claimedAt: null,
    })
    .where(
      and(
        eq(notificationOutbox.id, id),
        eq(notificationOutbox.orderId, orderId),
        or(
          eq(notificationOutbox.state, "unknown"),
          eq(notificationOutbox.state, "failed")
        )
      )
    );
  kickOrderNotices(orderId);
}
