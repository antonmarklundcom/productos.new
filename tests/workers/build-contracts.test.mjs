import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import path from "node:path";
import ts from "typescript";
import {d1StagingPlugin,replaceRequired} from "../../workers/d1/build-plugin.mjs";
const root=path.resolve(import.meta.dirname,"../..");
const plugin=d1StagingPlugin(root);
const source=(file)=>readFileSync(path.join(root,file),"utf8");
test("critical adapter rejects missing and duplicate anchors",()=>{
 assert.throws(()=>replaceRequired("changed","anchor","new","fixture"),/expected 1.*found 0/);
 assert.throws(()=>replaceRequired("anchor anchor","anchor","new","fixture"),/expected 1.*found 2/);
 assert.equal(replaceRequired("anchor","anchor","new","fixture"),"new");
});
test("source drift in upload, import and asynchronous limiter fails the build",()=>{
 for(const [file,from,to] of [
  ["src/components/admin/product-images.tsx","const result = await uploadProductImage(data);","const renamed = await uploadProductImage(data);"],
  ["src/components/admin/catalog-import.tsx","const result = await applyCatalogImport(formData);","const changed = await applyCatalogImport(formData);"],
  ["src/app/actions/admin-auth.ts","= rateLimit(","= renamedRateLimit("]
 ]) {
  const original=source(file);assert.ok(original.includes(from));
  assert.ok(plugin.transform(original,path.join(root,file))?.code);
  assert.throws(()=>plugin.transform(original.replace(from,to),path.join(root,file)),/source drift/);
 }
});
test("native action routing cannot silently fall back after an exported action rename",()=>{
 const file="src/app/actions/admin-products.ts",original=source(file);
 assert.throws(()=>plugin.transform(original.replace("export async function saveProduct(","export async function renamedSaveProduct("),path.join(root,file)),/native action routing.*saveProduct/);
 const result=plugin.transform(original,path.join(root,file)).code;
 const ast=ts.createSourceFile(file,result,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 for(const name of ["saveProduct","saveProductVariant","applyCatalogImport","uploadProductImage","removeProductImage"]) {
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);
  assert.equal(fn.body.statements.length,1);
  assert.ok(ts.isReturnStatement(fn.body.statements[0]));
  assert.match(fn.body.getText(ast),/return \w*D1\w*\(/);
 }
});
