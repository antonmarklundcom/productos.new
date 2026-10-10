/** Read encoded dimensions; never trust the multipart MIME or dimension fields. */
export function preparedImageDimensions(bytes:Uint8Array,mime:string):{width:number;height:number}|null{
  const text=(at:number,n:number)=>String.fromCharCode(...bytes.slice(at,at+n));
  if(mime==="image/webp"&&bytes.length>=30&&text(0,4)==="RIFF"&&text(8,4)==="WEBP"){
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(view.getUint32(4,true)+8!==bytes.length)return null;
    const codec=text(12,4);
    if(codec==="VP8 "&&bytes[23]===0x9d&&bytes[24]===1&&bytes[25]===0x2a)return{width:view.getUint16(26,true)&16383,height:view.getUint16(28,true)&16383};
    if(codec==="VP8L"&&bytes[20]===0x2f){const value=view.getUint32(21,true);return{width:(value&16383)+1,height:((value>>>14)&16383)+1};}
    if(codec==="VP8X")return{width:1+bytes[24]!+bytes[25]!*256+bytes[26]!*65536,height:1+bytes[27]!+bytes[28]!*256+bytes[29]!*65536};
  }
  if(mime==="image/jpeg"&&bytes[0]===255&&bytes[1]===216){
    let at=2;
    while(at+4<bytes.length){
      if(bytes[at++]!==255)return null;while(bytes[at]===255)at++;
      const marker=bytes[at++]!;if(marker===217||marker===218)return null;
      if(marker===1||(marker>=208&&marker<=215))continue;
      const length=bytes[at]!*256+bytes[at+1]!;if(length<2||at+length>bytes.length)return null;
      if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8)return{height:bytes[at+3]!*256+bytes[at+4]!,width:bytes[at+5]!*256+bytes[at+6]!};
      at+=length;
    }
  }
  return null;
}
