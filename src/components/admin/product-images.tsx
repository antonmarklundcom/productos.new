"use client";

import { catalogCapabilities } from "@/lib/catalog-policy";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { useProductRevision } from "./product-revision";
import { editProductImage, reorderProductImages, restoreProductImage, listRemovedProductImages, removeProductImage, uploadProductImage } from "@/app/actions/admin-products";
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
  const {revision,acknowledge}=useProductRevision();
  const [removed,setRemoved]=useState<Array<{id:string;alt:string|null}>>([]);
  const [uploadId,setUploadId]=useState<string|null>(null);
  const galleryKey=images.map(image=>image.id).join(",");
  useEffect(()=>{if(!catalogCapabilities.nativeGallery)return;void listRemovedProductImages({productId}).then(result=>{if(result.ok)setRemoved(result.images);}).catch(()=>{});},[productId,galleryKey]);
  const mutate=(action:(input:unknown)=>Promise<{ok:true;revision?:number}|{ok:false;error:string}>,value:object)=>{
    const expected=revision;
    startTransition(async()=>{try{const result=await action({...value,productId,expectedRevision:expected,operationId:crypto.randomUUID()});if(!result.ok){setError(result.error);return;}acknowledge(expected,result.revision);router.refresh();}catch{setError("La conexión se interrumpió. Conservá tu borrador y recargá para comprobar si se guardó antes de reintentar.");}});
  };
  const preparation = useRef<AbortController | null>(null);
  const [preparationProgress, setPreparationProgress] = useState<number | null>(null);
  useEffect(() => () => preparation.current?.abort(), []);
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
          {images.map((image,index) => {
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
                <div className="grid gap-2 p-2">
                  {index===0?<span className="text-xs">Portada</span>:null}
                  {catalogCapabilities.nativeGallery ? <label className="grid gap-1 text-xs">Descripción
                    <Input key={image.alt} defaultValue={image.alt??""} maxLength={255} aria-label={`Descripción de foto ${index+1}`} onBlur={event=>{if(event.target.value!==(image.alt??""))mutate(editProductImage,{imageId:image.id,alt:event.target.value});}} />
                  </label> : <p className="text-xs">Descripción: {image.alt||"Sin descripción"}</p>}
                  <div className="flex flex-wrap gap-1">
                    {catalogCapabilities.nativeGallery ? <>
                    <Button type="button" size="sm" variant="outline" disabled={isPending||index===0} onClick={()=>mutate(reorderProductImages,{imageIds:[image.id,...images.filter(other=>other.id!==image.id).map(other=>other.id)]})}>Usar de portada</Button>
                    <Button type="button" size="sm" variant="outline" aria-label={`Mover foto ${index+1} antes`} disabled={isPending||index===0} onClick={()=>{const ids=images.map(photo=>photo.id);[ids[index-1],ids[index]]=[ids[index]!,ids[index-1]!];mutate(reorderProductImages,{imageIds:ids});}}>←</Button>
                    <Button type="button" size="sm" variant="outline" aria-label={`Mover foto ${index+1} después`} disabled={isPending||index===images.length-1} onClick={()=>{const ids=images.map(photo=>photo.id);[ids[index+1],ids[index]]=[ids[index]!,ids[index+1]!];mutate(reorderProductImages,{imageIds:ids});}}>→</Button>
                    </> : null}
                    <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={()=>mutate(removeProductImage,{imageId:image.id})}>{t("panel.fotos.quitar")}</Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{t("panel.fotos.vacio")}</p>
      )}

      {catalogCapabilities.nativeGallery&&removed.length?<div className="grid gap-2"><p className="text-sm">Fotos quitadas: podés restaurarlas durante 24 horas.</p>{removed.map(image=><Button key={image.id} type="button" variant="outline" disabled={isPending} onClick={()=>mutate(restoreProductImage,{tombstoneId:image.id})}>Deshacer: {image.alt||"foto"}</Button>)}</div>:null}
      <form
        ref={formRef}
        className="border-border grid gap-3 rounded-xl border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          const data = new FormData(event.currentTarget);
          data.set("productId", String(productId));
          const operationId=uploadId??crypto.randomUUID();setUploadId(operationId);
          data.set("operationId",operationId);data.set("expectedRevision",String(revision));

          startTransition(async () => {
            const controller = new AbortController();
            preparation.current = controller;
            const prepareOptions = { signal: controller.signal, onProgress(percent: number) {
              setPreparationProgress(percent);
              if (percent === 100) preparation.current = null;
            } };
            void prepareOptions; // Consumed by the Workers upload transform.
            try {
            const result = await uploadProductImage(data);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            acknowledge(revision,result.revision);setUploadId(null);
            formRef.current?.reset();
            toast.success(t("panel.fotos.subida"));
            router.refresh();
            } catch (cause) {
              if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "No se pudo subir la foto. Volvé a intentar.");
            } finally {
              preparation.current = null; setPreparationProgress(null);
            }
          });
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="file">{t("panel.fotos.agregar")}</Label>
          <Input id="file" name="file" type="file" accept="image/jpeg,image/png,image/webp" required onChange={()=>setUploadId(null)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="alt">{t("panel.fotos.descripcion")}</Label>
          <Input id="alt" name="alt" maxLength={255} placeholder={t("panel.fotos.descripcion.placeholder")} />
        </div>
        {preparationProgress !== null && preparationProgress < 100 ? (
          <div className="grid gap-2">
            <p role="status" aria-live="polite">Preparando foto: {preparationProgress}%</p>
            <Button type="button" variant="outline" onClick={() => preparation.current?.abort()}>Cancelar preparación</Button>
          </div>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? t("panel.fotos.subiendo") : t("panel.fotos.subir")}
        </Button>
      </form>
    </div>
  );
}
