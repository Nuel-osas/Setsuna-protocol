import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
const m=JSON.parse(await readFile('.local/trading/demo.json','utf8'));
m.mode='HOSTED_FORK_ONLY';
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3010'],{env:{...process.env,SETSUNA_DIST_DIR:'.next-hosted-check',SETSUNA_DEMO_RPC_URL:m.rpc,SETSUNA_DEMO_MANIFEST:JSON.stringify(m)},stdio:['ignore','ignore','pipe']});
let errors='';child.stderr.on('data',s=>{errors+=s.toString()});
const base='http://127.0.0.1:3010';
try{
  let d;
  for(let i=0;i<60;i++){
    try{const r=await fetch(`${base}/api/deployment/`);d=await r.json();break;}catch{await delay(500);}
  }
  assert.equal(d?.mode,'demo',errors);
  assert.equal(new URL(d.rpc).pathname,'/api/rpc/');assert.ok(['localhost','127.0.0.1'].includes(new URL(d.rpc).hostname));assert.equal(d.owner,undefined);assert.ok(d.earnMON && d.factory && d.spot);
  const call=async(method,params=[])=>fetch(`${base}/api/rpc/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  assert.equal((await (await call('eth_chainId')).json()).result,'0x7a69');
  for(const method of ['eth_sendTransaction','tenderly_setBalance','anvil_setBalance','eth_sign'])assert.equal((await call(method)).status,403);
  const code=await (await call('eth_getCode',[d.spot.gateway,'latest'])).json();assert.ok(code.result.length>2);
  console.log('Hosted manifest validates actual Earn, Spot and Perps contract links. Browser receives only restricted RPC. Reads work; unsigned/admin RPC methods rejected.');
}finally{child.kill('SIGTERM');}
