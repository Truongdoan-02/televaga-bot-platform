import { test } from 'node:test';
import assert from 'node:assert/strict';
test('order administration requires login and exposes list/detail/actions to authenticated admin',async()=>{
 process.env.ADMIN_EMAIL='orders-test@example.com';process.env.ADMIN_PASSWORD='orders-test-password';
 const {default:express}=await import('express');const {createAuthRouter,requireAdmin}=await import('./adminAuth.js');const {default:routes}=await import('../routes/orderAdminRoutes.js');const {orderAdminService,OrderAdminError}=await import('./orderAdminService.js');
 const old={list:orderAdminService.list,detail:orderAdminService.detail,action:orderAdminService.action};let changes=0;
 orderAdminService.list=async()=>({orders:[],nextCursor:null});orderAdminService.detail=async id=>({id} as any);orderAdminService.action=async(id,value)=>{changes++;if((value as any).action==='bad')throw new OrderAdminError('Invalid',409);return {id,status:'CONFIRMED'} as any;};
 const app=express();app.use(express.json());app.use('/auth',createAuthRouter(()=>{}));app.use('/api/orders',requireAdmin,routes);const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const address=server.address();if(!address||typeof address==='string')throw Error();const base='http://127.0.0.1:'+address.port;
 try{
  assert.equal((await fetch(base+'/api/orders')).status,401);assert.equal((await fetch(base+'/api/orders/1/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'approve',expectedStatus:'NEW'})})).status,401);assert.equal(changes,0);
  const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'orders-test@example.com',password:'orders-test-password'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await fetch(base+'/api/orders',{headers:{cookie}})).status,200);assert.equal((await fetch(base+'/api/orders/1',{headers:{cookie}})).status,200);
  const response=await fetch(base+'/api/orders/1/action',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'approve',expectedStatus:'NEW'})});assert.equal(response.status,200);assert.equal((await response.json() as any).data.status,'CONFIRMED');assert.equal(changes,1);
  assert.equal((await fetch(base+'/api/orders/1/action',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({action:'bad',expectedStatus:'NEW'})})).status,409);
 }finally{orderAdminService.list=old.list;orderAdminService.detail=old.detail;orderAdminService.action=old.action;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});