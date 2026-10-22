import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import path from 'node:path';

const baseline='a5fbb072b1471616ef7ad5172fe0f0241cee40ed';
function run(command,args,options={}){
 const result=spawnSync(command,args,{encoding:'utf8',maxBuffer:8*1024*1024,...options});
 assert.equal(result.error,undefined,`${command} could not run`);
 if(result.status!==0){process.stderr.write(result.stderr||result.stdout||'');throw Error(`${command} exited ${result.status}`);}
 return result.stdout;
}
function walk(directory){return readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{const file=path.posix.join(directory,entry.name);return entry.isDirectory()?walk(file):[file];});}
const intended=[...new Set(run('git',['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean))].sort();
const internal=/(?:^|\/)(?:\.env(?:\.|$)|\.local\/|\.claude\/|\.omx\/|\.vercel\/|\.arise)|^(?:wiki\/|sources\/|loops\/|docs\/reports\/|projectstatus\.html$|WIKI\.md$|hallways\.json$)/i;
const isPrivatePath=file=>file!=='.env.example'&&internal.test(file);
assert.equal(isPrivatePath('.env.example'),false);
for(const fixture of ['.env','.env.local','.ENV','.Env.Local','.ENV.EXAMPLE','.env.production','.env.example.backup','nested/.env.example','nested/.env.local','~/.claude/config.yaml'])assert.equal(isPrivatePath(fixture),true,`Private-path regression: ${fixture}`);
assert(!intended.some(isPrivatePath),'Private state or credentials are included in intended Git files');
function validateEnvExample(source){
 for(const [key,value]of Object.entries(parseEnv(source)))if(/(?:PASSWORD|SECRET|API_KEY|API_TOKEN|DATABASE_URL|REST_TOKEN|AGENT_ID)$/.test(key))assert(!value||/^replace-with-[a-z0-9-]+$/.test(value),`.env.example ${key} must contain a placeholder, never a credential`);
}
validateEnvExample('APP_PASSWORD=replace-with-your-password\nSESSION_SECRET=replace-with-random-characters');
assert.throws(()=>validateEnvExample('APP_PASSWORD=12345'),/placeholder/);
assert.throws(()=>validateEnvExample('SESSION_SECRET=actual-credential-must-fail'),/placeholder/);
const ignore=readFileSync('.vercelignore','utf8').split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#'));
assert.equal(ignore[0],'*','Deployment must start with a deny-all file list');
const allowed=new Set(['!api','!api/app.js','!api/lib','!api/lib/**','!index.html','!styles.css','!src','!src/**','!vendor','!vendor/**','!assets','!assets/**','!package.json','!package-lock.json','!vercel.json','!assets/models/manifest.json']);
assert(ignore.filter(line=>line.startsWith('!')).every(line=>allowed.has(line)),'Deployment includes a path outside the reviewed public/server allowlist');
for(const required of ['assets/raw/**','assets/provider-output/**','assets/references/**','assets/models/**/*.json','!assets/models/manifest.json'])assert(ignore.includes(required),`Deployment exclusion missing: ${required}`);
const deployment=JSON.parse(readFileSync('vercel.json','utf8'));
assert.equal(deployment.functions?.['api/app.js']?.includeFiles,'{index.html,styles.css,src/**,vendor/**,assets/**}','Function file inclusion changed and requires review');
assert.equal(deployment.rewrites,undefined,'Filesystem-first rewrites cannot protect published static files');
assert.deepEqual(deployment.routes,[{src:'/(.*)',dest:'/api/app'}],'Every deployment route must reach the authentication app before static filesystem routing');

const previous=JSON.parse(run('git',['show',`${baseline}:package.json`]));
const current=JSON.parse(readFileSync('package.json','utf8'));
for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])assert.deepEqual(current[field],previous[field],`${field} changed without an authorized dependency request`);

const syntaxFiles=intended.filter(file=>/\.(?:m?js|cjs)$/.test(file));
for(const file of syntaxFiles)run(process.execPath,['--check',file]);
const credentialPatterns=[
 ['private key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['provider token',/\b(?:r8_[A-Za-z0-9]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[0-9A-Za-z-]{20,})\b/],
 ['literal credential',/(?:ELEVENLABS_API_KEY|REPLICATE_API_TOKEN|MESHY_API_KEY|SESSION_SECRET|CHESS_QUOTA_DATABASE_URL|UPSTASH_REDIS_REST_TOKEN)\s*[:=]\s*['"]([^'"\r\n]{12,})['"]/g]
];
const actualSecrets=Object.entries(process.env).filter(([key,value])=>/(?:API_KEY|API_TOKEN|SESSION_SECRET|DATABASE_URL|REST_TOKEN)$/.test(key)&&value.length>=16).map(([,value])=>value);
let scanned=0;
for(const file of intended.filter(file=>file==='.env.example'||/\.(?:m?js|cjs|json|html|css|md|ya?ml|toml|txt)$/.test(file))){
 const source=readFileSync(file,'utf8');scanned++;
 if(file==='.env.example')validateEnvExample(source);
 for(const [label,pattern]of credentialPatterns){
  pattern.lastIndex=0;
  for(const match of source.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))){
   // Fixed test fixtures and dynamic template strings are not account secrets.
   if(label==='literal credential'&&/(?:example\.(?:invalid|neon\.tech)|unit-test|\$\{)/.test(match[1]))continue;
   assert.fail(`${label} found in ${file}; value intentionally omitted`);
  }
 }
 assert(!actualSecrets.some(secret=>source.includes(secret)),`An active environment credential is hardcoded in ${file}`);
 if(file.startsWith('src/'))assert(!/\b(?:ELEVENLABS_API_KEY|CHESS_QUOTA_DATABASE_URL|SESSION_SECRET|UPSTASH_REDIS_REST_TOKEN)\b/.test(source),`Server-only secret name reached browser source ${file}`);
}
function sourceDigest(){const hash=createHash('sha256');for(const file of intended){assert(existsSync(file),`Source disappeared during verification: ${file}`);hash.update(file+'\0');hash.update(readFileSync(file));}return hash.digest('hex');}
const before=sourceDigest(),tests=walk('tests').filter(file=>/\.(?:mjs|cjs)$/.test(file)).sort();
const testOutput=run(process.execPath,['--test',...tests],{timeout:60000});
assert.equal(sourceDigest(),before,'Sources changed during quality verification; rerun against the final files');
process.stdout.write(testOutput);
const evidence={timestamp:new Date().toISOString(),build:run('git',['rev-parse','HEAD']).trim(),sourceDigest:before,baseline,syntaxFiles:syntaxFiles.length,scannedFiles:scanned,dependencyDiff:0,secrets:0,testCommand:[process.execPath,'--test',...tests],testsPassed:true,lint:'not configured',typecheck:'not configured',browserConsole:'separate browser verification required'};
mkdirSync('.local',{recursive:true});writeFileSync('.local/verification-quality.json',JSON.stringify(evidence,null,2));
console.log('QUALITY_OK syntax=1 dependencyDiff=0 secrets=0',JSON.stringify({syntaxFiles:syntaxFiles.length,scannedFiles:scanned,sourceDigest:before,tests:tests.length,lint:'not configured',typecheck:'not configured'}));
