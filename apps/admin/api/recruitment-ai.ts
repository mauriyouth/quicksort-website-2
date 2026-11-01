import {timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {decryptApiKey} from '../server/ai-settings.ts';
type Request={method?:string;headers:Record<string,string|string[]|undefined>;body:unknown};
type Response={setHeader:(name:string,value:string)=>void;status:(code:number)=>Response;json:(value:unknown)=>void};
const input=z.object({encryptedKey:z.string().min(30).max(4000),request:z.object({model:z.string().regex(/^[a-zA-Z0-9._-]+$/).max(120),input:z.array(z.object({role:z.enum(['system','user','assistant']),content:z.string().max(180000)})).min(1).max(5),text:z.object({format:z.record(z.string(),z.unknown())})})});
export const config={maxDuration:120};
export default async function handler(req:Request,res:Response){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST')return res.status(405).json({error:{message:'Method not allowed.'}});
  const secret=process.env.RECRUITMENT_AI_SECRET;
  const header=req.headers.authorization;
  const actual=Buffer.from(typeof header==='string'?header:'');
  const expected=Buffer.from(`Bearer ${secret||''}`);
  if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return res.status(401).json({error:{message:'Unauthorized.'}});
  if(JSON.stringify(req.body).length>300000)return res.status(413).json({error:{message:'Request too large.'}});
  const parsed=input.safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:{message:'Invalid recruitment AI request.'}});
  try{
    // Same encrypted cv-analyzer setting and encryption helper used by the admin UI.
    const apiKey=decryptApiKey(parsed.data.encryptedKey);
    const upstream=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({...parsed.data.request,store:false,max_output_tokens:6000}),signal:AbortSignal.timeout(90000)});
    const body=await upstream.json();
    if(!upstream.ok)return res.status(upstream.status).json({error:{message:`The admin AI provider returned ${upstream.status}. Check the saved key, model access, and quota.`,type:'provider_error'}});
    return res.status(200).json(body);
  }catch{return res.status(502).json({error:{message:'The admin AI service could not complete the request.'}});}
}
