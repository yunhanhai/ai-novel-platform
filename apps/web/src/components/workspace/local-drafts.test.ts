import { describe, expect, it } from "vitest";
import { saveLocalDraft, findLocalDraft, removeLocalDraft, type DraftScope } from "./local-drafts";
const scope:DraftScope={organizationId:'org',userId:'user',chapterId:'chapter'};
function storage(){const data=new Map<string,string>();return{get length(){return data.size},key:(i:number)=>Array.from(data.keys())[i]??null,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value)},removeItem:(key:string)=>{data.delete(key)}}}
describe('local draft receipts',()=>{
 it('writes exact prose synchronously and isolates users chapters and writers',()=>{const s=storage();saveLocalDraft(s,scope,'writer-a','原稿😀','a'.repeat(64),1);saveLocalDraft(s,{...scope,userId:'other'},'writer-a','另用户','a'.repeat(64),2);saveLocalDraft(s,scope,'writer-b','新稿','b'.repeat(64),3);expect(findLocalDraft(s,scope)?.draft.content).toBe('新稿');expect(findLocalDraft(s,{...scope,chapterId:'other'})).toBeNull();expect(findLocalDraft(s,{...scope,userId:'other'})?.draft.content).toBe('另用户')});
 it('removing an older immutable revision leaves later edits intact',()=>{const s=storage();saveLocalDraft(s,scope,'writer','第一稿','a'.repeat(64),1);const receipt=findLocalDraft(s,scope)!;saveLocalDraft(s,scope,'writer','后改稿','a'.repeat(64),2);expect(removeLocalDraft(s,receipt)).toBe(true);expect(findLocalDraft(s,scope)?.draft.content).toBe('后改稿')});
 it('ignores corrupt or wrong-scope values without clearing them',()=>{const s=storage();saveLocalDraft(s,scope,'writer','正文','a'.repeat(64),1);const key=s.key(0)!;s.setItem(key,'{broken');expect(findLocalDraft(s,scope)).toBeNull();expect(s.getItem(key)).toBe('{broken')});
 it('propagates quota errors so UI can report missing local protection',()=>{const s=storage();s.setItem=()=>{throw new Error('quota')};expect(()=>saveLocalDraft(s,scope,'writer','正文','a'.repeat(64))).toThrow('quota')});
});

it('marks only an immutable foreign revision handled and preserves later edits',async()=>{const{markLocalDraftHandled}=await import('./local-drafts');const s=storage();saveLocalDraft(s,scope,'other-writer','旧草稿','a'.repeat(64),1);const old=findLocalDraft(s,scope)!;markLocalDraftHandled(s,old);expect(findLocalDraft(s,scope)).toBeNull();saveLocalDraft(s,scope,'other-writer','后改稿','a'.repeat(64),2);expect(findLocalDraft(s,scope)?.draft.content).toBe('后改稿');expect(s.getItem(old.key)).toBeNull()});
it('skips a server-matching receipt while still finding a different unsaved draft',()=>{const s=storage();saveLocalDraft(s,scope,'one','未存稿','a'.repeat(64),1);saveLocalDraft(s,scope,'two','服务器正文','b'.repeat(64),2);expect(findLocalDraft(s,scope,'服务器正文')?.draft.content).toBe('未存稿')});

it('releases processed revision text and bookkeeping without retaining obsolete prose',async()=>{
 const{markLocalDraftHandled}=await import('./local-drafts');const s=storage();const receipt=saveLocalDraft(s,scope,'writer','已明确丢弃的正文','a'.repeat(64),1);markLocalDraftHandled(s,receipt);
 expect(s.getItem(receipt.key)).toBeNull();expect(s.length).toBe(0);
});
it('uses immutable keys so handling an old revision cannot affect its newer sibling',async()=>{
 const{markLocalDraftHandled}=await import('./local-drafts');const s=storage();const first=saveLocalDraft(s,scope,'writer','第一稿','a'.repeat(64),1);const later=saveLocalDraft(s,scope,'writer','后来稿','a'.repeat(64),2);
 expect(first.key).not.toBe(later.key);markLocalDraftHandled(s,first);expect(s.getItem(later.key)).toBe(later.raw);expect(findLocalDraft(s,scope)?.draft.content).toBe('后来稿');
});

it('keeps legacy mutable revisions recoverable and never deletes a later legacy value',async()=>{
 const{markLocalDraftHandled}=await import('./local-drafts');const s=storage();const key='ai-novel:unsaved:v1:org:user:chapter:legacy';const make=(content:string,time:number)=>({...scope,version:1,writer:'legacy',revision:crypto.randomUUID(),content,baseHash:'a'.repeat(64),updatedAt:time});s.setItem(key,JSON.stringify(make('旧v1稿',1)));const old=findLocalDraft(s,scope)!;s.setItem(key,JSON.stringify(make('后改v1稿',2)));markLocalDraftHandled(s,old);expect(findLocalDraft(s,scope)?.draft.content).toBe('后改v1稿');expect(s.getItem(key)).not.toBeNull();
});
it('reports only scoped recoverable counts with a conservative storage size estimate',async()=>{
 const{inspectLocalDrafts}=await import('./local-drafts');const s=storage();saveLocalDraft(s,scope,'a','正文甲','a'.repeat(64),1);saveLocalDraft(s,scope,'b','正文乙','b'.repeat(64),2);saveLocalDraft(s,{...scope,userId:'foreign'},'c','外用户正文','a'.repeat(64),3);const before=inspectLocalDrafts(s,scope);expect(before.recoverableCount).toBe(2);expect(before.estimatedBytes).toBeGreaterThan(0);const{markLocalDraftHandled}=await import('./local-drafts');markLocalDraftHandled(s,before.latest!);const after=inspectLocalDrafts(s,scope);expect(after.recoverableCount).toBe(1);expect(after.estimatedBytes).toBeLessThan(before.estimatedBytes);
});
it('failed write keeps prior immutable text available',()=>{
 const s=storage();const old=saveLocalDraft(s,scope,'writer','不能丢的旧稿','a'.repeat(64),1);s.setItem=()=>{throw new Error('quota')};expect(()=>saveLocalDraft(s,scope,'writer','写不下的新稿','a'.repeat(64),2)).toThrow();expect(s.getItem(old.key)).toBe(old.raw);
});

it('refuses to remove an immutable key whose stored bytes were unexpectedly changed',()=>{const s=storage();const receipt=saveLocalDraft(s,scope,'writer','原记录','a'.repeat(64));s.setItem(receipt.key,'changed');expect(removeLocalDraft(s,receipt)).toBe(false);expect(s.getItem(receipt.key)).toBe('changed')});
it('ignores v2 data whose physical key does not match payload revision',()=>{const s=storage();const receipt=saveLocalDraft(s,scope,'writer','合成稿','a'.repeat(64));s.removeItem(receipt.key);s.setItem(receipt.key+'wrong',receipt.raw);expect(findLocalDraft(s,scope)).toBeNull();expect(s.length).toBe(1)});
