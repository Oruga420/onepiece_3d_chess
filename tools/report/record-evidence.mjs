import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {root,inside,json,sha256,sourceSnapshot} from './evidence.mjs';

// Records existing command output; this script neither runs a gate nor approves it.
const flags=process.argv.slice(2),get=name=>flags.includes(name)?flags[flags.indexOf(name)+1]:null;
const target='sources/reports/delivery-evidence.json';
let evidence;try{evidence=await json(target);}catch(error){if(error.code!=='ENOENT')throw error;evidence={schemaVersion:1,release:null,gates:{},humanMicrophone:{verified:false},artifacts:{},visible:[]};}
if(flags.includes('--snapshot')){
 const snapshot=await sourceSnapshot();
 await mkdir(inside('sources/reports'),{recursive:true});
 await writeFile(inside('sources/reports/source-files.json'),JSON.stringify(snapshot,null,2)+'\n');
 evidence.release={...evidence.release,commit:snapshot.commit,sourceSha256:snapshot.sourceSha256,sourceManifestPath:'sources/reports/source-files.json',deploymentId:get('--deployment-id')||null,url:get('--url')||null};
 await writeFile(inside(target),JSON.stringify(evidence,null,2)+'\n');
 console.log('SOURCE_SNAPSHOT '+snapshot.sourceSha256);process.exit(0);
}
const id=get('--id'),output=get('--output'),command=get('--command'),exit=Number(get('--exit'));
if(!/^A(?:[1-9]|10|11)$/.test(id||'')||!output||!command||!flags.includes('--exit')||!Number.isInteger(exit))throw Error('Use --id A1 --command "actual command" --output sources/reports/log.txt --exit 0 [--passed] [--url immutableURL]');
if(!evidence.release?.sourceSha256)throw Error('Record --snapshot after final product changes first');
const current=await sourceSnapshot();
if(current.sourceSha256!==evidence.release.sourceSha256||current.commit!==evidence.release.commit)throw Error('Product changed since snapshot; capture a fresh snapshot and rerun affected gates');
await readFile(inside(output));
evidence.gates[id]={passed:flags.includes('--passed')&&exit===0,command,exitCode:exit,checkedAt:new Date().toISOString(),outputPath:path.relative(root,inside(output)).replaceAll('\\','/'),outputSha256:await sha256(inside(output)),commit:current.commit,sourceSha256:current.sourceSha256,url:get('--url'),deploymentId:get('--deployment-id')};
await writeFile(inside(target),JSON.stringify(evidence,null,2)+'\n');
console.log('EVIDENCE_RECORDED '+id+'; delivery verifier still independently checks output and acceptance assertions');
