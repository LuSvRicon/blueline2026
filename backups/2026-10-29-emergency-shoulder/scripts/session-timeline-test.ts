import assert from 'node:assert/strict';
import {SessionRecorder} from '../src/sim/SessionRecorder.ts';
const recorder=new SessionRecorder<number>(5);
const session=(frames:unknown[])=>JSON.stringify({version:1,frames});
assert(recorder.load(session([{time:.1,value:1},{time:.9,value:2},{time:1,value:3}])));
recorder.startPlayback();
assert.equal(recorder.advance(.5)!.frame.value,1,'variable timestamps played a future frame');
assert.equal(recorder.advance(.41)!.frame.value,2,'variable timestamps skipped a frame');
assert.equal(recorder.advance(.09)!.frame.value,3);
for(const frames of [
 [{time:.1,value:4},{time:.2}],
 [{time:.2,value:4},{time:.1,value:5}],
 [{time:.1,value:4},{time:.1,value:5}],
 [{time:-1,value:4}], [{time:null,value:4}],
 Array.from({length:6},(_,i)=>({time:i,value:i})),
]){
 const before=recorder.serialize();
 assert(!recorder.load(session(frames)),'invalid timeline was accepted');
 assert.equal(recorder.serialize(),before,'failed import corrupted the previous recording');
}
recorder.startPlayback();assert.equal(recorder.advance(NaN),null);assert.equal(recorder.playhead,0);
recorder.startRecording();recorder.record(1,NaN);recorder.record(1,-1);recorder.record(1,0);
assert.equal(recorder.frames.length,0);recorder.record(2,.1);assert.equal(recorder.frames.length,1);
console.log('SESSION-TIMELINE PASS — timestamp-based replay, atomic import, monotonic/finite/size validation and invalid delta guards.');
assert(recorder.load(session([{time:10,value:1},{time:20,value:2}])));
recorder.startPlayback();assert.equal(recorder.advance(.1),null,'first snapshot played before its actual timestamp');
assert.equal(recorder.advance(9.9)!.frame.time,10);
