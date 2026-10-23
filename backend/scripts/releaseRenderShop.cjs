const fs=require('node:fs');const path=require('node:path');const dotenv=require('dotenv');
const root=path.resolve(__dirname,'..');const env=dotenv.parse(fs.readFileSync(path.join(root,'.env.cloud')));
const serviceId='srv-db6q7g0m7kps73au0bug';
async function request(endpoint,method='GET',body){
 const r=await fetch('https://api.render.com/v1'+endpoint,{method,signal:AbortSignal.timeout(45000),headers:{Authorization:'Bearer '+env.RENDER_API_KEY,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error('Render API HTTP '+r.status);return r.json();
}
(async()=>{
 if(!env.RENDER_API_KEY)throw new Error('Render API key missing');
 const service=await request('/services/'+serviceId);
 if(service.repo?.replace(/\.git$/,'')!=='https://github.com/Truongdoan-02/televaga-bot-platform'||service.branch!=='deploy/free-render-demo'||service.serviceDetails?.plan!=='free')throw new Error('Service identity does not match the existing deployment.');
 console.log(JSON.stringify({service:service.id,url:service.serviceDetails?.url,branch:service.branch,autoDeploy:service.autoDeploy||service.autoDeployTrigger}));
 if(process.argv[2]==='deploy'){
  const commitId=process.argv[3];if(!/^[a-f0-9]{40}$/.test(commitId||''))throw new Error('Exact commit SHA required.');
  const result=await request('/services/'+serviceId+'/deploys','POST',{commitId,clearCache:'do_not_clear'});
  const folder=path.join(root,'data/backups');fs.mkdirSync(folder,{recursive:true});
  fs.writeFileSync(path.join(folder,'shop-release.json'),JSON.stringify({serviceId,deployId:result.id,commitId,url:service.serviceDetails?.url},null,2));
  console.log(JSON.stringify({deployId:result.id,status:result.status,commit:result.commit?.id}));
 }else{
  const deploys=await request('/services/'+serviceId+'/deploys?limit=2');
  console.log(JSON.stringify(deploys.map(item=>({id:item.deploy.id,status:item.deploy.status,commit:item.deploy.commit?.id,createdAt:item.deploy.createdAt}))));
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});