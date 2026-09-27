// Isolated editor fixture: no production auth bypass or database writes.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../apps/admin/package.json', import.meta.url));
const { createServer } = require('vite');
const react = require('@vitejs/plugin-react');
const root = fileURLToPath(new URL('../..', import.meta.url));
const records = ['Cafe Compute Meetup: Paris','Multimodal AI in Production (w/ The AI Collective)'].map((title,i)=>({id:`seed-${i}`,title,event_date:i?'2026-10-01':'2026-09-30',location:'Paris',event_url:i?'https://luma.com/quicksort-multimodal-ai':'https://luma.com/ccparis',banner_url:`https://www.quicksort.fr/events/${i?'multimodal-ai':'cafe-compute-paris'}.jpg`,published:true,updated_at:new Date().toISOString()}));
const server = await createServer({
 configFile:false,root:fileURLToPath(new URL('.',import.meta.url)),
 plugins:[react(),{name:'event-fixture',configureServer(server){
  server.middlewares.use('/storage/v1',async(req,res)=>{for await(const _ of req){}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({Key:'event-banners/test.jpg'}));});
  server.middlewares.use('/rest/v1/events',async(req,res)=>{
   const url = new URL(req.url,'http://localhost');
   let raw='';for await(const part of req)raw+=part;
   const body=raw?JSON.parse(raw):{};
   const matches=row=>[...url.searchParams].filter(([,v])=>v.startsWith('eq.')).every(([key,value])=>String(row[key])===value.slice(3));
   let result=records.filter(matches);
   if(req.method==='POST'){const row={...body,id:crypto.randomUUID(),updated_at:new Date().toISOString()};records.push(row);result=[row];}
   if(req.method==='PATCH')result.forEach(row=>Object.assign(row,body,{updated_at:new Date().toISOString()}));
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.headers.accept?.includes('object')?result[0]:result));
  });
 }}],
 resolve:{alias:{react:`${root}/apps/admin/node_modules/react`,'react-dom':`${root}/apps/admin/node_modules/react-dom`}},
 define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:5180'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('fixture-only')},
 server:{host:'127.0.0.1',port:5180,strictPort:true,fs:{allow:[root]}},
});
await server.listen();server.printUrls();
