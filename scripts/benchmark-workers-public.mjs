import {spawn} from "node:child_process";
import {writeFile} from "node:fs/promises";
import {setTimeout as pause} from "node:timers/promises";
import {parseArgs} from "node:util";
import {randomUUID} from "node:crypto";
const {values}=parseArgs({options:{phase:{type:"string"},output:{type:"string"},origin:{type:"string"},cold:{type:"boolean",default:false}}});
if(!values.phase || !values.output) throw new Error("Use --phase before|after --output <absolute non-secret report path>");
const origin=values.origin||"https://productos.com.py", id=randomUUID(), events=[];
if(origin!=="https://productos.com.py" && !/^https:\/\/[0-9a-f]{8}-productos-workers-staging\.marklundfaktura\.workers\.dev$/.test(origin))
 throw new Error("Benchmark origin must be Productos live or its existing Worker version URL");
const summary=values=>{const sorted=values.filter(x=>typeof x==="number").sort((a,b)=>a-b);return {samples:sorted.length,meanMs:sorted.length?sorted.reduce((a,b)=>a+b,0)/sorted.length:null,p95Ms:sorted.length?sorted[Math.ceil(sorted.length*.95)-1]:null};};
const tail=spawn(process.execPath,["node_modules/wrangler/wrangler-dist/cli.js","tail","--config","wrangler.jsonc","--format","json","--header",`x-productos-benchmark-id:${id}`],{stdio:["ignore","pipe","pipe"],windowsHide:true});
let buffer="",ready=false,tailExit=null;const tailIssues=[];
tail.on("exit",(code,signal)=>{tailExit={code,signal};});
tail.stdout.on("data",chunk=>{
 buffer+=chunk;
 if(buffer.includes("Connected")||buffer.includes("created tail")) ready=true;
 while(true){
  const start=buffer.indexOf("{");if(start<0)break;
  let depth=0,quoted=false,escape=false,end=-1;
  for(let i=start;i<buffer.length;i++){
   const char=buffer[i];if(escape){escape=false;continue;}
   if(quoted&&char==="\\"){escape=true;continue;}if(char==='"'){quoted=!quoted;continue;}
   if(!quoted){if(char==="{")depth++;if(char==="}"&&--depth===0){end=i+1;break;}}
  }
  if(end<0)break;
  try{const event=JSON.parse(buffer.slice(start,end));
   if(event.event?.request?.headers?.["x-productos-benchmark-id"]===id || event.event?.request?.headers?.["X-Productos-Benchmark-Id"]===id)
    events.push({path:new URL(event.event.request.url).pathname,cpuMs:event.cpuTime??null,wallMs:event.wallTime??null,outcome:event.outcome});
  }catch{}buffer=buffer.slice(end);
 }
 if(buffer.length>250000)buffer=buffer.slice(-10000);
});
// Tail diagnostics may contain provider request details; never print or save them.
tail.stderr.on("data",chunk=>{
 const message=String(chunk);
 for(const [pattern,label] of [[/sampling.*(?:0|1)/i,"sampling rate validation"],[/too many|maximum.*tail/i,"tail session limit"],[/auth|permission|403|401/i,"tail authorization"],[/ERROR/i,"tail startup error"]])
  if(pattern.test(message)&&!tailIssues.includes(label))tailIssues.push(label);
});
const report={phase:values.phase,startedAt:new Date().toISOString(),origin,clientCountry:null,forcedCold:values.cold,samples:[],traces:events};
try{
 for(let attempt=0;attempt<12&&!ready;attempt++)await pause(500);
 const trace=await(await fetch(origin+"/cdn-cgi/trace")).text();
 report.clientCountry=trace.match(/^loc=(.+)$/m)?.[1]??null;
 const paths=["/","/categoria/hogar-y-cocina","/producto/adaptador-para-grifo-360-dropi-11896"];
 for(const path of paths)for(let repeat=0;repeat<3;repeat++){
  const start=performance.now();
  const response=await fetch(origin+path,{headers:{accept:"text/html","x-productos-benchmark-id":id,...(values.cold?{"cache-control":"no-cache"}:{})},signal:AbortSignal.timeout(15000)});
  const headersMs=performance.now()-start,body=await response.arrayBuffer();
  report.samples.push({path,repeat,status:response.status,headersMs,totalMs:performance.now()-start,bytes:body.byteLength,cache:response.headers.get("x-catalog-cache"),placement:response.headers.get("x-profile-placement"),edge:response.headers.get("cf-ray")?.split("-").at(-1)});
  if(response.status!==200)throw new Error("Public benchmark stopped on HTTP "+response.status);
  await pause(1000);
 }
 await pause(5000);
 const cpu=events.map(e=>e.cpuMs).filter(x=>typeof x==="number");
 report.cpuSummary={samples:cpu.length,totalMs:cpu.reduce((a,b)=>a+b,0),meanMs:cpu.length?cpu.reduce((a,b)=>a+b,0)/cpu.length:null,source:cpu.length?"Header-filtered Cloudflare invocation tail":"Unavailable; HTTP timing is not CPU time"};
 report.tailStatus={connected:ready||events.length>0,startupMessageObserved:ready,exit:tailExit,issues:tailIssues};
 report.cpuSummary.p95Ms=summary(cpu).p95Ms;
 report.wallSummary=summary(events.map(e=>e.wallMs));
 report.ttfbSummary=summary(report.samples.map(s=>s.headersMs));
 report.cacheSummary={requests:report.samples.length,hits:report.samples.filter(s=>s.cache==="HIT").length,misses:report.samples.filter(s=>s.cache==="MISS").length,bypasses:report.samples.filter(s=>s.cache==="BYPASS").length};
 report.cacheSummary.hitRate=report.cacheSummary.hits/report.cacheSummary.requests;
 report.finishedAt=new Date().toISOString();
 await writeFile(values.output,JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({phase:values.phase,country:report.clientCountry,requests:report.samples.length,cpu:report.cpuSummary,cache:report.samples.map(s=>s.cache),output:values.output}));
}finally{tail.kill();}
