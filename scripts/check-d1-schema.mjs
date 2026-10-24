import {mkdtemp,cp,readdir,readFile,writeFile,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import path from "node:path";
import os from "node:os";
import {fileURLToPath} from "node:url";
import {normalizedSearchBackfill,normalizedSearchTriggers} from "../workers/d1/search-normalization.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const normalized=sql=>sql.replace(/\s+/g," ").replace(/;\s*$/,"").trim();
export function verifyNormalizedSearchContract(sql) {
 for(const statement of [normalizedSearchBackfill,...normalizedSearchTriggers])
  if(!normalized(sql).includes(normalized(statement))) throw Error("D1 normalized search migration/backfill/trigger contract drift");
 const db=new DatabaseSync(":memory:");
 try {
  db.exec(sql);
  const columns=db.prepare("PRAGMA table_info(products)").all();
  for(const name of ["search_name","search_brand","search_description"])
   if(!columns.some(column=>column.name===name && column.notnull===1))throw Error("D1 normalized search column contract drift");
  db.exec("INSERT INTO categories(id,slug,name) VALUES(991,'schema-check','Synthetic'); INSERT INTO products(id,slug,name,brand,description,category_id) VALUES(991,'schema-check','CÁFÉ','ÑANDÚ','TÉRMICA',991)");
  const read=()=>db.prepare("SELECT search_name,search_brand,search_description FROM products WHERE id=991").get();
  let row=read();if(row.search_name!=="cafe"||row.search_brand!=="ñandu"||row.search_description!=="termica")throw Error("D1 normalized search insert trigger failed");
  db.exec("UPDATE products SET name='NIÑO',brand='ÚTIL',description='ALGODÓN' WHERE id=991");
  row=read();if(row.search_name!=="niño"||row.search_brand!=="util"||row.search_description!=="algodon")throw Error("D1 normalized search update trigger failed");
 } finally {db.close();}
}
export async function migrationFingerprints(folder) {
 const files=(await readdir(folder,{recursive:true})).filter(name=>/\.(?:sql|json)$/.test(name)).sort();
 return Promise.all(files.map(async name=>[name,createHash("sha256").update(await readFile(path.join(folder,name))).digest("hex")]));
}
export function assertNoMigrationDrift(before,after) {
 if(JSON.stringify(before)!==JSON.stringify(after))throw Error("D1 schema drift: generate and review a committed native D1 migration before deployment");
}
export async function checkD1Schema({schema=path.join(root,"workers/d1/schema.ts")} = {}) {
 const work=await mkdtemp(path.join(os.tmpdir(),"productos-d1-drift-"));
 try {
  const output=path.join(work,"migrations"),config=path.join(work,"drizzle.config.ts");
  await cp(path.join(root,"workers/d1/migrations"),output,{recursive:true});
  const before=await migrationFingerprints(output);
  await writeFile(config,"export default "+JSON.stringify({dialect:"sqlite",schema:schema.replaceAll("\\","/"),out:"./migrations"})+";\n");
  const env={...process.env};for(const key of Object.keys(env))if(/^(?:CLOUDFLARE_|CF_API_|OWNER_|DATABASE_URL$|SESSION_SECRET$)/.test(key))delete env[key];
  const result=spawnSync(process.execPath,[path.join(root,"node_modules/drizzle-kit/bin.cjs"),"generate","--config",config],{cwd:work,env,encoding:"utf8",windowsHide:true,timeout:60000});
  if(result.status!==0 || /Error:|No schema files found/i.test(String(result.stderr)+String(result.stdout)))throw Error("D1 disposable migration generation failed: "+String(result.stderr||result.stdout).slice(-2000));
  assertNoMigrationDrift(before,await migrationFingerprints(output));
  const names=(await readdir(output)).filter(name=>/^\d.*\.sql$/.test(name)).sort();
  verifyNormalizedSearchContract((await Promise.all(names.map(name=>readFile(path.join(output,name),"utf8")))).join("\n"));
  console.log(JSON.stringify({result:"PASS",check:"native-d1-schema-and-normalized-search",migrations:names.length}));
 } finally {const resolved=path.resolve(work),temporaryRoot=path.resolve(os.tmpdir());if(!resolved.startsWith(temporaryRoot+path.sep)||!path.basename(resolved).startsWith("productos-d1-drift-"))throw Error("Refusing unexpected schema-check cleanup path");await rm(resolved,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await checkD1Schema();
