import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rigRuntimeFiles,rigRuntimeHash} from '../tools/assets/rig_runtime_fingerprint.mjs';

test('a choreography-only change invalidates a previously approved runtime',()=>{
 const parent=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(parent,'chess-rig-approval-'));
 try{
  fs.mkdirSync(path.join(root,'src'));
  for(const file of rigRuntimeFiles)fs.writeFileSync(path.join(root,file),'stable '+file);
  const approved=rigRuntimeHash(root),attackFile=path.join(root,'src/attacks.mjs');
  fs.writeFileSync(attackFile,'same controller, different character attack variant');
  assert.notEqual(rigRuntimeHash(root),approved);
  fs.rmSync(attackFile);
  assert.throws(()=>rigRuntimeHash(root),/ENOENT/,'missing choreography cannot retain approval');
 }finally{
  assert(path.resolve(root).startsWith(parent+path.sep),'cleanup stays in the dedicated temporary folder');
  fs.rmSync(root,{recursive:true,force:true});
 }
});
