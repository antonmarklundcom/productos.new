"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { addOrderNote } from "@/app/actions/admin-orders";
import { Button } from "@/components/ui/button";
import { TESTIDS } from "@/lib/testids";
import { t } from "@/i18n";

const MAX_LENGTH = 1000;

export type OrderNoteView = {
  id: number;
  body: string;
  /** El nombre de hoy de quien la escribió, o el string histórico si no hay usuario. */
  author: string;
  /** Ya formateada `dd/mm/yyyy hh:mm` en horario de Asunción (`formatDateTimePY`). */
  createdAt: string;
};

/**
 * Notas internas del pedido (plan-operacion §6.1).
 *
 * Nunca las ve la compradora — el dominio (`order-notes.ts`) ya lo garantiza,
 * esto sólo dibuja lo que llega. Visible para los tres roles: es mostrador
 * puro, y quien atiende el teléfono es justamente el vendedor.
 */
export function OrderNotes({ orderId, notes }: { orderId: number; notes: OrderNoteView[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const trimmed = body.trim();
    if (trimmed.length === 0) return;
    setError(null);
    startTransition(async () => {
      const result = await addOrderNote({ orderId, body: trimmed });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBody("");
      toast.success(t("panel.notas.guardada"));
      router.refresh();
    });
  };

  return (
    <div className="grid gap-3">
      {notes.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("panel.notas.sinNotas")}</p>
      ) : (
        <ul className="grid gap-2" data-testid={TESTIDS.orderNotesList}>
          {notes.map((note) => (
            <li key={note.id} className="border-border rounded-lg border p-3 text-sm">
              <p className="whitespace-pre-line">{note.body}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {note.author} · {note.createdAt}
              </p>
            </li>
          ))}
        </ul>
      )}

      {error ? (
        <p role="alert" className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-1.5">
        <textarea
          data-testid={TESTIDS.orderNotesTextarea}
          value={body}
          onChange={(event) => setBody(event.target.value.slice(0, MAX_LENGTH))}
          maxLength={MAX_LENGTH}
          rows={3}
          placeholder={t("panel.notas.placeholder")}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("panel.notas.contador", { n: body.length, maximo: MAX_LENGTH })}
          </span>
          <Button
            type="button"
            size="sm"
            data-testid={TESTIDS.orderNotesSubmit}
            disabled={isPending || body.trim().length === 0}
            onClick={submit}
          >
            {isPending ? t("panel.notas.guardando") : t("panel.notas.agregar")}
          </Button>
        </div>
      </div>
    </div>
  );
}
