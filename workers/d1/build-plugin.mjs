import path from "node:path";
import ts from "typescript";
const normalize=(value)=>value.replaceAll("\\", "/").replace(/\.(?:mjs|ts|tsx)$/, "");
const allowedActions={
  "admin-auth":new Set(["loginAdmin","logoutAdmin"]),
  "admin-products":new Set(["saveProduct","saveProductVariant","saveVariantSupplierCost","previewCatalogImport","applyCatalogImport","uploadProductImage","removeProductImage"]),
  "admin-ajustes":new Set(["guardarAjustes","restaurarAjustes","quitarImagenPortada","quitarImagenMarca"]),
  "admin-categories":new Set(["crearCategoria","editarCategoria","cambiarEstadoCategoria","moverCategoria"]),
};
export function d1StagingPlugin(root) {
  const replacements=new Map([
    ["src/db/index","workers/d1/database.ts"],
    ["src/db/schema","workers/d1/schema.ts"],
    ["src/domain/supplier-costs","workers/d1/supplier-costs.ts"],
    ["src/domain/admin-categories","workers/d1/admin-categories.ts"],
    ["src/domain/catalog-import-plan","workers/d1/catalog-import-plan.ts"],
    ["src/domain/store-settings","workers/d1/store-settings.ts"],
  ].map(([from,to])=>[normalize(path.resolve(root,from)),path.resolve(root,to)]));
  return {name:"isolated-d1-catalog-pilot",enforce:"pre",
    resolveId(source,importer) {
      const candidate=source.startsWith("@/")?path.resolve(root,"src",source.slice(2)):source.startsWith(".")&&importer?path.resolve(path.dirname(importer.split("?")[0]),source):path.isAbsolute(source)?source:undefined;
      if(!candidate)return;
      const normalized=normalize(candidate);
      return replacements.get(normalized) || (normalized===normalize(path.resolve(root,"src/db"))?path.resolve(root,"workers/d1/database.ts"):undefined);
    },
    transform(original,id) {
      const file=id.split("?")[0].replaceAll("\\","/");
      if(!file.startsWith(root.replaceAll("\\","/")+"/src/"))return;
      if(file.endsWith("/admin/(panel)/page.tsx"))return {code: `export const dynamic = "force-dynamic"; export { default } from ${JSON.stringify(path.resolve(root,"workers/d1/admin-summary.tsx").replaceAll("\\","/"))};`,map:null};
      let code=original;
      code=code.replace(/(["'])\.\/supplier-costs\1/g, JSON.stringify(path.resolve(root,"workers/d1/supplier-costs.ts").replaceAll("\\","/")));
      code=code.replace(/(["'])\.\/store-settings\1/g, JSON.stringify(path.resolve(root,"workers/d1/store-settings.ts").replaceAll("\\","/")));
      // Exact, reviewed clock translation in modules used by this pilot. No
      // runtime SQL rewriting or MySQL session-state emulation.
      if(file.endsWith("/domain/stock.ts")||file.endsWith("/lib/auth.ts"))code=code.replaceAll("sql`NOW()`","sql`CURRENT_TIMESTAMP`");
      if(file.endsWith("/db/queries.ts"))code=code.replaceAll("<=>", "IS").replaceAll('sql`MATCH(${products.name}, ${products.description}) AGAINST (${booleanTerm} IN BOOLEAN MODE)`','sql`(${products.name} LIKE ${"%"+cleaned+"%"} OR ${products.description} LIKE ${"%"+cleaned+"%"})`');
      if(file.endsWith("/instrumentation.ts")){
        code=code.replace("error: safeError(error).message,", 'error: safeError(error).message, stack: safeError(error).stack, stagingErrorClass: ["SESSION_SECRET", "cookie", "searchParams", "useTransition", "server reference", "action", "request scope"].filter((token)=>String((error as Error)?.message).includes(token)),');
      }
      if(file.endsWith("/lib/session.ts")){
        code='import { getD1SessionSecret } from "../../workers/d1/database";\n'+code.replace("process.env.SESSION_SECRET","getD1SessionSecret()");
        // iron-session probes typeof cookieStore.set; vinext read-only stores
        // throw on property access. Defer that access until an actual write,
        // retaining the framework's server-action-only mutation protection.
        code=code.replace("getIronSession<AdminSession>(cookieStore, sessionOptions())", "getIronSession<AdminSession>({ get: (name: string) => cookieStore.get(name), getAll: () => cookieStore.getAll(), set: (...args: Parameters<typeof cookieStore.set>) => cookieStore.set(...args) }, sessionOptions())");
      }
      if(file.endsWith("/domain/admin-dashboard.ts")){
        // Raw SQL Date parameters have no column encoder by default. Keep the
        // existing Paraguay day boundaries, but bind through the UTC D1 column.
        const raw='const inDay = sql`${orders.createdAt} >= ${start} AND ${orders.createdAt} < ${end}`;';
        const encoded='const inDay = sql`${orders.createdAt} >= ${sql.param(start, orders.createdAt)} AND ${orders.createdAt} < ${sql.param(end, orders.createdAt)}`;';
        if(!code.includes(raw))throw new Error('D1 dashboard date binding source drift');
        code=code.replace(raw,encoded);
      }
      if(file.endsWith("/admin/(panel)/ajustes/page.tsx"))code=code.replaceAll("cloudinaryConfigured()", "false");
      if(file.endsWith("/app/page.tsx"))code=code.replace("Consultá la información de tu pedido.","Consultá tus dudas por WhatsApp.");
      if(file.endsWith("/admin/login/page.tsx"))code=code.replace("<LoginForm next={next} />", "<LoginForm next={next} passwordRecoveryAvailable />");
      if(file.endsWith("/actions/admin-auth.ts")){
        code=code.replace('from "@/lib/rate-limit"','from "../../../workers/d1/login-limit"');
        code=code.replaceAll("= rateLimit(","= await rateLimit(").replace(/^(\s*)resetRateLimitKey\(/gm,"$1await resetRateLimitKey(");
      }
      if(file.endsWith("/actions/admin-products.ts")){
        const start=code.indexOf("    await db.transaction(async (tx) => {");
        const end=code.indexOf("    revalidatePath(\"/admin/productos\");",start);
        if(start<0||end<0)throw new Error("D1 supplier action patch requires review");
        code=code.slice(0,start)+`    await saveD1SupplierOffer(productId, variantId, offerId, { ...offer, productUrl, supplierUrl, checkedAt: checkedAt ? new Date(checkedAt) : null });\n`+code.slice(end);
        code=code.replace('  writeSupplierOffer,','  saveD1SupplierOffer,');
      }
      if(file.endsWith("/admin/(panel)/layout.tsx")){
        // Preserve the full role-authorised navigation. Unported sections lead to
        // an authenticated availability screen, never an unsafe legacy form.
        const navHref='href: item.id === "resumen" ? "/admin" : `/admin/${item.id}`,';
        if(!code.includes(navHref))throw new Error('D1 admin navigation source drift');
        code=code.replace(navHref,`href: ["resumen","productos","categorias","ajustes"].includes(item.id) ? (item.id === "resumen" ? "/admin" : \`/admin/\${item.id}\`) : \`/admin/estado?seccion=\${item.id}\`,
      ...(!["resumen","productos","categorias","ajustes"].includes(item.id) ? { availabilityLabel: "Pendiente" } : {}),`);
        code=code.replace("        {children}",'<p role="status" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">Catálogo de consultas: productos, categorías, proveedores y ajustes están disponibles. Las secciones marcadas «Pendiente» explican lo que falta para habilitarlas.</p>\n        {children}');
      }
      if(file.endsWith("/components/admin/product-images.tsx")){
        code=code.replace(/^(\s*["']use client["'];)/,'$1\nimport { prepareR2ImageForm } from "@/lib/prepare-r2-images";');
        code=code.replace('            const result = await uploadProductImage(data);','            try { await prepareR2ImageForm(data); } catch(error) { setError(error instanceof Error ? error.message : "No se pudo preparar la foto."); return; }\n            const result = await uploadProductImage(data);');
      }
      if(file.endsWith("/components/admin/catalog-import.tsx")){
        code=code.replace('    if (!file) {','    if(file && file.size>800*1024){toast.error("Dividí la planilla en archivos de hasta 800 KB y 500 productos.");return null;}\n    if (!file) {');
        code=code.replace('      const result = await applyCatalogImport(formData);', `      const sendBatch = async (): Promise<Awaited<ReturnType<typeof applyCatalogImport>> & {nextOffset?:number|null}> => {
        try { return await applyCatalogImport(formData); }
        catch { return {ok:false,errores:["Se interrumpió la conexión. El último lote puede haberse guardado; revisá los productos antes de reintentar. Reimportar la misma planilla no duplica los SKU."]}; }
      };
      let result = await sendBatch();
      let saved=0, variants=0, photos=0;
      while(result.ok && result.nextOffset != null){saved=result.nextOffset;variants+=result.variantesEscritas;photos+=result.fotosSubidas;
        formData.set("batchOffset",String(saved));toast.message(\`Importados \${saved} productos; guardando el siguiente lote…\`);
        result=await sendBatch();}
      if(result.ok){result.variantesEscritas+=variants;result.fotosSubidas+=photos;}
      if(!result.ok && saved)result.errores.unshift(\`Se confirmó el guardado de \${saved} productos. Revisá el último lote antes de reintentar; no se duplican los SKU.\`);`);
      }
      if(file.endsWith("/actions/admin-products.ts"))code=code.replace('if (file.size > MAX_CATALOG_FILE_BYTES)', 'if (file.size > 800 * 1024)');
      if(file.endsWith("/actions/admin-products.ts"))code=code.replace(/^(\s*["']use server["'];)/,'$1\nimport { applyD1CatalogImport, uploadD1ProductImage, removeD1ProductImage } from '+JSON.stringify(path.resolve(root,"workers/d1/catalog-actions.ts").replaceAll("\\","/"))+';');
      // An action ID can be posted to a different page. Route filtering alone
      // is insufficient: deny unported actions at their implementation boundary.
      const moduleIsServer=/^[\s]*["']use server["']/.test(code);
      const ast=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
      const edits=[];
      function walk(node){
        const isFunction=ts.isFunctionDeclaration(node)||ts.isArrowFunction(node)||ts.isFunctionExpression(node);
        if(isFunction&&node.body&&ts.isBlock(node.body)){
          const exported=ts.isFunctionDeclaration(node)&&node.modifiers?.some((m)=>m.kind===ts.SyntaxKind.ExportKeyword);
          const inline=node.body.statements.some((statement)=>ts.isExpressionStatement(statement)&&ts.isStringLiteral(statement.expression)&&statement.expression.text==="use server");
          if((moduleIsServer&&exported)||inline){
            const name=node.name?.getText(ast);
            const actionModule=path.basename(file,".ts");
            const native={applyCatalogImport:"applyD1CatalogImport(formData)",uploadProductImage:"uploadD1ProductImage(formData)",removeProductImage:"removeD1ProductImage(input)"};
            if(actionModule==="admin-products"&&native[name]){edits.push({at:node.body.getStart(ast)+1,end:node.body.end-1,text:"\nreturn "+native[name]+";\n"});return;}
            if(!allowedActions[actionModule]?.has(name))edits.push({at:node.body.getStart(ast)+1,text:'\nthrow new Error("Esta función todavía no está habilitada en la prueba D1.");\n'});
          }
        }
        ts.forEachChild(node,walk);
      }
      walk(ast);
      for(const edit of edits.sort((a,b)=>b.at-a.at))code=code.slice(0,edit.at)+edit.text+code.slice(edit.end??edit.at);
      return code===original?undefined:{code,map:null};
    },
  };
}
