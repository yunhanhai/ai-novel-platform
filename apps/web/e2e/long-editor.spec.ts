import { test, expect, type Page } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";
async function setup(page: Page) {
 await warmUpAuthRoutes(page);await page.goto('/register');const stamp=`${Date.now()}-${Math.floor(Math.random()*10000)}`;
 await page.locator('input[type=email]').fill(`long-${stamp}@example.com`);await page.locator('input[type=text]').first().fill('长稿输入验证');await page.locator('input[type=password]').fill('long-editor-test-pass');await page.getByRole('button',{name:'注册',exact:true}).click();await page.waitForURL('**/projects');
 const f=await page.evaluate(async stamp=>{const create=async(url:string,body:unknown)=>(await(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()).data;const p=await create('/api/projects',{title:'长稿性能合成',slug:`long-${stamp}`});const c=await create(`/api/projects/${p.id}/chapters`,{title:'长稿合成章'});return{projectId:p.id as string,chapterId:c.id as string}},stamp);
 await page.goto(`/projects/${f.projectId}/workspace`);await expect(page.locator('.editor-textarea')).toBeEnabled();await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='PATCH')await route.fulfill({status:503,json:{success:false}});else await route.continue()});return f;
}
test('长稿逐字输入测量并即时刷新恢复最新文字',async({page},testInfo)=>{
 const f=await setup(page);const editor=page.locator('.editor-textarea');
 await page.evaluate(()=>{
  const target=window as unknown as{longEditor:{inputs:number[];storage:Record<string,number[]>;start:number}};target.longEditor={inputs:[],storage:{set:[],get:[],remove:[]},start:0};
  document.addEventListener('input',event=>{if((event.target as HTMLElement)?.classList.contains('editor-textarea'))target.longEditor.start=performance.now()},true);
  document.addEventListener('input',event=>{if((event.target as HTMLElement)?.classList.contains('editor-textarea'))target.longEditor.inputs.push(performance.now()-target.longEditor.start)});
  for(const[method,label]of[['setItem','set'],['getItem','get'],['removeItem','remove']]as const){const original=Storage.prototype[method];Object.defineProperty(Storage.prototype,method,{configurable:true,value:function(...args:unknown[]){const start=performance.now();try{return(original as(...a:unknown[])=>unknown).apply(this,args)}finally{if(String(args[0]).startsWith('ai-novel:unsaved:'))target.longEditor.storage[label]!.push(performance.now()-start)}}})}
 });
 const receipts=[];
 for(const chars of[20000,100000]){
  const initial='长稿测量。'.repeat(Math.ceil(chars/5)).slice(0,chars);await editor.fill(initial);
  await page.evaluate(()=>{const data=(window as unknown as{longEditor:{inputs:number[];storage:Record<string,number[]>}}).longEditor;data.inputs=[];for(const key of Object.keys(data.storage))data.storage[key]=[]});
  await editor.press('ControlOrMeta+End');await page.keyboard.type('abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwx');
  const stats=await page.evaluate(()=>{const data=(window as unknown as{longEditor:{inputs:number[];storage:Record<string,number[]>}}).longEditor;const summary=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return{count:sorted.length,p50:sorted[Math.floor(sorted.length*.5)]??0,p95:sorted[Math.floor(sorted.length*.95)]??0,max:sorted.at(-1)??0,total:sorted.reduce((a,b)=>a+b,0)}};return{input:summary(data.inputs),storage:Object.fromEntries(Object.entries(data.storage).map(([key,value])=>[key,summary(value)]))}});
  receipts.push({chars,...stats});
 }
 const latest=await editor.inputValue();page.on('dialog',d=>d.accept());await page.reload();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();await page.getByRole('button',{name:'恢复本地稿',exact:true}).click();await expect(editor).toHaveValue(latest);
 await testInfo.attach('long-editor-metrics',{body:JSON.stringify({mode:'development',networkModelCalls:0,receipts},null,2),contentType:'application/json'});console.log('LONG_EDITOR_METRICS '+JSON.stringify(receipts));
});
