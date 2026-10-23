import { boxesFor, sizeForBox } from "./imagenes-r2";

export type ImagePreparationOptions = {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
};
const BUDGET = 800 * 1024;
const PROFILES = [
  { box: 1200, webp: 0.75, jpeg: 0.82 },
  { box: 1200, webp: 0.62, jpeg: 0.72 },
  { box: 800, webp: 0.6, jpeg: 0.7 },
] as const;
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Preparación cancelada.", "AbortError");
}
/** Bounded device preparation. Commit FormData only after the complete set fits. */
export async function prepareR2ImageForm(data: FormData, options: ImagePreparationOptions = {}): Promise<void> {
  const { signal, onProgress } = options;
  check(signal);
  const file = data.get("file");
  if (!(file instanceof File) || !file.size || file.size > 20 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Elegí una foto JPG, PNG o WebP de hasta 20 MB.");
  }
  onProgress?.(0);
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => {
    check(signal);
    throw new Error("No se pudo leer la foto. Elegí otro JPG, PNG o WebP y volvé a intentar.");
  });
  try {
    check(signal);
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 40000000) throw new Error("La foto es demasiado grande. Reducí sus dimensiones y volvé a intentar.");
    let completed = 0;
    for (const profile of PROFILES) {
      const size = sizeForBox(bitmap.width, bitmap.height, profile.box)!;
      const prepared: [string, Blob, string][] = [];
      const encode = async (box: number, type: string, quality: number) => {
        check(signal);
        // Yield between encodes so cancellation and progress can paint on a phone.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        check(signal);
        const dimensions = sizeForBox(size.width, size.height, box)!;
        const canvas = document.createElement("canvas");
        canvas.width = dimensions.width; canvas.height = dimensions.height;
        try {
          const context = canvas.getContext("2d");
          if (!context) throw new Error("No se pudo preparar la foto. Probá con otra imagen.");
          context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo preparar la foto.")), type, quality));
          check(signal);
          if (blob.type !== type) throw new Error("Tu navegador no permite convertir esta foto a WebP. Probá con un navegador actualizado.");
          onProgress?.(Math.min(95, ++completed * 6));
          return blob;
        } finally { canvas.width = 0; canvas.height = 0; }
      };
      for (const box of boxesFor(size.width, size.height)) prepared.push(["webp" + box, await encode(box, "image/webp", profile.webp), box + ".webp"]);
      prepared.push(["jpeg", await encode(Math.max(size.width, size.height), "image/jpeg", profile.jpeg), "fallback.jpg"]);
      if (prepared.reduce((sum, item) => sum + item[1].size, 0) > BUDGET) continue;
      check(signal);
      // No async operation after this point: cancellation cannot leave a partial set.
      data.delete("file");
      data.set("imageWidth", String(size.width)); data.set("imageHeight", String(size.height));
      for (const [name, blob, filename] of prepared) data.set(name, blob, filename);
      onProgress?.(100);
      return;
    }
    throw new Error("La foto sigue superando 800 KB después de reducir calidad y tamaño. Recortala o elegí otra foto y volvé a intentar.");
  } finally { bitmap.close(); }
}
