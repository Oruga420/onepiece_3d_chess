import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {writeFile,unlink} from 'node:fs/promises';
import {inside,root,sha256} from './evidence.mjs';

const cases=[];
function run(file){return spawnSync(process.execPath,['scripts/verify-delivery.mjs','--evidence',file,'--result','sources/reports/fixture-delivery-validation.json'],{cwd:root,encoding:'utf8',timeout:30000});}
const missing=run('sources/reports/fixture-nonexistent-evidence.json');
assert.equal(missing.status,1);assert.match(missing.stderr,/DELIVERY_INCOMPLETE/);assert.doesNotMatch(missing.stdout,/DELIVERY_OK/);cases.push('missing manifest rejected');
const fixturePath='sources/reports/fixture-incomplete-delivery.json';
await writeFile(inside(fixturePath),JSON.stringify({schemaVersion:1,testFixture:true,release:null,gates:{A1:{passed:true,exitCode:0,command:'fixture only'}},humanMicrophone:{verified:false},artifacts:{},visible:[]}));
const incomplete=run(fixturePath);assert.equal(incomplete.status,1);assert.match(incomplete.stderr,/human microphone.*pending/);assert.doesNotMatch(incomplete.stdout,/DELIVERY_OK/);cases.push('passing boolean without actual output rejected; human gate remains pending');
const syntheticPath='sources/reports/fixture-synthetic-microphone.json';
await writeFile(inside(syntheticPath),JSON.stringify({testFixture:true,mode:'SYNTHETIC_LOOPBACK',audioIn:true,audioOut:true,selection:true,confirmedMove:true,stop:true,sessionClosed:true}));
await writeFile(inside(fixturePath),JSON.stringify({schemaVersion:1,testFixture:true,release:null,gates:{},humanMicrophone:{verified:true,observedBy:'root',checkedAt:new Date().toISOString(),evidencePath:syntheticPath,sha256:await sha256(inside(syntheticPath))},artifacts:{},visible:[]}));
const synthetic=run(fixturePath);assert.equal(synthetic.status,1);assert.match(synthetic.stderr,/SYNTHETIC_LOOPBACK/);assert.doesNotMatch(synthetic.stdout,/DELIVERY_OK/);cases.push('synthetic loopback refused as genuine human microphone proof');
for(const file of [fixturePath,syntheticPath,'sources/reports/fixture-delivery-validation.json'])await unlink(inside(file));
await writeFile(inside('sources/reports/delivery-tool-tests.json'),JSON.stringify({checkedAt:new Date().toISOString(),passed:true,cases,scope:'Negative fixture tests only; no gate approved, no provider request, no product files changed'},null,2)+'\n');
console.log('DELIVERY_NEGATIVE_TESTS_OK cases='+cases.length);
