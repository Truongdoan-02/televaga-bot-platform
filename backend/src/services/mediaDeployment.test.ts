import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlink } from 'node:fs/promises';
import { telegramMedia } from './telegramMedia.js';
import { uploadFilePath, uploadRange } from './uploadStore.js';
import { db } from '../database/connection.js';
import { telegramService } from './telegramService.js';
import { setManagedBotEnabled } from '../controllers/botController.js';
test('paths reject traversal and byte ranges support videos', () => {
  for (const url of ['/uploads/../.env','/uploads/a/../../b','/elsewhere/a']) assert.throws(() => uploadFilePath(url));
  assert.deepEqual(uploadRange('bytes=2-5',10),{start:2,end:5});
  assert.deepEqual(uploadRange('bytes=-3',10),{start:7,end:9});
  assert.deepEqual(uploadRange('bytes=4-',10),{start:4,end:9});
  assert.equal(uploadRange('bytes=12-',10),null);
});
test('Telegram photos, documents and voice are recognized',()=>{
 assert.equal(telegramMedia({photo:[{file_id:'small'},{file_id:'large'}]})?.fileId,'large');
 assert.equal(telegramMedia({document:{file_id:'file',file_name:'invoice.pdf'}})?.type,'document');
 assert.equal(telegramMedia({voice:{file_id:'voice'}})?.type,'audio');
});
test('bot toggle synchronizes pollers for both enable and disable',async()=>{
 const get=db.getManagedBots,update=db.updateManagedBot,sync=telegramService.syncManagedBots;
 let enabled=false;const calls:boolean[]=[];const bot:any={id:'test',name:'test',token:'test',status:'connected',telegramBotId:'1'};
 try{db.getManagedBots=async()=>[bot];db.updateManagedBot=async(_id,_name,_token,changes)=>{enabled=Boolean(changes?.isEnabled);return {...bot,...changes}};
 telegramService.syncManagedBots=async()=>{calls.push(enabled)};
 const res:any={json(){},status(){return this}};
 for(const isEnabled of [true,false])await setManagedBotEnabled({params:{id:'test'},body:{isEnabled}} as any,res);
 assert.deepEqual(calls,[true,false]);
 }finally{db.getManagedBots=get;db.updateManagedBot=update;telegramService.syncManagedBots=sync;}
});
test('photo without caption is saved to durable media and deduplicated',async()=>{
 const methods=['getChats','getUserByTelegramId','upsertTelegramUser','upsertTelegramChat','getMessageById','addMessage','saveUploadAsset'] as const;
 const original=Object.fromEntries(methods.map(key=>[key,db[key]]));const fetch=globalThis.fetch;const saved:any[]=[];let url='',downloads=0;
 try{
 const user:any={id:'user',avatarUrl:'/uploads/avatar.jpg'};const chat:any={id:'chat',telegramChatId:'123',avatarUrl:'/uploads/avatar.jpg',participantIds:[],type:'direct'};
 db.getChats=async()=>[chat];db.getUserByTelegramId=async()=>user;db.upsertTelegramUser=async()=>user;db.upsertTelegramChat=async input=>input;
 db.getMessageById=async()=>saved[0]||null;db.addMessage=async message=>{saved.push(message);return message};db.saveUploadAsset=async(path,data)=>{url=path;assert.equal(data.length,4)};
 globalThis.fetch=async input=>{if(String(input).includes('/getFile'))return new Response(JSON.stringify({ok:true,result:{file_path:'photos/file.jpg'}}));downloads++;return new Response(new Uint8Array([1,2,3,4]));};
 const update={message:{message_id:100,date:1,from:{id:456,first_name:'Test'},chat:{id:123,type:'private'},photo:[{file_id:'media-test-photo',file_size:4}]}};
 for(let i=0;i<2;i++)await telegramService.handleWebhookUpdate(update,{botId:'media-test-bot',token:'test-token'});
 assert.equal(saved.length,1);assert.equal(saved[0].type,'image');assert.equal(saved[0].mediaUrl,url);assert.equal(downloads,1);
 }finally{Object.assign(db,original);globalThis.fetch=fetch;if(url)await unlink(uploadFilePath(url)).catch(()=>{});}
});
