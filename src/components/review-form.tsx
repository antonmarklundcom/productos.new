"use client";

import { useId, useState } from "react";

import { enviarResena } from "@/app/actions/reviews";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, tPlural } from "@/i18n/client";
import { TESTIDS } from "@/lib/testids";
import { cn } from "@/lib/utils";

/** Los mismos topes que el dominio (`src/domain/reviews.ts`); el servidor los re-chequea. */
const BODY_MAX = 2000;
const TITLE_MAX = 120;

export type ReviewFormItem = {
  productId: number;
  productName: string;
  reviewed: boolean;
};

/**
 * "Calificá tu compra" (página del pedido, sólo con el pedido entregado).
 *
 * Un formulario por producto. Quien lo dibuja ya decidió que el pedido está
 * entregado, pero el navegador no decide nada: la acción vuelve a chequear el
 * token, el estado del pedido y que el producto esté en él.
 */
export function ReviewForms({
  orderNumber,
  token,
  items,
}: {
  orderNumber: string;
  token: string;
  items: ReviewFormItem[];
}) {
  return (
    <div className="mt-3 grid gap-4">
      {items.map((item) =>
        item.reviewed ? (
          <p key={item.productId} className="text-muted-foreground text-sm">
            {t("pedido.resenas.yaCalificado", { producto: item.productName })}
          </p>
        ) : (
          <SingleReviewForm
            key={item.productId}
            orderNumber={orderNumber}
            token={token}
            item={item}
          />
        )
      )}
    </div>
  );
}

function SingleReviewForm({
  orderNumber,
  token,
  item,
}: {
  orderNumber: string;
  token: string;
  item: ReviewFormItem;
}) {
  const id = useId();
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState("");

  if (status === "done") {
    return (
      <p
        role="status"
        data-testid={TESTIDS.reviewThanks}
        className="border-border rounded-lg border p-3 text-sm"
      >
        {t("pedido.resenas.gracias")}
      </p>
    );
  }

  return (
    <form
      data-testid={TESTIDS.reviewForm}
      data-product-id={item.productId}
      className="border-border grid gap-3 rounded-lg border p-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (rating < 1) {
          setError(t("error.resena.estrellas"));
          return;
        }
        setStatus("loading");
        setError("");
        const result = await enviarResena({
          orderNumber,
          token,
          productId: item.productId,
          rating,
          title,
          body,
        });
        if (result.ok) {
          setStatus("done");
        } else {
          setStatus("idle");
          setError(result.error);
        }
      }}
    >
      {/* Un radio group de verdad: flechas del teclado, un solo tab stop y el
          lector de pantalla anuncia "3 estrellas, 3 de 5". Los radios quedan
          `sr-only` y la estrella es su label. */}
      <fieldset>
        <legend className="text-sm font-medium">
          {t("pedido.resenas.estrellas", { producto: item.productName })}
        </legend>
        <div className="mt-1 flex gap-1" data-testid={TESTIDS.reviewStars}>
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="cursor-pointer">
              <input
                type="radio"
                name={`${id}-rating`}
                value={value}
                checked={rating === value}
                onChange={() => setRating(value)}
                className="peer sr-only"
              />
              <span className="sr-only">
                {tPlural("pedido.resenas.estrella", value)}
              </span>
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                width={28}
                height={28}
                className={cn(
                  "peer-focus-visible:ring-ring rounded peer-focus-visible:ring-2",
                  value <= rating
                    ? "text-amber-500"
                    : "text-muted-foreground/40"
                )}
              >
                <path
                  d="M12 2.5l2.94 5.96 6.58.96-4.76 4.64 1.12 6.55L12 17.52l-5.88 3.09 1.12-6.55L2.48 9.42l6.58-.96L12 2.5z"
                  fill="currentColor"
                />
              </svg>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-title`}>{t("pedido.resenas.tituloCampo")}</Label>
        <Input
          id={`${id}-title`}
          value={title}
          maxLength={TITLE_MAX}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-body`}>{t("pedido.resenas.cuerpo")}</Label>
        <textarea
          id={`${id}-body`}
          data-testid={TESTIDS.reviewBody}
          required
          rows={4}
          value={body}
          maxLength={BODY_MAX}
          onChange={(event) => setBody(event.target.value)}
          placeholder={t("pedido.resenas.cuerpoPlaceholder")}
          className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm"
        />
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("pedido.resenas.contador", { n: body.length, maximo: BODY_MAX })}
        </span>
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div>
        <Button
          type="submit"
          data-testid={TESTIDS.reviewSubmit}
          disabled={status === "loading"}
        >
          {status === "loading"
            ? t("pedido.resenas.enviando")
            : t("pedido.resenas.enviar")}
        </Button>
      </div>
    </form>
  );
}
