// Upload a review screenshot to each Pro subscription (reserve -> PUT bytes -> commit).
// Idempotent: skips a subscription that already has a completed screenshot.
//   env: ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH, IMG_PATH
import crypto from 'node:crypto';
import fs from 'node:fs';
const API = 'https://api.appstoreconnect.apple.com';
const { ASC_ISSUER_ID, ASC_KEY_ID, ASC_KEY_PATH, IMG_PATH } = process.env;
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
  ['com.symply.house.pro.monthly','6790841652'],['com.symply.house.pro.yearly','6790841571'],
  ['com.symply.budget.pro.monthly','6790841738'],['com.symply.budget.pro.yearly','6790841865'],
  ['com.symply.kaizen.pro.monthly','6790841806'],['com.symply.kaizen.pro.yearly','6790841890'],
  ['com.symply.language.pro.monthly','6790841918'],['com.symply.language.pro.yearly','6790841904'],
  ['com.symply.health.pro.monthly','6790841956'],['com.symply.health.pro.yearly','6790842050'],
];

const bytes = fs.readFileSync(IMG_PATH);
const fileSize = bytes.length;
const md5 = crypto.createHash('md5').update(bytes).digest('hex');
const fileName = 'review-placeholder.png';

async function alreadyHas(subId){
  const r = await api('GET', `/v1/subscriptions/${subId}/appStoreReviewScreenshot?fields[subscriptionAppStoreReviewScreenshots]=assetDeliveryState`);
  if (!r.ok || !r.json.data) return false;
  const st = r.json.data.attributes?.assetDeliveryState?.state;
  return st === 'COMPLETE';
}
async function upload(pid, subId){
  if (await alreadyHas(subId)) { console.log(`= ${pid} already has screenshot — skip`); return; }
  // 1) reserve
  const res = await api('POST', '/v1/subscriptionAppStoreReviewScreenshots', {
    data: { type:'subscriptionAppStoreReviewScreenshots', attributes:{ fileName, fileSize },
      relationships:{ subscription:{ data:{ type:'subscriptions', id:subId } } } },
  });
  if (!res.ok) { console.log(`✗ ${pid} reserve: ${errStr(res.json)}`); return; }
  const id = res.json.data.id;
  const ops = res.json.data.attributes.uploadOperations || [];
  // 2) PUT bytes
  for (const op of ops) {
    const headers = {}; for (const h of (op.requestHeaders||[])) headers[h.name] = h.value;
    const chunk = bytes.subarray(op.offset, op.offset + op.length);
    const put = await fetch(op.url, { method: op.method || 'PUT', headers, body: chunk });
    if (!put.ok) { console.log(`✗ ${pid} PUT ${put.status}`); return; }
  }
  // 3) commit
  const patch = await api('PATCH', `/v1/subscriptionAppStoreReviewScreenshots/${id}`, {
    data: { type:'subscriptionAppStoreReviewScreenshots', id,
      attributes:{ uploaded:true, sourceFileChecksum: md5 } },
  });
  if (!patch.ok) { console.log(`✗ ${pid} commit: ${errStr(patch.json)}`); return; }
  console.log(`✓ ${pid} screenshot uploaded (state ${patch.json.data.attributes?.assetDeliveryState?.state||'?'})`);
}

console.log(`Image ${IMG_PATH}  size=${fileSize}  md5=${md5}\n`);
for (const [pid, subId] of SUBS) await upload(pid, subId);
console.log('\n✓ Done uploading screenshots.');
