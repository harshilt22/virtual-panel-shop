const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const PORT=3500,ROOT=__dirname,DB=path.join(ROOT,'shop-data.json'),HISTORY=path.join(ROOT,'history'),DRAWINGS=path.join(ROOT,'shop-drawings');
const initial={inventory:[],products:[],quotes:[],boms:[],vendors:[],orders:[],allocations:[],activity:[],notifications:[],settings:{nextQuote:1001,nextJob:1001,nextBom:1001,nextPO:1001}};
function documentStem(v){return String(v||'Product').trim()||'Product'}
function safeDocumentFileStem(v){return documentStem(v).replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'')||'Product'}
function safeDocumentStorageSegment(v){return String(v||'item').trim().replace(/[^a-z0-9._-]+/gi,'_').replace(/^\.+|\.+$/g,'')||'item'}
function documentStorageKey(p,d){return path.posix.join('shop-drawings',safeDocumentStorageSegment(p?.id||'product'),safeDocumentStorageSegment(d?.id||'document')+'.pdf')}
function documentFilePath(p,d){return path.join(DRAWINGS,safeDocumentStorageSegment(p?.id||'product'),safeDocumentStorageSegment(d?.id||'document')+'.pdf')}
function dataURLBuffer(value){let s=String(value||''),payload=s;if(s.startsWith('data:')){let comma=s.indexOf(',');if(comma<0)return Buffer.alloc(0);let header=s.slice(0,comma);payload=s.slice(comma+1);return /;base64/i.test(header)?Buffer.from(payload,'base64'):Buffer.from(decodeURIComponent(payload),'utf8')}return Buffer.from(payload,'base64')}
function normalizeProduct(p){if(!p||typeof p!=='object')return p;if(!Array.isArray(p.altDescriptions))p.altDescriptions=[];if(!Array.isArray(p.documents))p.documents=[];let stem=documentStem(p.description||p.partNumber),idBase=safeDocumentFileStem(p.id||stem),used=new Set();p.documents=p.documents.map((d,i,all)=>{if(!d||typeof d!=='object')return d;let suffix=all.length>1?' ('+(i+1)+')':'',docId=safeDocumentStorageSegment(d.id||'doc_'+idBase+'_'+(i+1)),base=docId,n=2;while(used.has(docId)){docId=base+'_'+n++;}used.add(docId);let next={...d,id:docId,productDescription:stem,name:stem+suffix,fileName:safeDocumentFileStem(stem)+suffix+'.pdf'};if(next.storage==='file'||next.storageKey){next.storage='file';next.storageKey=documentStorageKey(p,next);delete next.data}return next});return p}
function normalize(data){data=data&&typeof data==='object'?data:{};for(const k of ['inventory','products','quotes','boms','vendors','orders','allocations','activity','notifications'])if(!Array.isArray(data[k]))data[k]=[];for(const q of data.quotes)if(!Array.isArray(q.items))q.items=[];for(const b of data.boms){if(!Array.isArray(b.items))b.items=[];if(!Array.isArray(b.changeRequests))b.changeRequests=[]}for(const o of data.orders)if(!Array.isArray(o.items))o.items=[];for(const p of data.products)normalizeProduct(p);data.settings={...initial.settings,...(data.settings||{})};return data;}
function ensureHistory(){if(!fs.existsSync(HISTORY))fs.mkdirSync(HISTORY,{recursive:true})}
function ensureDrawings(){if(!fs.existsSync(DRAWINGS))fs.mkdirSync(DRAWINGS,{recursive:true})}
function migrateEmbeddedDocuments(data){ensureDrawings();let changed=false;for(const p of data.products||[]){normalizeProduct(p);for(const d of p.documents||[]){if(!d||!d.data)continue;let bytes=dataURLBuffer(d.data);if(!bytes.length)continue;let target=documentFilePath(p,d);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);d.storage='file';d.storageKey=documentStorageKey(p,d);d.type='application/pdf';d.size=bytes.length;delete d.data;changed=true}}return changed}
function readDatabaseFile(file){try{const data=JSON.parse(fs.readFileSync(file,'utf8'));return data&&typeof data==='object'?data:null}catch{return null}}
function recoveryCandidates(){
  const names=[DB+'.bak'];
  try{
    for(const name of fs.readdirSync(ROOT))if(name.startsWith(path.basename(DB)+'.tmp-')||name.startsWith(path.basename(DB)+'.replace-'))names.push(path.join(ROOT,name));
  }catch{}
  try{for(const name of fs.readdirSync(HISTORY).filter(name=>name.endsWith('.json')).sort().reverse())names.push(path.join(HISTORY,name))}catch{}
  return [...new Set(names)].filter(file=>fs.existsSync(file));
}
function recoverDatabase(){for(const file of recoveryCandidates()){const data=readDatabaseFile(file);if(data)return {data,file}}return null}
function writeDatabase(data){
  const text=JSON.stringify(data,null,2),tmp=DB+'.tmp-'+process.pid+'-'+Date.now();
  const current=readDatabaseFile(DB);if(current)fs.copyFileSync(DB,DB+'.bak');
  fs.writeFileSync(tmp,text,'utf8');
  try{fs.renameSync(tmp,DB)}catch(firstError){
    const displaced=DB+'.replace-'+process.pid+'-'+Date.now(),moved=fs.existsSync(DB);
    try{
      if(moved)fs.renameSync(DB,displaced);
      fs.renameSync(tmp,DB);
      if(moved)try{fs.unlinkSync(displaced)}catch{}
    }catch(secondError){
      try{if(!fs.existsSync(DB)&&moved)fs.renameSync(displaced,DB)}catch{}
      try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{}
      throw secondError;
    }
  }
}
function load(){
  ensureHistory();ensureDrawings();
  let data=readDatabaseFile(DB),recoveredFrom='';
  if(!data){const recovered=recoverDatabase();if(recovered){data=recovered.data;recoveredFrom=recovered.file}else if(!fs.existsSync(DB)){data=JSON.parse(JSON.stringify(initial))}else{console.error('Could not load shop-data.json and no valid backup was found.');throw new SyntaxError('shop-data.json is incomplete or invalid JSON')}}
  try{
    let migrated=migrateEmbeddedDocuments(data);normalize(data);
    if(migrated||recoveredFrom||!fs.existsSync(DB))writeDatabase(data);
    if(recoveredFrom)console.warn('Recovered shop-data.json from '+recoveredFrom);
    return data;
  }catch(e){
    console.error('Could not load shop-data.json; keeping the existing file unchanged.',e.message||e);
    throw e;
  }
}
let db=load();
function save(){migrateEmbeddedDocuments(db);db=normalize(db);writeDatabase(db);}
function snapshot(){ensureHistory();const ts=Date.now(),file=path.join(HISTORY,ts+'-'+Math.random().toString(36).slice(2,8)+'.json');fs.writeFileSync(file,JSON.stringify(db,null,2));const cutoff=Date.now()-7*24*60*60*1000;const files=fs.readdirSync(HISTORY).filter(f=>f.endsWith('.json')).map(f=>({f,t:Number(f.split('-')[0])||0})).sort((a,b)=>a.t-b.t);for(const x of files){if(x.t<cutoff||files.length>5000){try{fs.unlinkSync(path.join(HISTORY,x.f))}catch{}}}}
function id(p){return p+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)}
function body(req){return new Promise((res,rej)=>{let d='';req.on('data',x=>d+=x);req.on('end',()=>{try{res(d?JSON.parse(d):{})}catch(e){rej(e)}});req.on('error',rej)})}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});res.end(JSON.stringify(data))}
function staticFile(res,p){let f=p==='/'?path.join(ROOT,'index.html'):path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);return res.end('Not found')}let ext=path.extname(f);let ct=ext==='.html'?'text/html; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':ext==='.json'?'application/json; charset=utf-8':'text/plain; charset=utf-8';res.writeHead(200,{'Content-Type':ct,'Cache-Control':'no-store'});res.end(fs.readFileSync(f));}
function productDocument(productId,docId){let p=(db.products||[]).find(x=>String(x.id)===String(productId));if(!p)return null;let d=(p.documents||[]).find(x=>String(x.id)===String(docId));return p&&d?{p,d}:null}
function documentBytes(p,d){let target=documentFilePath(p,d);if(fs.existsSync(target))return fs.readFileSync(target);if(d?.data)return dataURLBuffer(d.data);return null}
function documentDownloadName(p,d){return (safeDocumentFileStem(d?.fileName||d?.productDescription||p?.description||p?.partNumber||'Shop_Drawing').replace(/_pdf$/i,'')||'Shop_Drawing')+'.pdf'}
function vendorMakerNames(v){
  const source=Array.isArray(v?.makers)?v.makers:String(v?.maker||'').split(/[,;|]/);
  return [...new Set(source.map(x=>String(x||'').trim()).filter(Boolean))];
}
function syncVendorProducts(v,previous){
  const vendorName=String(v?.name||'').trim(),selected=new Set(vendorMakerNames(v).map(x=>x.toLowerCase())),oldMakers=new Set(vendorMakerNames(previous).map(x=>x.toLowerCase())),oldName=String(previous?.name||'').trim().toLowerCase();
  let updated=0,cleared=0;
  for(const p of db.products||[]){
    const maker=String(p.maker||'').trim().toLowerCase();
    if(selected.has(maker)){
      if(String(p.vendor||'').trim()!==vendorName){p.vendor=vendorName;updated++}
    }else if(previous&&oldMakers.has(maker)&&String(p.vendor||'').trim().toLowerCase()===oldName){
      p.vendor='';cleared++;
    }
  }
  return {updated,cleared,makers:vendorMakerNames(v).length};
}
const map={'/api/inventory':'inventory','/api/products':'products','/api/quotes':'quotes','/api/boms':'boms','/api/vendors':'vendors','/api/orders':'orders','/api/allocations':'allocations','/api/activity':'activity','/api/notifications':'notifications'};
const server=http.createServer(async(req,res)=>{try{const u=url.parse(req.url,true);if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type'});return res.end()}
if(u.pathname==='/api/data'&&req.method==='GET')return json(res,200,db);
if(u.pathname==='/api/notifications/mark-read'&&req.method==='PUT'){
  const x=await body(req),targetRoles=[...new Set((Array.isArray(x.targetRoles)?x.targetRoles:[x.targetRole]).map(v=>String(v||'').trim()).filter(Boolean))],tab=String(x.tab||'').trim();
  if(!targetRoles.length)return json(res,400,{error:'Target role is required'});
  const matched=(db.notifications||[]).filter(n=>!n.read&&targetRoles.includes(String(n.targetRole||'').trim())&&(!tab||String(n.tab||'').trim()===tab));
  if(!matched.length)return json(res,200,{ok:true,changed:0});
  snapshot();const at=new Date().toISOString();for(const n of matched){n.read=true;n.readAt=at}save();return json(res,200,{ok:true,changed:matched.length});
}
if(u.pathname==='/api/product-documents'&&req.method==='GET'){let found=productDocument(u.query.productId,u.query.docId);if(!found)return json(res,404,{error:'Shop drawing not found'});let bytes=documentBytes(found.p,found.d);if(!bytes)return json(res,404,{error:'Shop drawing file is missing'});res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Content-Disposition':'inline; filename="'+documentDownloadName(found.p,found.d).replace(/["\\\r\n]/g,'_')+'"','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});return res.end(bytes)}
if(u.pathname==='/api/product-documents'&&(req.method==='POST'||req.method==='PUT')){const x=await body(req),p=(db.products||[]).find(a=>String(a.id)===String(x.productId));if(!p)return json(res,404,{error:'Digital Library product not found'});const incoming=Array.isArray(x.documents)?x.documents:[x];if(!incoming.length)return json(res,400,{error:'No PDF documents supplied'});if(req.method==='PUT'&&incoming.some(item=>!item.docId&&!item.id))return json(res,400,{error:'Document ID is required for replacement'});snapshot();ensureDrawings();let saved=[];for(const item of incoming){let docId=String(item.docId||item.id||'').trim(),d=docId?(p.documents||[]).find(a=>String(a.id)===docId):null;if(req.method==='PUT'&&!d)return json(res,404,{error:'Shop drawing document not found'});if(!item.data)return json(res,400,{error:'PDF data is required'});let bytes=dataURLBuffer(item.data);if(!bytes.length)return json(res,400,{error:'The PDF file is empty or could not be read'});if(!d){d={id:id('doc'),addedAt:new Date().toISOString()};p.documents.push(d)}let target=documentFilePath(p,d);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);d.originalName=String(item.originalName||item.fileName||d.originalName||'Shop Drawing.pdf');d.type='application/pdf';d.size=bytes.length;d.storage='file';d.storageKey=documentStorageKey(p,d);d.sourceBOM=item.sourceBOM||d.sourceBOM||'';d.updatedAt=new Date().toISOString();delete d.data;saved.push(d)}normalizeProduct(p);save();return json(res,req.method==='POST'?201:200,{ok:true,productId:p.id,documents:saved})}
if(u.pathname==='/api/product-documents'&&req.method==='DELETE'){let found=productDocument(u.query.productId,u.query.docId);if(!found)return json(res,404,{error:'Shop drawing not found'});let target=documentFilePath(found.p,found.d);snapshot();found.p.documents=(found.p.documents||[]).filter(d=>String(d.id)!==String(found.d.id));save();try{if(fs.existsSync(target))fs.unlinkSync(target)}catch{}return json(res,200,{ok:true,productId:found.p.id,docId:found.d.id})}
if(u.pathname==='/api/history'&&req.method==='GET'){ensureHistory();let arr=fs.readdirSync(HISTORY).filter(f=>f.endsWith('.json')).map(f=>({file:f,at:Number(f.split('-')[0])||0})).sort((a,b)=>b.at-a.at);return json(res,200,arr)}
if(u.pathname==='/api/settings'&&req.method==='PUT'){snapshot();const x=await body(req);db.settings={...db.settings,...x};save();return json(res,200,db.settings)}

/* REV 66: common reviewed imports for Client BOMs, Client Purchase Slips, and the Digital Library. */
if(u.pathname==='/api/client-import'&&req.method==='POST'){
  const x=await body(req),mode=String(x.mode||'').trim(),job=String(x.job||'').trim();
  if(!['library','client-bom','client-slip'].includes(mode))return json(res,400,{error:'Import mode must be library, client-bom, or client-slip'});
  if(mode!=='library'&&!job)return json(res,400,{error:'Job Number is required for this import'});
  const rawItems=Array.isArray(x.items)?x.items:[];
  const clean=v=>String(v??'').trim();
  const low=v=>clean(v).toLowerCase();
  const parseQty=v=>{let n=Number(clean(v).replace(/[,\s]/g,''));return Number.isFinite(n)?Math.max(0,Math.floor(n)):0};
  const parsePrice=v=>{let s=clean(v).replace(/[$,\s]/g,'');if(!s)return '';if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);let n=Number(s);return Number.isFinite(n)&&n>=0?n:clean(v)};
  const vendorMap=new Map((db.vendors||[]).map(v=>[low(v?.name||v),clean(v?.name||v)]).filter(([k,v])=>k&&v));
  const canonicalVendor=v=>vendorMap.get(low(v))||'';
  const included=rawItems.map((r,i)=>({...(r||{}),rowNumber:Number(r?.rowNumber||i+1),partNumber:clean(r?.partNumber),maker:clean(r?.maker),description:clean(r?.description),currentRating:clean(r?.currentRating),voltageRating:clean(r?.voltageRating),price:clean(r?.price),vendor:clean(r?.vendor),libraryVendor:clean(r?.libraryVendor),qty:parseQty(r?.qty),action:clean(r?.action)||'update'})).filter(r=>r.action!=='skip');
  if(!included.length)return json(res,400,{error:'No verified import rows were selected'});
  const partMakers=new Map();
  for(const item of included){
    if(!item.partNumber)return json(res,400,{error:'Part Number is required on every selected row. Row '+item.rowNumber+' is missing it.'});
    if(mode!=='library'&&item.qty<=0)return json(res,400,{error:'Quantity must be greater than zero on every selected row. Row '+item.rowNumber+' is invalid.'});
    const key=low(item.partNumber),maker=item.maker;
    if(!partMakers.has(key))partMakers.set(key,new Set());
    if(maker)partMakers.get(key).add(low(maker));
  }
  for(const [part,makers] of partMakers)if(makers.size>1)return json(res,409,{error:'Part Number '+part+' appears with more than one Maker. Correct it in the review table before saving.'});
  if(mode==='client-slip'){
    const key=low(job),bomById=new Map((db.boms||[]).map(b=>[String(b.id),b]));
    const exists=(db.quotes||[]).some(r=>[r?.awardedJobNumber,r?.job,r?.jobNumber].some(v=>low(v)===key))||(db.boms||[]).some(r=>low(r?.job)===key)||(db.orders||[]).some(r=>low(r?.job||r?.jobNumber)===key||low(bomById.get(String(r?.bomId))?.job)===key)||(db.allocations||[]).some(r=>low(r?.job||r?.jobNumber)===key);
    if(!exists)return json(res,404,{error:'Job Number '+job+' was not found. Import or create the Client BOM Job Profile first.'});
  }
  const matchByPart=new Map();
  for(const item of included){
    const key=low(item.partNumber),maker=low(item.maker);
    let matches=matchByPart.get(key);
    if(!matches){matches=(db.products||[]).filter(p=>low(p.partNumber)===key);matchByPart.set(key,matches)}
    if(matches.length>1&&maker){const exact=matches.filter(p=>!clean(p.maker)||low(p.maker)===maker);if(exact.length)matches=exact}
    if(matches.length>1&&maker&&!matches.some(p=>low(p.maker)===maker))return json(res,409,{error:'Part Number '+item.partNumber+' has multiple Digital Library records. Add the exact Maker in the review table or merge the duplicate records first.'});
    if(matches.length>1&&!maker)return json(res,409,{error:'Part Number '+item.partNumber+' has multiple Digital Library records. Maker is required to identify the correct product.'});
  }
  const productByRow=new Map(),productByPart=new Map(),createdProducts=[],updatedProducts=[];
  snapshot();
  for(const item of included){
    const partKey=low(item.partNumber);
    let p=productByPart.get(partKey);
    if(!p){
      const matches=(db.products||[]).filter(v=>low(v.partNumber)===partKey),maker=low(item.maker);
      p=maker?(matches.find(v=>!clean(v.maker)||low(v.maker)===maker)||matches[0]):matches[0];
      if(!p){
        p={id:id('product'),description:item.description||item.partNumber,maker:item.maker,partNumber:item.partNumber,currentRating:item.currentRating,voltageRating:item.voltageRating,price:parsePrice(item.price),vendor:canonicalVendor(item.libraryVendor||item.vendor),jobs:[],altDescriptions:[],documents:[],notes:'Imported through reviewed import'};
        db.products.push(p);createdProducts.push(p);productByPart.set(partKey,p);
      }else productByPart.set(partKey,p);
    }
    const action=item.action||'update';
    if(action==='update'){
      const before=clean(p.description),nextDescription=item.description||before||item.partNumber;
      if(nextDescription&&before&&low(nextDescription)!==low(before)){p.altDescriptions=Array.isArray(p.altDescriptions)?p.altDescriptions:[];if(!p.altDescriptions.includes(before))p.altDescriptions.push(before)}
      if(nextDescription)p.description=nextDescription;
      if(item.maker)p.maker=item.maker;
      if(item.currentRating)p.currentRating=item.currentRating;
      if(item.voltageRating)p.voltageRating=item.voltageRating;
      if(item.price)p.price=parsePrice(item.price);
      const v=canonicalVendor(item.libraryVendor||item.vendor);if(v)p.vendor=v;
      if(!updatedProducts.includes(p)&&!createdProducts.includes(p))updatedProducts.push(p);
    }
    p.jobs=Array.isArray(p.jobs)?p.jobs:[];for(const productJob of [job,item.job])if(productJob&&!p.jobs.some(v=>low(v)===low(productJob)))p.jobs.push(productJob);
    normalizeProduct(p);productByRow.set(item.rowNumber,p);
  }
  if(mode==='library'){
    save();
    return json(res,200,{ok:true,mode,sourceFile:clean(x.sourceFile),createdProducts:createdProducts.length,updatedProducts:updatedProducts.length,products:createdProducts.concat(updatedProducts).map(p=>p.id)});
  }
  const lineMap=new Map(),lineRows=[];
  for(const item of included){
    const p=productByRow.get(item.rowNumber),key=low(p.maker)+'|'+low(p.partNumber),qty=item.qty;
    let line=lineMap.get(key);
    if(!line){line={description:p.description||item.description||p.partNumber,maker:p.maker||item.maker,partNumber:p.partNumber||item.partNumber,qty:0,price:item.price!==''?parsePrice(item.price):p.price||'',vendor:canonicalVendor(item.vendor)||canonicalVendor(p.vendor)||'',source:mode==='client-bom'?'Client Imported BOM':'Client Purchase Slip'};lineMap.set(key,line);lineRows.push(line)}
    line.qty+=qty;if(!line.price&&item.price!=='')line.price=parsePrice(item.price);if(!line.vendor)line.vendor=canonicalVendor(item.vendor)||canonicalVendor(p.vendor)||'';
  }
  if(mode==='client-bom'){
    const bNumber=clean(x.bomNumber)||(()=>{let n=Number(db.settings.nextBom||1001);db.settings.nextBom=n+1;return 'B-'+String(n).padStart(5,'0')})();
    const panelName=clean(x.panelName)||clean(x.name)||'Client Imported BOM',name=clean(x.name)||panelName;
    const b={id:id('bom'),number:bNumber,job,panelName,name,project:clean(x.project),quoteProject:clean(x.quoteProject),clientName:clean(x.clientName),clientContact:clean(x.clientContact),clientEmail:clean(x.clientEmail),projectAddress:clean(x.projectAddress),scope:clean(x.scope),notes:clean(x.notes),status:'In Purchasing',source:'Client BOM Import',importedClientBOM:true,importedFile:clean(x.sourceFile),importVerifiedAt:new Date().toISOString(),items:[],purchasingPlan:[]};
    for(const line of lineRows)b.items.push({description:line.description,maker:line.maker,partNumber:line.partNumber,qty:line.qty,source:'Client Imported BOM',price:line.price||'',vendor:line.vendor||''});
    b.purchasingPlan=b.items.map(i=>({description:i.description,maker:i.maker,partNumber:i.partNumber,designQty:Number(i.qty||0),requiredQty:Number(i.qty||0),shopSupplyQty:0,inventoryQty:0,shopQty:0,orderQty:Number(i.qty||0),purchaseQty:Number(i.qty||0),price:i.price||'',vendor:i.vendor||'',isExtra:false}));
    db.boms.push(b);
    const orderNo=clean(x.orderNo)||(()=>{let n=Number(db.settings.nextPO||1001);db.settings.nextPO=n+1;return 'PO-'+String(n).padStart(5,'0')})();
    const items=b.purchasingPlan.map(p=>({description:p.description,maker:p.maker,partNumber:p.partNumber,sourceBomId:b.id,sourceBomNumber:b.number,panelName:panelName,designQty:Number(p.designQty||0),panelMultiplier:1,requiredQty:Number(p.requiredQty||0),shopSupplyQty:0,inventoryQty:0,shopQty:0,orderQty:Number(p.orderQty||0),purchaseQty:Number(p.purchaseQty||0),qty:Number(p.orderQty||0),selectedVendor:p.vendor||'',selected:true,purchaserNote:'',receivedQty:0,receiverInitials:'',receiveNote:'',source:'Client BOM Import'}));
    const o={id:id('order'),orderNo,job,jobCombined:true,bomId:'',bomNumber:'MULTI-BOM',bomName:'Client Imported BOM',sourceBomIds:[b.id],source:'Client BOM Import',vendor:'',status:'Vendor Assignment',items,createdAt:new Date().toISOString()};db.orders.push(o);
    const at=new Date().toISOString();db.activity.push({id:id('activity'),job,type:'Client BOM Imported',message:`Client BOM ${b.number} was imported and is ready for vendor assignment.`,meta:{bomId:b.id,orderId:o.id,sourceFile:clean(x.sourceFile)},at,role:'System'});db.notifications.push({id:id('notification'),targetRole:'Purchaser',tab:'Ordering',job,message:`Client BOM ${b.number} for Job ${job} is ready for vendor assignment.`,read:false,at});db.notifications.push({id:id('notification'),targetRole:'Admin',tab:'Jobs',job,message:`Client BOM ${b.number} created Job ${job} and a purchasing sheet.`,read:false,at});
    save();return json(res,201,{ok:true,mode,job,bomId:b.id,orderId:o.id,bomNumber:b.number,orderNo,createdProducts:createdProducts.length,updatedProducts:updatedProducts.length,lineCount:b.items.length});
  }
  const slipNo=clean(x.purchaseSlipNumber)||clean(x.slipNumber),orderNo=clean(x.orderNo)||(()=>{let n=Number(db.settings.nextPO||1001);db.settings.nextPO=n+1;return 'PO-'+String(n).padStart(5,'0')})();
  const items=lineRows.map(p=>({description:p.description,maker:p.maker,partNumber:p.partNumber,requiredQty:Number(p.qty||0),shopSupplyQty:0,inventoryQty:0,shopQty:0,orderQty:Number(p.qty||0),purchaseQty:Number(p.qty||0),qty:Number(p.qty||0),selectedVendor:p.vendor||'Client Supplied',selected:true,receivedQty:0,receiverInitials:'',receiveNote:'',source:'Client Purchase Slip'}));
  const o={id:id('order'),orderNo,job,jobCombined:false,bomId:'',bomNumber:'',bomName:'Client Supplied Purchase Slip',source:'Client Purchase Slip Import',clientSupplied:true,purchaseSlipNumber:slipNo,importedFile:clean(x.sourceFile),vendor:'Client Supplied',status:'Released to Receiver',items,createdAt:new Date().toISOString()};db.orders.push(o);
  const at=new Date().toISOString();db.activity.push({id:id('activity'),job,type:'Client Purchase Slip Imported',message:`Client purchase slip ${slipNo||'(no slip number)'} was issued directly to Receiving.`,meta:{orderId:o.id,sourceFile:clean(x.sourceFile)},at,role:'System'});db.notifications.push({id:id('notification'),targetRole:'Receiver',tab:'Ordering',job,message:`Client-supplied materials for Job ${job} are ready to receive.`,read:false,at});db.notifications.push({id:id('notification'),targetRole:'Admin',tab:'Jobs',job,message:`Client purchase slip ${slipNo||'(no slip number)'} was issued to Receiving for Job ${job}.`,read:false,at});
  save();return json(res,201,{ok:true,mode,job,orderId:o.id,orderNo,createdProducts:createdProducts.length,updatedProducts:updatedProducts.length,lineCount:items.length,status:o.status});
}
if(map[u.pathname]&&req.method==='POST'){
  snapshot();const x=await body(req),key=map[u.pathname];x.id=x.id||id(key.slice(5));if(key==='products')normalizeProduct(x);db[key].push(x);
  const vendorSync=key==='vendors'?syncVendorProducts(x,null):null;save();return json(res,201,key==='vendors'?{...x,vendorSync}:x)
}
if(map[u.pathname]&&req.method==='PUT'){
  snapshot();const x=await body(req),key=map[u.pathname],i=db[key].findIndex(a=>a.id===x.id);if(i<0)return json(res,404,{error:'Record not found'});const previous=db[key][i];if(key==='products')normalizeProduct(x);const vendorSync=key==='vendors'?syncVendorProducts(x,previous):null;db[key][i]=x;save();return json(res,200,key==='vendors'?{...x,vendorSync}:x)
}
if(map[u.pathname]&&req.method==='DELETE'){snapshot();const key=map[u.pathname],i=db[key].findIndex(a=>a.id===u.query.id);if(i<0)return json(res,404,{error:'Record not found'});const old=db[key].splice(i,1)[0];save();return json(res,200,old)}
if(u.pathname==='/api/restore'&&req.method==='POST'){const x=await body(req),minutes=Number(x.minutes||0);if(![30,60,120,180,1440].includes(minutes))return json(res,400,{error:'Invalid rollback period'});ensureHistory();const cutoff=Date.now()-minutes*60000;const candidates=fs.readdirSync(HISTORY).filter(f=>f.endsWith('.json')).map(f=>({f,at:Number(f.split('-')[0])||0})).filter(x=>x.at<=cutoff).sort((a,b)=>b.at-a.at);if(!candidates.length)return json(res,404,{error:'No snapshot exists before the selected rollback time. The shop has not been running long enough or no earlier changes are available.'});snapshot();const pick=candidates[0];db=normalize(JSON.parse(fs.readFileSync(path.join(HISTORY,pick.f),'utf8')));save();return json(res,200,{ok:true,snapshotAt:pick.at})}

if(u.pathname==='/api/job-number'&&req.method==='PUT'){
  const x=await body(req),oldJob=String(x.oldJob||'').trim(),newJob=String(x.newJob||'').trim();
  if(!oldJob||!newJob)return json(res,400,{error:'Old and new Job Numbers are required'});
  const low=s=>String(s||'').trim().toLowerCase();
  const jobValues=[];
  for(const q of db.quotes||[]){ if(q.awardedJobNumber)jobValues.push(q.awardedJobNumber); if(q.job)jobValues.push(q.job); }
  for(const b of db.boms||[])jobValues.push(b.job);
  for(const o of db.orders||[])jobValues.push(o.job||o.jobNumber);
  for(const a of db.allocations||[])jobValues.push(a.job||a.jobNumber);
  const oldKey=low(oldJob),newKey=low(newJob);
  const escapedOld=oldJob.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),replaceJobText=v=>String(v||'').replace(new RegExp(escapedOld,'gi'),newJob);
  const bomById=new Map((db.boms||[]).map(b=>[String(b.id),b]));
  const linkedBefore=jobValues.some(j=>low(j)===oldKey)||(db.orders||[]).some(o=>low(o.job||o.jobNumber)===oldKey||low(bomById.get(String(o.bomId))?.job)===oldKey)||(db.allocations||[]).some(a=>low(a.job||a.jobNumber)===oldKey||low(bomById.get(String(a.bomId))?.job)===oldKey);
  if(!linkedBefore)return json(res,404,{error:'Job Number '+oldJob+' was not found'});
  if(newKey!==oldKey&&jobValues.some(j=>low(j)===newKey))return json(res,409,{error:'Job Number '+newJob+' already exists'});
  snapshot();
  let changed=0;
  for(const q of db.quotes||[]){
    if(low(q.awardedJobNumber)===oldKey){q.awardedJobNumber=newJob;changed++}
    if(low(q.job)===oldKey){q.job=newJob;changed++}
  }
  for(const b of db.boms||[]){if(low(b.job)===oldKey){b.job=newJob;changed++}}
  for(const o of db.orders||[]){
    if(low(o.job)===oldKey){o.job=newJob;changed++}
    else if(low(o.jobNumber)===oldKey){o.jobNumber=newJob;changed++}
    else if(!o.job&&!o.jobNumber&&low(bomById.get(String(o.bomId))?.job)===oldKey){o.job=newJob;changed++}
  }
  for(const a of db.allocations||[]){
    if(low(a.job)===oldKey){a.job=newJob;changed++}
    else if(low(a.jobNumber)===oldKey){a.jobNumber=newJob;changed++}
    else if(!a.job&&!a.jobNumber&&low(bomById.get(String(a.bomId))?.job)===oldKey){a.job=newJob;changed++}
  }
  for(const a of db.activity||[]){if(low(a.job)===oldKey){a.job=newJob;if(a.message)a.message=replaceJobText(a.message);changed++}}
  for(const n of db.notifications||[]){if(low(n.job)===oldKey){n.job=newJob;if(n.message)n.message=replaceJobText(n.message);changed++}}
  for(const p of db.products||[]){if(Array.isArray(p.jobs)){let touched=false;p.jobs=p.jobs.map(j=>{if(low(j)===oldKey){touched=true;return newJob}return j});if(touched)changed++}}
  save();
  return json(res,200,{ok:true,oldJob,newJob,changed});
}

if(u.pathname==='/api/job-details'&&req.method==='PUT'){
  const x=await body(req),job=String(x.job||'').trim();
  if(!job)return json(res,400,{error:'Job Number is required'});
  snapshot();
  const key=job.toLowerCase(),fields=['quoteProject','panelName','packageName','name','project','clientName','clientContact','clientEmail','projectAddress','scope','notes'];
  let changed=0;
  const apply=r=>{if(!r)return;for(const f of fields)if(Object.prototype.hasOwnProperty.call(x,f)){r[f]=String(x[f]??'').trim();changed++}};
  const bomById=new Map((db.boms||[]).map(b=>[String(b.id),b]));
  const matches=r=>[r?.awardedJobNumber,r?.job,r?.jobNumber].some(v=>String(v||'').trim().toLowerCase()===key);
  for(const q of db.quotes||[])if(matches(q))apply(q);
  for(const b of db.boms||[])if(matches(b))apply(b);
  for(const o of db.orders||[])if(matches(o)||(!o.job&&!o.jobNumber&&String(bomById.get(String(o.bomId))?.job||'').trim().toLowerCase()===key))apply(o);
  for(const a of db.allocations||[])if(matches(a)||(!a.job&&!a.jobNumber&&String(bomById.get(String(a.bomId))?.job||'').trim().toLowerCase()===key))apply(a);
  save();return json(res,200,{ok:true,job,changed});
}

if(u.pathname==='/api/job-delete'&&req.method==='DELETE'){
  const job=String(u.query.job||'').trim();
  if(!job)return json(res,400,{error:'Job Number is required'});
  const key=job.toLowerCase(),same=v=>String(v||'').trim().toLowerCase()===key;
  const bomIds=new Set((db.boms||[]).filter(b=>same(b.job)).map(b=>String(b.id)));
  const sourceHasJob=o=>Array.isArray(o?.sourceBomIds)&&o.sourceBomIds.some(id=>bomIds.has(String(id)));
  const quoteMatch=q=>same(q.awardedJobNumber)||same(q.job);
  const orderMatch=o=>same(o.job)||same(o.jobNumber)||bomIds.has(String(o.bomId))||sourceHasJob(o);
  const allocationMatch=a=>same(a.job)||same(a.jobNumber)||bomIds.has(String(a.bomId));
  const activityMatch=a=>same(a.job),notificationMatch=n=>same(n.job);
  const counts={quotes:0,boms:0,orders:0,allocations:0,activity:0,notifications:0,productJobLinks:0};
  counts.quotes=(db.quotes||[]).filter(quoteMatch).length;
  counts.boms=(db.boms||[]).filter(b=>bomIds.has(String(b.id))).length;
  counts.orders=(db.orders||[]).filter(orderMatch).length;
  counts.allocations=(db.allocations||[]).filter(allocationMatch).length;
  counts.activity=(db.activity||[]).filter(activityMatch).length;
  counts.notifications=(db.notifications||[]).filter(notificationMatch).length;
  counts.productJobLinks=(db.products||[]).reduce((n,p)=>n+(Array.isArray(p.jobs)&&p.jobs.some(same)?1:0),0);
  const total=Object.values(counts).reduce((n,v)=>n+v,0);
  if(!total)return json(res,404,{error:'Job Number '+job+' was not found'});
  snapshot();
  db.quotes=(db.quotes||[]).filter(q=>!quoteMatch(q));
  db.boms=(db.boms||[]).filter(b=>!bomIds.has(String(b.id)));
  db.orders=(db.orders||[]).filter(o=>!orderMatch(o));
  db.allocations=(db.allocations||[]).filter(a=>!allocationMatch(a));
  db.activity=(db.activity||[]).filter(a=>!activityMatch(a));
  db.notifications=(db.notifications||[]).filter(n=>!notificationMatch(n));
  for(const p of db.products||[])if(Array.isArray(p.jobs))p.jobs=p.jobs.filter(j=>!same(j));
  save();
  return json(res,200,{ok:true,job,counts,deleted:total,libraryProductsPreserved:true});
}

/* REV 60: vendor price request workbook import. Prices are matched by Maker + Part Number. */
if(u.pathname==='/api/vendor-price-import'&&req.method==='PUT'){
  const x=await body(req),items=Array.isArray(x.items)?x.items:[];
  const low=v=>String(v??'').trim().toLowerCase();
  const cleanPart=v=>String(v??'').trim();
  const parsePrice=v=>{
    if(v===null||v===undefined||String(v).trim()==='')return null;
    let s=String(v).trim().replace(/[,$\s]/g,'');
    if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);
    const n=Number(s);
    return Number.isFinite(n)&&n>=0?n:null;
  };
  const vendorNames=new Map((db.vendors||[]).map(v=>[low(v?.name||v),String(v?.name||v).trim()]).filter(([k,v])=>k&&v));
  const counts={received:items.length,updated:0,unmatched:0,ambiguous:0,invalid:0,vendorSkipped:0};
  const updates=[];
  for(const item of items){
    const price=parsePrice(item?.price);
    if(price===null){counts.invalid++;continue}
    const pn=cleanPart(item?.partNumber),maker=cleanPart(item?.maker);
    if(!pn){counts.unmatched++;continue}
    let matches=(db.products||[]).filter(p=>low(p.partNumber)===low(pn));
    if(maker)matches=matches.filter(p=>!String(p.maker||'').trim()||low(p.maker)===low(maker));
    if(!maker&&matches.length!==1){if(matches.length>1)counts.ambiguous++;else counts.unmatched++;continue}
    if(matches.length!==1){if(matches.length>1)counts.ambiguous++;else counts.unmatched++;continue}
    const p=matches[0],incomingVendor=String(item?.vendor||'').trim(),canonicalVendor=vendorNames.get(low(incomingVendor));
    updates.push({p,price,canonicalVendor,incomingVendor});
  }
  if(updates.length){
    snapshot();
    for(const u of updates){
      u.p.price=u.price;
      if(u.canonicalVendor){u.p.vendor=u.canonicalVendor}else if(u.incomingVendor&&low(u.incomingVendor)!=='unassigned')counts.vendorSkipped++;
      counts.updated++;
    }
    save();
  }
  return json(res,200,{ok:true,...counts,sourceFile:String(x.sourceFile||'')});
}

/* REV 62: merge duplicate Digital Library products by Maker + Part Number. */
if(u.pathname==='/api/products/merge'&&req.method==='PUT'){
  const x=await body(req),primaryId=String(x.primaryId||'').trim(),duplicateIds=[...new Set((Array.isArray(x.duplicateIds)?x.duplicateIds:[]).map(v=>String(v||'').trim()).filter(v=>v&&v!==primaryId))];
  const primary=(db.products||[]).find(p=>String(p.id)===primaryId),duplicates=(db.products||[]).filter(p=>duplicateIds.includes(String(p.id)));
  if(!primary)return json(res,404,{error:'Primary Digital Library product was not found'});
  if(!duplicates.length)return json(res,400,{error:'No duplicate products were selected'});
  const low=v=>String(v??'').trim().toLowerCase(),blank=v=>v===null||v===undefined||String(v).trim()==='';
  const productKey=p=>low(p?.maker)+'|'+low(p?.partNumber);
  if(duplicates.some(p=>productKey(p)!==productKey(primary)))return json(res,400,{error:'All selected products must have the same Maker and Part Number as the primary product'});
  const uniqueValues=(values)=>[...new Set(values.map(v=>String(v??'').trim()).filter(Boolean))];
  snapshot();
  primary.altDescriptions=Array.isArray(primary.altDescriptions)?primary.altDescriptions:[];
  primary.jobs=Array.isArray(primary.jobs)?primary.jobs:[];
  primary.documents=Array.isArray(primary.documents)?primary.documents:[];
  let documentsMoved=0,documentsSkipped=0;
  const usedDocumentIds=new Set(primary.documents.map(d=>String(d?.id||'').trim()).filter(Boolean));
  for(const duplicate of duplicates){
    for(const value of [duplicate.description,...(Array.isArray(duplicate.altDescriptions)?duplicate.altDescriptions:[])]){
      const s=String(value??'').trim();if(s&&s!==String(primary.description||'').trim()&&!primary.altDescriptions.includes(s))primary.altDescriptions.push(s);
    }
    primary.jobs=uniqueValues([...primary.jobs,...(Array.isArray(duplicate.jobs)?duplicate.jobs:[])]);
    if(blank(primary.currentRating)&&!blank(duplicate.currentRating))primary.currentRating=duplicate.currentRating;
    if(blank(primary.voltageRating)&&!blank(duplicate.voltageRating))primary.voltageRating=duplicate.voltageRating;
    if(blank(primary.price)&&!blank(duplicate.price))primary.price=duplicate.price;
    if(blank(primary.vendor)&&!blank(duplicate.vendor))primary.vendor=duplicate.vendor;
    if(!blank(duplicate.notes)&&!String(primary.notes||'').includes(String(duplicate.notes).trim()))primary.notes=uniqueValues([primary.notes,duplicate.notes]).join(' | ');
    for(const document of duplicate.documents||[]){
      let bytes=null;try{bytes=documentBytes(duplicate,document)}catch{bytes=null}
      if(!bytes||!bytes.length){documentsSkipped++;continue}
      const originalId=String(document.id||'').trim()||id('doc');let docId=originalId,n=2;while(usedDocumentIds.has(docId))docId=originalId+'_'+n++;
      const next={...document,id:docId,storage:'file',type:'application/pdf',size:bytes.length,addedAt:document.addedAt||new Date().toISOString(),updatedAt:new Date().toISOString()};delete next.data;
      const target=documentFilePath(primary,next);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);next.storageKey=documentStorageKey(primary,next);primary.documents.push(next);usedDocumentIds.add(docId);documentsMoved++;
    }
  }
  normalizeProduct(primary);
  const duplicateSet=new Set(duplicates.map(p=>String(p.id)));
  db.products=(db.products||[]).filter(p=>!duplicateSet.has(String(p.id)));
  save();
  return json(res,200,{ok:true,primaryId,merged:duplicates.length,documentsMoved,documentsSkipped,remainingProducts:db.products.length});
}

if(u.pathname==='/api/product-details'&&req.method==='PUT'){
  const x=await body(req),pn=String(x.partNumber||'').trim(),maker=String(x.maker||'').trim(),oldPn=String(x.oldPartNumber||pn).trim(),oldMaker=String(x.oldMaker||maker).trim();
  if(!pn||!maker)return json(res,400,{error:'Maker and Part Number are required'});
  snapshot();let changed=0;
  const same=r=>String(r.partNumber||'').trim().toLowerCase()===oldPn.toLowerCase()&&String(r.maker||'').trim().toLowerCase()===oldMaker.toLowerCase();
  const fields=['description','maker','partNumber','currentRating','voltageRating','price','vendor','notes'];
  for(const p of db.products||[])if(same(p)){for(const f of fields)if(Object.prototype.hasOwnProperty.call(x,f)){p[f]=x[f];changed++}}
  for(const key of ['inventory','quotes','boms','orders','allocations'])for(const r of db[key]||[]){
    const lineSets=key==='inventory'?[[r]]:[...(Array.isArray(r.items)?[r.items]:[]),...(Array.isArray(r.purchasingPlan)?[r.purchasingPlan]:[])];
    for(const lines of lineSets)for(const line of lines)if(same(line)){for(const f of ['description','maker','partNumber'])if(Object.prototype.hasOwnProperty.call(x,f)){line[f]=x[f];changed++}if(Object.prototype.hasOwnProperty.call(x,'vendor')){line.vendor=x.vendor;line.selectedVendor=line.selectedVendor||x.vendor}}
  }
  save();return json(res,200,{ok:true,changed});
}

if(u.pathname==='/api/reset'&&req.method==='DELETE'){snapshot();db=JSON.parse(JSON.stringify(initial));save();return json(res,200,db)}
return staticFile(res,u.pathname);
}catch(e){console.error(e);json(res,500,{error:e.message})}});
server.listen(PORT,()=>console.log(`ShadComm Virtual Shop running at http://localhost:${PORT}`));
