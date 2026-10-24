import assert from "node:assert/strict";
import {test} from "node:test";
import {verifyNativePublicBundle} from "../../workers/d1/build-verification.mjs";
test("public bundle verification requires current cache namespace and expiry contracts",()=>{
 const markers=["D1_PUBLIC_CATALOG_BATCH_FAILED","product:v1:","category:v1:","related:v1:","catalog-data-v2-","x-catalog-expires-at","catalog-navigation-progress"],fixture=markers.join(" ");
 assert.doesNotThrow(()=>verifyNativePublicBundle(fixture));
 for(const marker of markers)assert.throws(()=>verifyNativePublicBundle(fixture.replace(marker,"REMOVED_CONTRACT")),/omitted public latency adapters/);
 assert.throws(()=>verifyNativePublicBundle(fixture.replace("catalog-data-v2-","catalog-data-v1-")),/omitted public latency adapters/);
});
