// One complete release run on one frozen source. Keep the longest scenarios
// in separate processes so independent simulations can use separate cores.
// npm test remains the regular sequential runner with the same exact test list.
import {readFileSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {sourceFingerprint} from '../../scripts/source-fingerprint.mjs';
const root=fileURLToPath(new URL('../..',import.meta.url));
const output=fileURLToPath(new URL('.',import.meta.url));
const runner=readFileSync(join(root,'scripts/test.mjs'),'utf8');
const names=[...runner.matchAll(/^  "([a-z0-9-]+)",$/gm)].map(match=>match[1]);
if(names.length<70||new Set(names).size!==names.length)throw Error('Cannot recover complete unique test inventory');
const shards = [
 ['network-matrix-test'],
 ['adas-endurance-test'],
 ['adas-noisy-sequence-test', 'traffic-flow-test'],
 ['adas-coordination-audit', 'learn-test'],
];
let next = 0;
for (const name of names) {
 if (!shards.some(shard => shard.includes(name))) shards[next++ % shards.length].push(name);
}
if(shards.flat().length!==names.length||new Set(shards.flat()).size!==names.length)throw Error('Incomplete release coverage');
const before=sourceFingerprint(root),startedAt=new Date().toISOString();
writeFileSync(join(output,'source-manifest.json'),JSON.stringify(before,null,2));
console.log(`RELEASE START ${startedAt} SOURCE ${before.sha256}, ${names.length} checks in ${shards.length} independent processes`);
const results=await Promise.all(shards.map((tests,index)=>new Promise(resolve=>{
 const log=`release-shard-${index+1}.log`,fd=openSync(join(output,log),'w');
 const child=spawn(process.execPath,['scripts/test.mjs',...tests],{cwd:root,env:{...process.env,
  AUDIT_SEEDS:'20261109,17,73',AUDIT_ENDURANCE_SECONDS:'3600',AUDIT_ARTIFACT_DIR:join(output,'extended')},stdio:['ignore',fd,fd]});
 let finished=false;const finish=(code,error)=>{if(finished)return;finished=true;closeSync(fd);console.log(`RELEASE SHARD ${index+1} finished code=${code}`);resolve({log,tests,code,error});};
 child.on('error',error=>finish(-1,String(error)));child.on('close',code=>finish(code??-1));
})));
const after=sourceFingerprint(root),endedAt=new Date().toISOString();
const passed=before.sha256===after.sha256&&results.every(result=>result.code===0&&
 readFileSync(join(output,result.log),'utf8').includes(`TEST SUITE PASS — ${result.tests.length} headless checks`));
const report={startedAt,endedAt,sourceBefore:before.sha256,sourceAfter:after.sha256,files:before.files.length,
 orchestratorSha256:createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
 testCount:names.length,shards:results,passed,notes:['All processes use the registered test scripts and their physical assertions.','216 noisy cases and one continuous 3600-second simulated drive are included.','Browser/GPU and real-phone verification are separate.']};
writeFileSync(join(output,'verification.json'),JSON.stringify(report,null,2));
console.log(`RELEASE ${passed?'PASS':'FAIL'} — ${names.length} checks; source ${after.sha256}`);
if(!passed)process.exitCode=1;
