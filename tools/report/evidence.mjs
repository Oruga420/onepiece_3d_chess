import {createHash} from 'node:crypto';
import {readFile,readdir,stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const sha256=async file=>digest(await readFile(file));
export function inside(relative){
 const file=path.resolve(root,relative);
 if(file!==root&&!file.startsWith(root+path.sep))throw Error('Evidence path escapes repository');
 return file;
}
export const json=async relative=>JSON.parse(await readFile(inside(relative),'utf8'));
export const head=()=>execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const productFiles=['index.html','styles.css','server.js','package.json','package-lock.json','vercel.json','.vercelignore'];
const productFolders=['src','api','vendor','assets'];
function deployAsset(relative){
 if(!relative.startsWith('assets/'))return true;
 return !/^assets\/(?:raw|provider-output|references)\//.test(relative)&&
  !/\.(?:blend|zip)$/i.test(relative)&&
  (!/^assets\/models\/.*\.json$/.test(relative)||relative==='assets/models/manifest.json');
}
export async function sourceSnapshot(){
 const files=[...productFiles];
 async function walk(relative){
  for(const entry of await readdir(inside(relative),{withFileTypes:true})){
   const name=relative+'/'+entry.name;
   if(entry.isSymbolicLink())throw Error('Product snapshot refuses symlink '+name);
   if(entry.isDirectory())await walk(name);else if(entry.isFile()&&deployAsset(name))files.push(name);
  }
 }
 for(const folder of productFolders)await walk(folder);
 const entries=[];
 for(const file of files.sort())entries.push({path:file,bytes:(await stat(inside(file))).size,sha256:await sha256(inside(file))});
 return {commit:head(),sourceSha256:digest(JSON.stringify(entries)),files:entries};
}
