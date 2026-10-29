import assert from 'node:assert/strict';
import {ReferencePath} from '../src/world/ReferencePath.ts';
import {ProjectionCache} from '../src/world/ProjectionCache.ts';
import {TRACKS} from '../src/world/track.ts';
let queries=0;
for(const track of TRACKS){
 const path=new ReferencePath(track.controlPoints,6),cache=new ProjectionCache(path);
 for(const direction of [-1,1])for(const offset of [-9,-3.7,0,3.7,9]){
  const actor={};
  for(let i=0;i<800;i++){
   const s=path.length*.8+direction*i*1.7,w=path.toCartesian(s,offset);
   const x=w.x+Math.sin(i*.37)*.35,y=w.y+Math.cos(i*.31)*.35;
   assert.deepEqual(cache.project(actor,x,y),path.toFrenet(x,y),`${track.id}: hinted search changed Frenet projection`);queries++;
  }
  const w=path.toCartesian(path.length*.3,offset);
  assert.deepEqual(cache.project(actor,w.x,w.y),path.toFrenet(w.x,w.y),'teleport failed to invalidate hint');
  const copy=cache.project(actor,w.x,w.y);copy.s=-10;
  assert.deepEqual(cache.project(actor,w.x,w.y),path.toFrenet(w.x,w.y),'caller mutated cached pose');
 }
 console.log(`${track.id}: both directions, road/roadside offsets, noise, loop wrap, teleport match full search`);
}
// Informational CPU microbenchmark; never a GPU/FPS claim or a timing assertion.
const path=new ReferencePath(TRACKS.find(t=>t.id==='motorway')!.controlPoints,6),cache=new ProjectionCache(path),points=Array.from({length:48},(_,i)=>({...path.toCartesian(i*17,3.7),actor:{}}));
let start=performance.now();for(let frame=0;frame<200;frame++)for(const p of points)path.toFrenet(p.x,p.y);const full=performance.now()-start;
start=performance.now();for(let frame=0;frame<200;frame++)for(const p of points)cache.project(p.actor,p.x,p.y);const cached=performance.now()-start;
console.log(`Projection-only CPU: ${full.toFixed(1)}ms full scan vs ${cached.toFixed(1)}ms cache (9600 static observations)`);
console.log(`PROJECTION-CACHE PASS — ${queries} moving observations exactly match full search`);
