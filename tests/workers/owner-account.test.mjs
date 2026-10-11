import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {ownerMode,validateOwnerPassword,ownerAccountQuery} from '../../scripts/workers-owner-operation.mjs';
function database(){const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL, name TEXT, is_active INTEGER DEFAULT 1, session_version INTEGER DEFAULT 1)");return db;}
const apply=(db,mode,email)=>{const q=ownerAccountQuery(mode,email,'test-hash',null);return db.prepare(q.sql).run(...q.values).changes;};
test('second owner is refused and reset changes only active owner, revoking sessions',()=>{
 const db=database();try{
 assert.equal(apply(db,'create','owner@example.invalid'),1);
 assert.equal(apply(db,'create','other@example.invalid'),0);
 db.exec("INSERT INTO users(email,password_hash,role) VALUES ('staff@example.invalid','old','staff'); INSERT INTO users(email,password_hash,role,is_active) VALUES ('inactive@example.invalid','old','owner',0)");
 assert.equal(apply(db,'reset','missing@example.invalid'),0);
 assert.equal(apply(db,'reset','staff@example.invalid'),0);
 assert.equal(apply(db,'reset','inactive@example.invalid'),0);
 assert.equal(apply(db,'reset','owner@example.invalid'),1);
 assert.equal(db.prepare("SELECT session_version FROM users WHERE email='owner@example.invalid'").get().session_version,2);
 assert.equal(db.prepare("SELECT password_hash FROM users WHERE email='staff@example.invalid'").get().password_hash,'old');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
 }finally{db.close();}
});
test('reset requires explicit mode and password validation rejects short/mismatched input',()=>{
 assert.equal(ownerMode([]),'create');assert.equal(ownerMode(['--reset-password']),'reset');
 assert.throws(()=>ownerMode(['--reset']));assert.throws(()=>ownerMode(['--reset-password','extra']));
 assert.throws(()=>validateOwnerPassword('short','short'));assert.throws(()=>validateOwnerPassword('long-test-password','mismatch'));
 assert.doesNotThrow(()=>validateOwnerPassword('long-test-password','long-test-password'));
});
test('hidden input ignores split navigation sequences and bracketed paste markers',async()=>{
 const {consumeHiddenPasswordInput}=await import('../../scripts/workers-owner-operation.mjs');
 const state={value:'',escape:0};
 assert.equal(consumeHiddenPasswordInput(state,'short\u001b['),'continue');
 consumeHiddenPasswordInput(state,'D\u001b[C\u001bOA\u001b[200~\u001b[201~');
 assert.equal(state.value,'short');assert.throws(()=>validateOwnerPassword(state.value,state.value));
 consumeHiddenPasswordInput(state,'X\u007f');assert.equal(state.value,'short');
 assert.equal(consumeHiddenPasswordInput(state,'\r'),'submit');
 assert.equal(consumeHiddenPasswordInput(state,'\u0003'),'cancel');
});