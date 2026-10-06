"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resendOrderNotice } from "@/app/actions/admin-orders";
import { t, type MessageKey } from "@/i18n";
const STATE: Record<string, MessageKey> = {
  pending: "panel.avisos.pendiente",
  sending: "panel.avisos.enviando",
  sent: "panel.avisos.enviado",
  failed: "panel.avisos.rechazado",
  unknown: "panel.avisos.desconocido",
};
const KIND: Record<string, MessageKey> = {
  dueno: "panel.avisos.dueno",
  confirmado: "panel.avisos.confirmado",
  pagado: "panel.avisos.pagado",
  enviado: "panel.avisos.despachado",
  recordatorio: "panel.avisos.recordatorio",
  resena: "panel.avisos.resena",
};

export function OrderNotices({
  orderId,
  notices,
}: {
  orderId: number;
  notices: Array<{ id: number; kind: string; state: string; attempts: number }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!notices.length) return null;
  return (
    <section
      className="mt-6 rounded-lg border p-4"
      aria-labelledby="notice-title"
    >
      <h2 id="notice-title" className="font-semibold">
        {t("panel.avisos.titulo")}
      </h2>
      {notices.some((notice) =>
        ["failed", "unknown"].includes(notice.state)
      ) ? (
        <>
          <p className="my-2 text-sm">{t("panel.avisos.incierto")}</p>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {t("panel.avisos.confirmar")}
          </label>
        </>
      ) : null}
      <ul>
        {notices.map((notice) => (
          <li
            className="mt-3 flex items-center justify-between gap-3"
            key={notice.id}
          >
            <span>
              {t(KIND[notice.kind] ?? "panel.avisos.confirmado")} ·{" "}
              {t(STATE[notice.state] ?? "panel.avisos.desconocido")} ·{" "}
              {t("panel.avisos.intentos", { n: notice.attempts })}
            </span>
            {["failed", "unknown"].includes(notice.state) ? (
              <button
                disabled={!confirmed || pending}
                className="rounded border px-3 py-2 disabled:opacity-50"
                onClick={() =>
                  start(async () => {
                    const result = await resendOrderNotice({
                      orderId,
                      noticeId: notice.id,
                      reviewedDelivery: true,
                    });
                    if (!result.ok) setError(result.error);
                    else {
                      setConfirmed(false);
                      router.refresh();
                    }
                  })
                }
              >
                {t("panel.avisos.reintentar")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
