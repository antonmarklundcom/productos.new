import {cacheMetricsSnapshot} from "./cache-metrics.mjs";
// Opt-in local/preview diagnostics. Never retain SQL, parameters, URLs or actors.
export function diagnosticBinding(db, context, now = () => performance.now()) {
 if (!context?.diagnostics) return db;
 return {
  prepare: (sql) => db.prepare(sql),
  async batch(statements) {
   const started = now();
   try {
    const results = await db.batch(statements);
    if (context.batches.length < 40) context.batches.push({
     wallMs: Math.max(0,now()-started),
     statements: statements.length,
     rowsRead: results.reduce((sum,result) => sum + Math.max(0,Number(result.meta?.rows_read)||0),0),
     serviceMs: results.reduce((sum,result) => sum + Math.max(0,Number(result.meta?.timings?.sql_duration_ms ?? result.meta?.duration)||0),0)
    });
    return results;
   } catch(error) {
    if (context.batches.length < 40) context.batches.push({wallMs:Math.max(0,now()-started),statements:statements.length,failed:true,rowsRead:0,serviceMs:0});
    throw error;
   }
  }
 };
}
export function appendDiagnosticHeaders(headers, context, headersMs, bodyMs) {
 const round = (value) => Math.round(value*100)/100;
 const totals = context.batches.reduce((sum,batch) => ({
  wallMs:sum.wallMs+batch.wallMs,serviceMs:sum.serviceMs+batch.serviceMs,rowsRead:sum.rowsRead+batch.rowsRead
 }),{wallMs:0,serviceMs:0,rowsRead:0});
 headers.set("x-catalog-cache-counters",JSON.stringify(cacheMetricsSnapshot()));
 headers.set("x-catalog-public-loads",String(context.loads.length));
 headers.set("x-catalog-d1-batches",String(context.batches.length));
 headers.set("x-catalog-d1-rows-read",String(totals.rowsRead));
 const timings = [
  `worker_headers;dur=${round(headersMs)}`,`worker_body;dur=${round(bodyMs)}`,
  `d1_batch_wall_sum;dur=${round(totals.wallMs)}`,`d1_service_sum;dur=${round(totals.serviceMs)}`,
  ...context.loads.slice(0,40).map((load,index) => `catalog_${load.reader.replace(/[^a-z_]/gi,"")}_${index};dur=${round(load.durationMs)}`)
 ];
 headers.append("server-timing",timings.join(", "));
}
