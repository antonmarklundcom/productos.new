import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {assertNoMigrationDrift,verifyNormalizedSearchContract,checkD1Schema} from '../../scripts/check-d1-schema.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),require=createRequire(import.meta.url);
test('native D1 gate detects added or changed migration output',()=>{
 const before=[['0000.sql','old'],['meta/snapshot.json','snapshot']];
 assert.doesNotThrow(()=>assertNoMigrationDrift(before,[...before]));
 assert.throws(()=>assertNoMigrationDrift(before,[...before,['0001.sql','new']]),/schema drift/);
 assert.throws(()=>assertNoMigrationDrift(before,[['0000.sql','changed'],before[1]]),/schema drift/);
});
test('normalized search gate verifies migration triggers and rejects missing update/backfill contracts',async()=>{
 const folder=path.join(root,'workers/d1/migrations'),names=(await readdir(folder)).filter(n=>/^\d.*\.sql$/.test(n)).sort();
 const sql=(await Promise.all(names.map(n=>readFile(path.join(folder,n),'utf8')))).join('\n');
 assert.doesNotThrow(()=>verifyNormalizedSearchContract(sql));
 assert.throws(()=>verifyNormalizedSearchContract(sql.replace('CREATE TRIGGER products_search_update','CREATE TRIGGER changed_update')),/contract drift/);
 assert.throws(()=>verifyNormalizedSearchContract(sql.replace('UPDATE products SET search_name =','UPDATE products SET search_name_changed =')),/contract drift/);
});
test('actual disposable generation rejects a schema-only fixture until its migration exists',{timeout:60000},async()=>{
 const work=await mkdtemp(path.join(os.tmpdir(),'productos-schema-only-fixture-'));
 try {
  const schema=path.join(work,'schema.ts');
  await writeFile(schema,`export * from ${JSON.stringify(path.join(root,'workers/d1/schema.ts').replaceAll('\\','/'))};\nimport {sqliteTable,integer} from ${JSON.stringify(require.resolve('drizzle-orm/sqlite-core').replaceAll('\\','/'))};\nexport const uncommittedDriftFixture=sqliteTable('uncommitted_drift_fixture',{id:integer('id').primaryKey()});\n`);
  await assert.rejects(checkD1Schema({schema}),/D1 schema drift/);
 } finally {const resolved=path.resolve(work);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith("productos-schema-only-fixture-"))throw Error("Unexpected fixture cleanup path");await rm(resolved,{recursive:true,force:true});}
});
