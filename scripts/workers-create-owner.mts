import {getPlatformProxy} from 'wrangler';
import bcrypt from 'bcryptjs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import type {D1Binding} from '../workers/d1/database';

/** Owner runs this locally and enters a new staging-only password privately.
 * No public setup route, plaintext file, command argument, or printed secret. */
async function hiddenPassword(prompt:string):Promise<string> {
 if(!stdin.isTTY)throw new Error('Run this command in an interactive terminal.');
 stdout.write(prompt);stdin.setRawMode(true);stdin.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  function stop(){stdin.removeListener('data',onData);stdin.setRawMode(false);stdin.pause();stdout.write('\n');}
  function onData(chunk:Buffer){
   for(const character of chunk.toString('utf8')){
    if(character==='\u0003'){stop();reject(new Error('Cancelled'));return;}
    if(character==='\r'||character==='\n'){stop();resolve(value);return;}
    if(character==='\u007f'||character==='\b')value=value.slice(0,-1);
    else if(character.charCodeAt(0)>=32)value+=character;
   }
  }
  stdin.on('data',onData);
 });
}
const terminal=createInterface({input:stdin,output:stdout});
const email=(await terminal.question('Staging admin email: ')).trim().toLowerCase();
const name=(await terminal.question('Display name: ')).trim();terminal.close();
if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid email.');
const password=await hiddenPassword('New staging-only password (hidden): ');
const confirm=await hiddenPassword('Confirm password (hidden): ');
if(password.length<12||password!==confirm)throw new Error('Use at least 12 characters and matching passwords.');
const proxy=await getPlatformProxy<{DB:D1Binding}>({configPath:'workers/d1/remote-test.wrangler.jsonc',persist:false});
try{
 const hash=await bcrypt.hash(password,12);
 const result=await proxy.env.DB.prepare("INSERT INTO users (email,password_hash,role,name) SELECT ?,?,'owner',? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role='owner' AND is_active=1)").bind(email,hash,name||null).run();
 if(!result.meta.changes)throw new Error('An active staging owner already exists; this command never resets an account.');
 console.log('Staging owner created. Open https://productos-workers-staging.marklundfaktura.workers.dev/admin/login');
}finally{await proxy.dispose();}
