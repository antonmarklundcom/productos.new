import {getPlatformProxy} from 'wrangler';
import bcrypt from 'bcryptjs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {ownerMode, validateOwnerPassword, ownerAccountQuery, consumeHiddenPasswordInput} from './workers-owner-operation.mjs';
import type {D1Binding} from '../workers/d1/database';

/** Owner runs this locally and enters a new staging-only password privately.
 * No public setup route, plaintext file, command argument, or printed secret. */
async function hiddenPassword(prompt:string):Promise<string> {
 if(!stdin.isTTY)throw new Error('Run this command in an interactive terminal.');
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{
  const state={value:'',escape:0};
  function stop(){stdin.removeListener('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n');}
  function onData(chunk:Buffer){
   const event=consumeHiddenPasswordInput(state,chunk.toString('utf8'));
   if(event==='cancel'){stop();reject(new Error('Cancelled'));}
   else if(event==='submit'){stop();resolve(state.value);}
  }
  stdin.on('data',onData);
 });
}
const mode=ownerMode(process.argv.slice(2));
if(mode==='reset')console.log('Reset existing staging owner password only; production login is unchanged.');
const terminal=createInterface({input:stdin,output:stdout});
const email=(await terminal.question('Staging admin email: ')).trim().toLowerCase();
const name=mode==='create'?(await terminal.question('Display name: ')).trim():null;terminal.close();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email.');
const password=await hiddenPassword('New staging-only password (hidden): ');
const confirm=await hiddenPassword('Confirm password (hidden): ');
validateOwnerPassword(password,confirm);
const proxy=await getPlatformProxy<{DB:D1Binding}>({configPath:'workers/d1/remote-test.wrangler.jsonc',persist:false});
try{
 const hash=await bcrypt.hash(password,12);
 const query=ownerAccountQuery(mode,email,hash,name||null);
 const result=await proxy.env.DB.prepare(query.sql).bind(...query.values).run();
 if(result.meta.changes!==1)throw new Error(mode==='reset'?'No active staging owner matched that email; no account was changed.':'An active staging owner already exists. No account was created. Use --reset-password for the existing owner email.');
 console.log(mode==='reset'?'Staging owner password updated; old sessions revoked.':'Staging owner created.');
 console.log('Open https://productos-workers-staging.marklundfaktura.workers.dev/admin/login');
}finally{await proxy.dispose();}
