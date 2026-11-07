import { test, expect, type Page } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";
async function setup(page: Page) {
  await warmUpAuthRoutes(page); await page.goto("/register"); const stamp = `${Date.now()}-${Math.floor(Math.random()*10000)}`;
  await page.locator('input[type="email"]').fill(`save-${stamp}@example.com`); await page.locator('input[type="text"]').first().fill("保存冲突验证"); await page.locator('input[type="password"]').fill("editor-save-test-pass");
  await page.getByRole("button", { name: "注册" }).click(); await page.waitForURL("**/projects");
  const fixture = await page.evaluate(async stamp => {
    const create=async(url:string,body:unknown)=>(await(await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)})).json()).data;
    const p=await create('/api/projects',{title:'保存冲突合成',slug:`save-${stamp}`});const a=await create(`/api/projects/${p.id}/chapters`,{title:'冲突章甲'});await create(`/api/projects/${p.id}/chapters`,{title:'冲突章乙'});
    const base=(await(await fetch(`/api/chapters/${a.id}`)).json()).data;
    const save=await fetch(`/api/chapters/${a.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'共同原文。',baseContentHash:base.contentHash})});if(!save.ok)throw new Error('fixture save failed');return{projectId:p.id as string,chapterId:a.id as string};
  },stamp);
  await page.goto(`/projects/${fixture.projectId}/workspace`); await expect(page.locator('.editor-textarea')).toHaveValue('共同原文。'); return fixture;
}
async function remoteSave(page: Page, chapterId: string, content: string) {
  return page.evaluate(async({chapterId,content})=>{const base=(await(await fetch(`/api/chapters/${chapterId}`)).json()).data;const response=await fetch(`/api/chapters/${chapterId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,baseContentHash:base.contentHash})});return response.status},{chapterId,content});
}
async function stored(page: Page, chapterId: string) { return page.evaluate(async id=>(await(await fetch(`/api/chapters/${id}`)).json()).data.content,chapterId); }

test('旧页面自动保存409保留本地，明确保留本地后才覆盖远端',async({page})=>{
  const f=await setup(page);expect(await remoteSave(page,f.chapterId,'远端新稿。')).toBe(200);
  await page.locator('.editor-textarea').fill('本地独立稿。');
  await expect(page.locator('.external-update-notice')).toContainText('远端正文已更新');await expect(page.locator('.editor-textarea')).toHaveValue('本地独立稿。');expect(await stored(page,f.chapterId)).toBe('远端新稿。');
  await page.getByRole('button',{name:'保留本地',exact:true}).click();await expect(page.locator('.save-status')).toHaveText('已保存');expect(await stored(page,f.chapterId)).toBe('本地独立稿。');
});
test('冲突未解决时不提交AI、不切章且失败放弃不丢本地',async({page})=>{
  const f=await setup(page);expect(await remoteSave(page,f.chapterId,'远端最新稿。')).toBe(200);await page.locator('.editor-textarea').fill('本地未存稿。');await expect(page.locator('.external-update-notice')).toContainText('远端正文已更新');
  let submitted=0;await page.route('**/api/generation-jobs',async route=>{submitted++;await route.abort()});await page.getByRole('button',{name:'去 AI 味',exact:true}).click();expect(submitted).toBe(0);
  await page.locator('.chapter-item').filter({hasText:'冲突章乙'}).click();await expect(page.locator('.editor-header h1')).toContainText('冲突章甲');
  await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='GET')await route.fulfill({status:503,json:{success:false}});else await route.continue()});
  await page.getByRole('button',{name:'放弃本地改动',exact:true}).click();await expect(page.locator('.editor-textarea')).toHaveValue('本地未存稿。');await expect(page.locator('.external-update-notice')).toBeVisible();
  await page.unroute(`**/api/chapters/${f.chapterId}`);await page.getByRole('button',{name:'放弃本地改动',exact:true}).click();await expect(page.locator('.editor-textarea')).toHaveValue('远端最新稿。');
});
test('keepalive携带基线且冲突不会清除本地保护',async({page})=>{
  const f=await setup(page);expect(await remoteSave(page,f.chapterId,'后台更新稿。')).toBe(200);let keepaliveBody:Record<string,unknown>|null=null;
  await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='PATCH')keepaliveBody=route.request().postDataJSON();await route.continue()});
  await page.locator('.editor-textarea').fill('离页前本地稿。');
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
  await expect.poll(()=>keepaliveBody).not.toBeNull();expect(keepaliveBody!.baseContentHash).toMatch(/^[a-f0-9]{64}$/);await expect(page.locator('.external-update-notice')).toContainText('远端正文已更新');expect(await stored(page,f.chapterId)).toBe('后台更新稿。');
  await expect(page.locator('.editor-textarea')).toHaveValue('离页前本地稿。');
});

test('旧普通保存挂起时keepalive必须立即发送最新稿',async({page})=>{
 const f=await setup(page);const held:import('@playwright/test').Route[]=[];
 await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='PATCH'){held.push(route);return}await route.continue()});
 await page.locator('.editor-textarea').fill('普通保存旧稿。');await expect.poll(()=>held.length).toBe(1);
 await page.locator('.editor-textarea').fill('离页时最新稿。');await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'))});
 await expect.poll(()=>held.length).toBe(2);
 expect(held[1]!.request().postDataJSON().content).toBe('离页时最新稿。');
 await held[1]!.continue();await expect.poll(()=>stored(page,f.chapterId)).toBe('离页时最新稿。');await held[0]!.continue();
 await expect(page.locator('.editor-textarea')).toHaveValue('离页时最新稿。');expect(await stored(page,f.chapterId)).toBe('离页时最新稿。');
});
test('创建新章等待期间的新输入先保存，确认失败时留在原章',async({page})=>{
 const f=await setup(page);let created:import('@playwright/test').Route|null=null;
 await page.route(`**/api/projects/${f.projectId}/chapters`,async route=>{if(route.request().method()==='POST'){created=route;return}await route.continue()});
 await page.getByRole('button',{name:'+ 新建',exact:true}).click();await page.getByPlaceholder('章节标题').fill('等待中新章');await page.getByRole('button',{name:'创建',exact:true}).click();await expect.poll(()=>Boolean(created)).toBe(true);
 await page.locator('.editor-textarea').fill('创建期间继续输入。');
 await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='PATCH')await route.fulfill({status:503,json:{success:false}});else await route.continue()});
 await created!.continue();await expect(page.locator('.chapter-item').filter({hasText:'等待中新章'})).toBeVisible();
 await expect(page.locator('.editor-header h1')).toContainText('冲突章甲');await expect(page.locator('.editor-textarea')).toHaveValue('创建期间继续输入。');
});

test('同一登录的两个页面保存旧稿时只接受最新基线',async({page,context})=>{
 const f=await setup(page);const other=await context.newPage();await other.goto(`/projects/${f.projectId}/workspace`);await expect(other.locator('.editor-textarea')).toHaveValue('共同原文。');
 await page.locator('.editor-textarea').fill('甲页面确认稿。');await expect(page.locator('.save-status')).toHaveText('已保存');
 await other.locator('.editor-textarea').fill('乙页面未存稿。');await expect(other.locator('.external-update-notice')).toBeVisible();
 expect(await stored(page,f.chapterId)).toBe('甲页面确认稿。');await expect(other.locator('.editor-textarea')).toHaveValue('乙页面未存稿。');
 await other.getByRole('button',{name:'放弃本地改动',exact:true}).click();await expect(other.locator('.editor-textarea')).toHaveValue('甲页面确认稿。');await other.close();
});
test('保存已写库但确认丢失，同稿重试可以恢复确认',async({page})=>{
 const f=await setup(page);let first=true;
 await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='PATCH'&&first){first=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort('failed');return}await route.continue()});
 await page.locator('.editor-textarea').fill('确认丢失稿。');await expect(page.locator('.save-status')).toHaveText('保存失败');expect(await stored(page,f.chapterId)).toBe('确认丢失稿。');
 await page.locator('.chapter-item').filter({hasText:'冲突章乙'}).click();await expect(page.locator('.editor-header h1')).toContainText('冲突章乙');
 await page.locator('.chapter-item').filter({hasText:'冲突章甲'}).click();await expect(page.locator('.editor-textarea')).toHaveValue('确认丢失稿。');
});
test('保留本地读取失败不清冲突也不覆盖远端',async({page})=>{
 const f=await setup(page);await remoteSave(page,f.chapterId,'远端不应覆盖稿。');await page.locator('.editor-textarea').fill('本地应保留稿。');await expect(page.locator('.external-update-notice')).toBeVisible();
 await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='GET')await route.fulfill({status:503,json:{success:false}});else await route.continue()});await page.getByRole('button',{name:'保留本地',exact:true}).click();
 await expect(page.locator('.external-update-notice')).toBeVisible();await expect(page.locator('.editor-textarea')).toHaveValue('本地应保留稿。');await page.unroute(`**/api/chapters/${f.chapterId}`);expect(await stored(page,f.chapterId)).toBe('远端不应覆盖稿。');
});

test('冲突发生后迟到的旧保存确认不能允许离开或启动任务',async({page})=>{
 const f=await setup(page);let complete=false;let ack:import('@playwright/test').Route|null=null;let savedBody:unknown;
 const id='66666666-6666-4666-8666-666666666666';
 await page.route('**/api/generation-jobs',async route=>{await route.fulfill({status:201,json:{success:true,data:{id,jobType:'DESLOP',status:'QUEUED'}}})});
 await page.route(`**/api/generation-jobs/${id}`,async route=>{await route.fulfill({json:{success:true,data:{id,jobType:'DESLOP',status:complete?'SUCCEEDED':'RUNNING',progress:'0',output:null,errorMessage:null,startedAt:null,finishedAt:null}}})});
 await page.getByRole('button',{name:'去 AI 味',exact:true}).click();
 let first=true;await page.route(`**/api/chapters/${f.chapterId}`,async route=>{if(route.request().method()==='PATCH'&&first){first=false;const response=await route.fetch();expect(response.status()).toBe(200);savedBody=await response.json();ack=route;return}await route.continue()});
 await page.locator('.editor-textarea').fill('本地旧确认稿。');await expect.poll(()=>Boolean(ack)).toBe(true);
 expect(await remoteSave(page,f.chapterId,'随后远端更新稿。')).toBe(200);complete=true;
 await expect(page.locator('.external-update-notice')).toBeVisible();await ack!.fulfill({json:savedBody});
 await expect(page.locator('.save-status')).toHaveText('保存失败');
 await page.locator('.chapter-item').filter({hasText:'冲突章乙'}).click();await expect(page.locator('.editor-header h1')).toContainText('冲突章甲');
 await expect(page.locator('.editor-textarea')).toHaveValue('本地旧确认稿。');expect(await stored(page,f.chapterId)).toBe('随后远端更新稿。');
});
