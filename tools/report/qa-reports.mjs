import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {inside} from './evidence.mjs';

await mkdir(inside('sources/reports'),{recursive:true});
const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
const report={checkedAt:new Date().toISOString(),reference:'Installed take-controlish contract-template.html, unchanged design tokens and layout',pages:[],passed:false};
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},colorScheme:'light'}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 for(const [name,file] of [['ultraplan','docs/reports/epic-chess-ultraplan.html'],['contract','docs/reports/epic-chess-contract.html'],['status','projectstatus.html']]){
  const html=await readFile(inside(file),'utf8');assert.doesNotMatch(html,/\{\{[A-Z_]+\}\}/);assert.match(html,/66/);
  await page.goto(pathToFileURL(inside(file)).href);await page.screenshot({path:inside('sources/reports/report-'+name+'-desktop.png'),fullPage:false});
  const result=await page.evaluate(()=>({title:document.title,width:document.documentElement.scrollWidth,viewport:innerWidth,h1:document.querySelector('h1')?.textContent,rows:document.querySelectorAll('tbody tr').length}));
  assert(result.h1);assert(result.width<=result.viewport+1,'Desktop document overflow '+name);report.pages.push({name,...result});
 }
 assert.equal(errors.length,0);report.errors=errors;report.passed=true;console.log('REPORT_HTML_QA_OK pages=3 overflow=0 unresolvedPlaceholders=0');
}catch(error){report.error=error.stack;console.error(error.message);process.exitCode=1;}
finally{await browser.close();await writeFile(inside('sources/reports/report-html-qa.json'),JSON.stringify(report,null,2)+'\n');}
