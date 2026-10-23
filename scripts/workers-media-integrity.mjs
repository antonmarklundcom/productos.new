import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
export const sha256 = b => createHash('sha256').update(b).digest('hex');
export function reconcileMedia({referencePages,objectPages,now=Date.now(),graceMs=86400000}) {
 const flatten=pages=>{if(!Array.isArray(pages)||!pages.length||pages.some((p,i)=>!Array.isArray(p.items)||p.complete!==true||(i===pages.length-1&&p.nextCursor)))throw Error('INCOMPLETE_INVENTORY');return pages.flatMap(p=>p.items);};
 if(!Number.isFinite(now)||!Number.isFinite(graceMs)||graceMs<0)throw Error('INVALID_TIME');
 const refs=flatten(referencePages),objects=flatten(objectPages),keys=new Map(),used=new Set();
 const report={mode:'report-only',missing:[],incomplete:[],mismatched:[],candidateOrphans:[],protected:[]};
 for(const o of objects){if(!o.key||keys.has(o.key))throw Error('AMBIGUOUS_OBJECT_KEYS');keys.set(o.key,o);}
 for(const r of refs){if(!r.variants?.length){report.incomplete.push({id:r.id,reason:'no-variants'});continue;}
 for(const v of r.variants){if(!v.key){report.incomplete.push({id:r.id,reason:'missing-key'});continue;}used.add(v.key);const o=keys.get(v.key);if(!o){report.missing.push(v.key);continue;}
 for(const field of ['sha256','size','width','height']){if(v[field]==null||o[field]==null)report.incomplete.push({key:v.key,field});else if(v[field]!==o[field])report.mismatched.push({key:v.key,field});}}}
 for(const o of objects)if(!used.has(o.key)){const t=Date.parse(o.uploaded);(report.incomplete.some(e=>e.reason)||!Number.isFinite(t)||t>now||now-t<graceMs||o.pending||o.ambiguous?report.protected:report.candidateOrphans).push(o.key);}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){if(process.argv.length!==3||process.argv[2].startsWith('--'))throw Error('Usage: node scripts/workers-media-integrity.mjs authorized-inventory.json (report only)');console.log(JSON.stringify(reconcileMedia(JSON.parse(await readFile(process.argv[2],'utf8'))),null,2));}

