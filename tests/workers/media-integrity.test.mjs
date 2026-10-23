import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileMedia} from '../../scripts/workers-media-integrity.mjs';
const page=items=>[{items,complete:true}];
test('reports missing, incomplete and hash/dimension mismatch; protects recent/ambiguous orphans',()=>{
 const report=reconcileMedia({now:Date.parse('2026-10-23'),referencePages:page([{id:1,variants:[{key:'missing'},{key:'bad',sha256:'a',size:1,width:2,height:2}]},{id:2,variants:[]}]),objectPages:page([{key:'bad',sha256:'b',size:1,width:3,height:2},{key:'old',uploaded:'2026-10-01'},{key:'recent',uploaded:'2026-10-22T23:00:00Z'},{key:'unknown'},{key:'pending',uploaded:'2026-10-01',pending:true}])});
 assert.deepEqual(report.missing,['missing']);assert.equal(report.mismatched.length,2);assert.equal(report.incomplete.length,1);assert.deepEqual(report.candidateOrphans,[]);assert.deepEqual(report.protected,['old','recent','unknown','pending']);assert.equal(report.mode,'report-only');
});
test('refuses incomplete pages and duplicate inventory keys',()=>{assert.throws(()=>reconcileMedia({referencePages:[{items:[],complete:false}],objectPages:page([])}),/INCOMPLETE/);assert.throws(()=>reconcileMedia({referencePages:page([]),objectPages:page([{key:'a'},{key:'a'}])}),/AMBIGUOUS/);});

