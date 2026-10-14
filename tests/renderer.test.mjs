import test from 'node:test';
import assert from 'node:assert/strict';
import {GameRenderer} from '../src/renderer.mjs';
test('asset manifest is shared by overlapping loads and later board updates',async()=>{
 const original=globalThis.fetch;let calls=0,resolve;
 globalThis.fetch=()=>{calls++;return new Promise(r=>{resolve=r;});};
 try{const renderer=Object.create(GameRenderer.prototype),first=renderer.loadManifest(),second=renderer.loadManifest();resolve({ok:true,json:async()=>({assets:[]})});assert.deepEqual(await first,await second);await renderer.loadManifest();assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('a failed manifest load can retry instead of caching permanent failure',async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>({ok:++calls>1,json:async()=>({assets:[]})});
 try{const renderer=Object.create(GameRenderer.prototype);await assert.rejects(()=>renderer.loadManifest(),/Manifest/);assert.deepEqual(await renderer.loadManifest(),{assets:[]});assert.equal(calls,2);}finally{globalThis.fetch=original;}
});
