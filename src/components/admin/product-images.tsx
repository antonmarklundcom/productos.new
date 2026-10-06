"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { removeProductImage, uploadProductImage } from "@/app/actions/admin-products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { productImageUrl } from "@/lib/images";
import { t } from "@/i18n";

type ImageCard = { id: number; cloudinaryId: string; alt: string | null };

export function ProductImages({
  productId,
  images,
}: {
  productId: number;
  images: ImageCard[];
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="grid gap-4">
      {error ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border p-3 text-sm"
        >
          {error}
        </p>
      ) : null}

      {images.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => {
            const url = productImageUrl(image.cloudinaryId, "card");
            return (
              <li key={image.id} className="border-border overflow-hidden rounded-lg border">
                <div className="bg-muted relative aspect-square">
                  {url ? (
                    <Image
                      src={url}
                      alt={image.alt ?? t("panel.fotos.alt")}
                      fill
                      unoptimized
                      sizes="200px"
                      className="object-cover"
                    />
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  disabled={isPending}
                  onClick={() => {
                    setError(null);
                    startTransition(async () => {
                      const result = await removeProductImage({ imageId: image.id, productId });
                      if (!result.ok) {
                        setError(result.error);
                        return;
                      }
                      toast.success(t("panel.fotos.quitada"));
                      router.refresh();
                    });
                  }}
                >
                  {t("panel.fotos.quitar")}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("panel.fotos.vacio")}</p>
      )}

      <form
        ref={formRef}
        className="border-border grid gap-3 rounded-xl border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const data = new FormData(event.currentTarget);
          data.set("productId", String(productId));

          startTransition(async () => {
            const result = await uploadProductImage(data);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            formRef.current?.reset();
            toast.success(t("panel.fotos.subida"));
            router.refresh();
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="file">{t("panel.fotos.agregar")}</Label>
          <Input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="alt">{t("panel.fotos.descripcion")}</Label>
          <Input id="alt" name="alt" maxLength={255} placeholder={t("panel.fotos.descripcion.placeholder")} />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? t("panel.fotos.subiendo") : t("panel.fotos.subir")}
        </Button>
      </form>
    </div>
  );
}
