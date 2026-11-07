import { test, expect, type Page } from "@playwright/test";
import { warmUpAuthRoutes } from "./helpers";
async function setup(page: Page) {
 await warmUpAuthRoutes(page);await page.goto('/register');const stamp=`${Date.now()}-${Math.floor(Math.random()*10000)}`;
 await page.locator('input[type=email]').fill(`draft-${stamp}@example.com`);await page.locator('input[type=text]').first().fill('本地恢复验证');await page.locator('input[type=password]').fill('local-draft-test-pass');await page.getByRole('button',{name:'注册',exact:true}).click();await page.waitForURL('**/projects');
 const f=await page.evaluate(async stamp=>{const create=async(url:string,body:unknown)=>(await(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json()).data;const p=await create('/api/projects',{title:'本地恢复合成',slug:`draft-${stamp}`});const c=await create(`/api/projects/${p.id}/chapters`,{title:'恢复章甲'});const me=(await(await fetch('/api/auth/me')).json()).data;return{projectId:p.id as string,chapterId:c.id as string,organizationId:me.organizationId as string,userId:me.userId as string}},stamp);
 await page.goto(`/projects/${f.projectId}/workspace`);await expect(page.locator('.editor-textarea')).toBeEnabled();return f;
}
async function failSaves(page:Page,chapterId:string){await page.route(`**/api/chapters/${chapterId}`,async route=>{if(route.request().method()==='PATCH')await route.fulfill({status:503,json:{success:false,error:'合成保存失败'}});else await route.continue()})}

test('保存失败后刷新仍可恢复本地稿，恢复前不自动覆盖远端',async({page})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);const draft='尚未保存的本地正文。';await page.locator('.editor-textarea').fill(draft);await expect(page.locator('.save-status')).toHaveText('保存失败');
 page.on('dialog',dialog=>dialog.accept());await page.reload();
 await expect(page.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();await expect(page.locator('.editor-textarea')).toHaveValue('');
 await page.getByRole('button',{name:'恢复本地稿',exact:true}).click();await expect(page.locator('.editor-textarea')).toHaveValue(draft);
 const remote=await page.evaluate(async id=>(await(await fetch(`/api/chapters/${id}`)).json()).data.content,f.chapterId);expect(remote).toBe('');
});

async function localDraftKeys(page:Page){return page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('ai-novel:unsaved:v1:')&&!key.includes(':handled:')))}
test('恢复旧草稿不覆盖远端新稿，明确保留并保存后清理当前副本',async({page})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);await page.locator('.editor-textarea').fill('本地待恢复稿。');await expect(page.locator('.save-status')).toHaveText('保存失败');page.on('dialog',d=>d.accept());
 await page.unroute(`**/api/chapters/${f.chapterId}`);await page.evaluate(async id=>{const base=(await(await fetch(`/api/chapters/${id}`)).json()).data;await fetch(`/api/chapters/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:'远端较新稿。',baseContentHash:base.contentHash})})},f.chapterId);
 await page.reload();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();await expect(page.locator('.editor-textarea')).toHaveValue('远端较新稿。');
 await page.getByRole('button',{name:'恢复本地稿',exact:true}).click();await expect(page.locator('.editor-textarea')).toHaveValue('本地待恢复稿。');
 expect(await page.evaluate(async id=>(await(await fetch(`/api/chapters/${id}`)).json()).data.content,f.chapterId)).toBe('远端较新稿。');
 await page.getByRole('button',{name:'保留本地',exact:true}).click();await expect(page.locator('.save-status')).toHaveText('已保存');
 await page.reload();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toHaveCount(0);await expect(page.locator('.editor-textarea')).toHaveValue('本地待恢复稿。');
});
test('明确丢弃本地一版不改变服务器正文',async({page})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);await page.locator('.editor-textarea').fill('只在本地的草稿。');await expect(page.locator('.save-status')).toHaveText('保存失败');page.on('dialog',d=>d.accept());await page.reload();
 await page.getByRole('button',{name:'丢弃此本地稿',exact:true}).click();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toHaveCount(0);await page.reload();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toHaveCount(0);await expect(page.locator('.editor-textarea')).toHaveValue('');
});
test('本机存储拒绝有提示但服务器保存继续',async({page})=>{
 const f=await setup(page);await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('ai-novel:unsaved:'))throw new DOMException('quota','QuotaExceededError');return original.call(this,key,value)}});
 await page.locator('.editor-textarea').fill('服务器仍可保存。');await expect(page.getByRole('alert',{name:'本机草稿提示'})).toContainText('备份失败');await expect(page.locator('.save-status')).toHaveText('已保存');
 expect(await page.evaluate(async id=>(await(await fetch(`/api/chapters/${id}`)).json()).data.content,f.chapterId)).toBe('服务器仍可保存。');
});
test('另一页面新修订不被旧恢复或丢弃操作删除',async({page,context})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);await page.locator('.editor-textarea').fill('甲页第一稿。');await expect(page.locator('.save-status')).toHaveText('保存失败');
 const other=await context.newPage();await other.goto(`/projects/${f.projectId}/workspace`);await expect(other.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();
 await page.locator('.editor-textarea').fill('甲页后来新稿。');await other.getByRole('button',{name:'丢弃此本地稿',exact:true}).click();await other.reload();
 await expect(other.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();await other.getByRole('button',{name:'恢复本地稿',exact:true}).click();await expect(other.locator('.editor-textarea')).toHaveValue('甲页后来新稿。');
 expect((await localDraftKeys(page)).length).toBeGreaterThan(0);await other.close();
});

test('发现旧草稿后继续输入，新稿不得被恢复动作覆盖',async({page})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);await page.locator('.editor-textarea').fill('旧恢复稿甲。');await expect(page.locator('.save-status')).toHaveText('保存失败');page.on('dialog',d=>d.accept());await page.reload();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();
 await page.locator('.editor-textarea').fill('当前新输入乙。');await page.getByRole('button',{name:'恢复本地稿',exact:true}).click();
 await expect(page.locator('.editor-textarea')).toHaveValue('当前新输入乙。');await expect(page.getByRole('alert',{name:'本机草稿提示'})).toContainText('未保存的修改');
});
test('恢复后改写再保存，不会反复提示已处理的旧稿',async({page})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);await page.locator('.editor-textarea').fill('恢复来源甲。');await expect(page.locator('.save-status')).toHaveText('保存失败');page.on('dialog',d=>d.accept());await page.reload();await page.getByRole('button',{name:'恢复本地稿',exact:true}).click();
 await page.locator('.editor-textarea').fill('恢复后修订乙。');await page.unroute(`**/api/chapters/${f.chapterId}`);await page.getByRole('button',{name:'保留本地',exact:true}).click();await expect(page.locator('.save-status')).toHaveText('已保存');
 await page.reload();await expect(page.locator('.editor-textarea')).toHaveValue('恢复后修订乙。');await expect(page.getByRole('region',{name:'本地草稿恢复'})).toHaveCount(0);
});

test('其他账号或章节的草稿不进入当前恢复提示',async({page})=>{
 const f=await setup(page);await page.evaluate(({f})=>{const prefix=`ai-novel:unsaved:v1:${f.organizationId}:`;const make=(userId:string,chapterId:string)=>({version:1,organizationId:f.organizationId,userId,chapterId,writer:'foreign',revision:crypto.randomUUID(),content:'不应串入的稿',baseHash:'0'.repeat(64),updatedAt:Date.now()});localStorage.setItem(`${prefix}other-user:${f.chapterId}:foreign`,JSON.stringify(make('other-user',f.chapterId)));localStorage.setItem(`${prefix}${f.userId}:other-chapter:foreign`,JSON.stringify(make(f.userId,'other-chapter')))}, {f});await page.reload();await expect(page.locator('.editor-textarea')).toBeEnabled();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toHaveCount(0);
});
test('防抖尚未到期即刷新，本机副本仍能恢复',async({page})=>{
 const f=await setup(page);await failSaves(page,f.chapterId);await page.locator('.editor-textarea').fill('立即刷新前的最新输入。');page.on('dialog',d=>d.accept());await page.reload();await expect(page.getByRole('region',{name:'本地草稿恢复'})).toBeVisible();await page.getByRole('button',{name:'恢复本地稿',exact:true}).click();await expect(page.locator('.editor-textarea')).toHaveValue('立即刷新前的最新输入。');
});
