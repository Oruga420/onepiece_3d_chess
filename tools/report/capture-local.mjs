import {spawnSync} from 'node:child_process';
import {writeFile,mkdir} from 'node:fs/promises';
import {inside,json,root,head,sha256} from './evidence.mjs';

// No provider requests or browser sessions. This is local regression evidence,
// not final production acceptance and not a substitute for A1-A11 release runs.
const args=['--test','tests/rules.test.mjs','tests/state.test.mjs','tests/ai.test.mjs','tests/commands.test.mjs','tests/voice.test.mjs','tests/draw-integration.test.mjs'];
const result=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:120000});
const output=(result.stdout||'')+(result.stderr||'');
await mkdir(inside('sources/reports'),{recursive:true});
const outputPath='sources/reports/local-regressions.txt';await writeFile(inside(outputPath),output);
const count=name=>{const match=output.match(new RegExp('(?:#|ℹ) '+name+' (\\d+)'));return match?Number(match[1]):null;};
const checkpoint=await json('sources/reports/execution-checkpoint.json');
checkpoint.tests.fresh={command:'node '+args.join(' '),checkedAt:new Date().toISOString(),exitCode:result.status,passed:count('pass'),failed:count('fail'),skipped:count('skipped'),cancelled:count('cancelled'),outputPath,outputSha256:await sha256(inside(outputPath)),commit:head(),scope:'Local regression only; production gates still pending'};
await writeFile(inside('sources/reports/execution-checkpoint.json'),JSON.stringify(checkpoint,null,2)+'\n');
console.log(JSON.stringify(checkpoint.tests.fresh));if(result.status!==0)process.exitCode=result.status||1;
