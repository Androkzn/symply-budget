// Two-step completion for the Pro subscriptions:
//   1) create subscriptionAvailability (all territories + availableInNewTerritories)
//   2) set USA base price (monthly $1.99 / yearly $19.99) — Apple auto-equalizes globally
// Idempotent. Flags: --dry-run, --only=<productId substring>
import crypto from 'node:crypto';
import fs from 'node:fs';
const DRY = process.argv.includes('--dry-run');
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const API = 'https://api.appstoreconnect.apple.com';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH } = process.env;
function b64url(i){return Buffer.from(i).toString('base64url');}
function mint(){const h={alg:'ES256',kid:ASC_KEY_ID,typ:'JWT'};const n=Math.floor(Date.now()/1000);
  const p={iss:ASC_ISSUER_ID,iat:n,exp:n+900,aud:'appstoreconnect-v1'};
  const si=`${b64url(JSON.stringify(h))}.${b64url(JSON.stringify(p))}`;
  const s=crypto.sign('sha256',Buffer.from(si),{key:fs.readFileSync(ASC_KEY_PATH,'utf8'),dsaEncoding:'ieee-p1363'});
  return `${si}.${s.toString('base64url')}`;}
const T=mint();
async function api(method,p,body){const r=await fetch(API+p,{method,
  headers:{Authorization:`Bearer ${T}`,'Content-Type':'application/json'},
  body:body?JSON.stringify(body):undefined});const t=await r.text();
  let j={};if(t){try{j=JSON.parse(t);}catch{j={raw:t};}}return{status:r.status,ok:r.ok,json:j};}
const errStr=(j)=>j?.errors?.length?j.errors.map(e=>`${e.status} ${e.code}: ${e.detail||e.title}`).join(' | '):(j?.raw||JSON.stringify(j));

const SUBS = [
  { pid:'com.symply.house.pro.monthly',    id:'6790841652', price:'1.99' },
  { pid:'com.symply.house.pro.yearly',     id:'6790841571', price:'19.99' },
  { pid:'com.symply.budget.pro.monthly',   id:'6790841738', price:'1.99' },
  { pid:'com.symply.budget.pro.yearly',    id:'6790841865', price:'19.99' },
  { pid:'com.symply.kaizen.pro.monthly',   id:'6790841806', price:'1.99' },
  { pid:'com.symply.kaizen.pro.yearly',    id:'6790841890', price:'19.99' },
  { pid:'com.symply.language.pro.monthly', id:'6790841918', price:'1.99' },
  { pid:'com.symply.language.pro.yearly',  id:'6790841904', price:'19.99' },
  { pid:'com.symply.health.pro.monthly',   id:'6790841956', price:'1.99' },
  { pid:'com.symply.health.pro.yearly',    id:'6790842050', price:'19.99' },
];

async function allTerritories(){
  let path='/v1/territories?limit=200', ids=[];
  while(path){const r=await api('GET',path); if(!r.ok) throw new Error('territories: '+errStr(r.json));
    ids.push(...r.json.data.map(d=>d.id)); path=r.json.links?.next?.replace(API,'')||null;}
  return ids;
}
async function ensureAvailability(sub, territoryIds){
  const cur = await api('GET', `/v1/subscriptions/${sub.id}/subscriptionAvailability`);
  if (cur.ok && cur.json.data) { console.log(`    = availability exists`); return true; }
  if (DRY) { console.log(`    + [dry] availability (${territoryIds.length} territories)`); return true; }
  const res = await api('POST', '/v1/subscriptionAvailabilities', {
    data: { type:'subscriptionAvailabilities', attributes:{ availableInNewTerritories:true },
      relationships: {
        subscription: { data:{ type:'subscriptions', id:sub.id } },
        availableTerritories: { data: territoryIds.map(id=>({ type:'territories', id })) },
      } },
  });
  if (!res.ok) { console.log(`    ✗ availability: ${errStr(res.json)}`); return false; }
  console.log(`    + availability set (${territoryIds.length} territories)`);
  return true;
}
async function findUsaPricePoint(subId, target){
  let path=`/v1/subscriptions/${subId}/pricePoints?filter[territory]=USA&limit=200`;
  while(path){const r=await api('GET',path); if(!r.ok) throw new Error('pp: '+errStr(r.json));
    const hit=(r.json.data||[]).find(d=>d.attributes.customerPrice===target); if(hit) return hit.id;
    path=r.json.links?.next?.replace(API,'')||null;}
  return null;
}
async function ensurePrice(sub){
  const cur = await api('GET', `/v1/subscriptions/${sub.id}/prices?limit=5`);
  if (cur.ok && (cur.json.data||[]).length) { console.log(`    = price exists — skip`); return true; }
  const ppId = await findUsaPricePoint(sub.id, sub.price);
  if (!ppId) { console.log(`    ✗ no USA price point for $${sub.price}`); return false; }
  if (DRY) { console.log(`    + [dry] price $${sub.price}`); return true; }
  const res = await api('POST', '/v1/subscriptionPrices', {
    data: { type:'subscriptionPrices', attributes:{ startDate:null, preserveCurrentPrice:false },
      relationships: {
        subscription:{ data:{ type:'subscriptions', id:sub.id } },
        subscriptionPricePoint:{ data:{ type:'subscriptionPricePoints', id:ppId } },
      } },
  });
  if (!res.ok) { console.log(`    ✗ price: ${errStr(res.json)}`); return false; }
  console.log(`    + price $${sub.price}/USA (auto-equalized)`);
  return true;
}

const territoryIds = await allTerritories();
console.log(`Territories: ${territoryIds.length}\n`);
for (const sub of SUBS) {
  if (ONLY && !sub.pid.includes(ONLY)) continue;
  console.log(`══ ${sub.pid} ($${sub.price}) ══`);
  const okA = await ensureAvailability(sub, territoryIds);
  if (okA) await ensurePrice(sub);
}
console.log(DRY?'\n[DRY RUN]':'\n✓ Done.');
