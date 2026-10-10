import { boxesFor, sizeForBox } from "./imagenes-r2";

/** Compress on the owner's device; retain the existing 1 MiB request ceiling. */
export async function prepareR2ImageForm(data:FormData):Promise<void>{
  const file=data.get("file");
  if(!(file instanceof File)||!file.size||file.size>20*1024*1024)throw new Error("Elegí una foto JPG, PNG o WebP de hasta 20 MB.");
  const bitmap=await createImageBitmap(file);
  try{
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000)throw new Error("La foto es demasiado grande.");
    const size=sizeForBox(bitmap.width,bitmap.height,Math.min(1200,Math.max(bitmap.width,bitmap.height)))!;
    data.set("imageWidth",String(size.width));data.set("imageHeight",String(size.height));
    const encode=async(box:number,type:string,quality:number)=>{
      const dimensions=sizeForBox(size.width,size.height,box)!;
      const canvas=document.createElement("canvas");canvas.width=dimensions.width;canvas.height=dimensions.height;
      const context=canvas.getContext("2d");if(!context)throw new Error("No se pudo preparar la foto.");
      context.fillStyle="#ffffff";context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("No se pudo preparar la foto.")),type,quality));
      if(blob.type!==type)throw new Error("Tu navegador no permite convertir esta foto a WebP.");
      return blob;
    };
    const prepared:[string,Blob,string][]=[];
    for(const box of boxesFor(size.width,size.height))prepared.push(["webp"+box,await encode(box,"image/webp",0.75),box+".webp"]);
    prepared.push(["jpeg",await encode(Math.max(size.width,size.height),"image/jpeg",0.82),"fallback.jpg"]);
    if(prepared.reduce((sum,item)=>sum+item[1].size,0)>800*1024)throw new Error("La foto comprimida sigue siendo muy pesada. Elegí una foto más simple o reducí su tamaño antes de subirla.");
    data.delete("file");for(const [name,blob,filename] of prepared)data.set(name,blob,filename);
  }finally{bitmap.close();}
}
