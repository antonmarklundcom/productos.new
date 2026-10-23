import {test} from "node:test";
import assert from "node:assert/strict";
import {diagnosticBinding,appendDiagnosticHeaders} from "../../workers/d1/catalog-diagnostics.mjs";
test("diagnostics are opt in, numeric and never expose query or parameters",async()=>{
 const db={prepare:sql=>({sql}),batch:async()=>[{meta:{rows_read:8,timings:{sql_duration_ms:2.5}},results:[{private:"not retained"}]}]};
 assert.equal(diagnosticBinding(db,{diagnostics:false}),db);
 const context={diagnostics:true,batches:[],loads:[{reader:"search",durationMs:7}]};
 let time=0;const binding=diagnosticBinding(db,context,()=>time+=3);
 await binding.batch([binding.prepare("SELECT private FROM private WHERE email='not-retained'")]);
 const headers=new Headers();appendDiagnosticHeaders(headers,context,10,20);
 assert.equal(headers.get("x-catalog-d1-rows-read"),"8");
 assert.match(headers.get("server-timing"),/worker_headers;dur=10.*worker_body;dur=20.*d1_service_sum;dur=2.5/);
 assert.doesNotMatch(JSON.stringify(context)+JSON.stringify([...headers]),/SELECT|email|private|not-retained/);
});
