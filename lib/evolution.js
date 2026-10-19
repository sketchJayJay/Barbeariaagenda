// Conexão opcional com Evolution API v2. Credenciais ficam somente no servidor.
function canonicalOwner(value) {
  let n=String(value||'').split('@')[0].split(':')[0].replace(/\D/g,'');
  if(n.length===10||n.length===11)n='55'+n;
  return n==='553298195165'?'5532998195165':n;
}
function createEvolution(env=process.env,fetcher=fetch) {
  const instance=String(env.EVOLUTION_INSTANCE||'suprema');
  const base=String(env.EVOLUTION_API_URL||'').replace(/\/+$/,'');
  const key=String(env.EVOLUTION_API_KEY||'');
  const configured=Boolean(base&&key&&/^[a-zA-Z0-9_-]{1,64}$/.test(instance));
  async function request(route,method='GET',body) {
    if(!configured)throw new Error('Preencha EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE no servidor.');
    const url=new URL(base+route);
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Endereço da conexão WhatsApp inválido.');
    let response;
    try{response=await fetcher(url.href,{method,headers:{apikey:key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000),redirect:'error'});}
    catch{const e=new Error('O serviço de WhatsApp não respondeu. Confira se está ligado e acessível.');e.retryable=true;throw e;}
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.error){const e=new Error(`Serviço de WhatsApp recusou a operação (HTTP ${response.status}). Confira a chave e a instância.`);e.httpStatus=response.status;e.retryable=response.status>=500||response.status===429;throw e;}
    return data;
  }
  async function details(){
    let data;try{data=await request('/instance/fetchInstances?instanceName='+encodeURIComponent(instance));}catch(e){if(e.httpStatus===404)return null;throw e;}
    const rows=Array.isArray(data)?data:Array.isArray(data.instances)?data.instances:[data];
    const record=rows.find(r=>(r.name||r.instance?.instanceName||r.instanceName)===instance)||rows[0];
    if(!record||(!record.id&&!record.name&&!record.instance&&!record.instanceName))return null;
    return {state:record.connectionStatus||record.instance?.state||record.instance?.status||'close',number:canonicalOwner(record.ownerJid||record.instance?.owner||record.instance?.ownerJid||record.number||''),name:record.profileName||record.instance?.profileName||''};
  }
  async function connection(expectedNumber){
    if(!configured)return {configured:false,connected:false,state:'not_configured',number:'',matches:false};
    const data=await details();
    if(!data)return {configured:true,connected:false,state:'not_created',number:'',matches:false};
    const state=await request('/instance/connectionState/'+encodeURIComponent(instance));
    const current=state.instance?.state||state.instance?.status||data.state;
    const matches=Boolean(data.number&&data.number===canonicalOwner(expectedNumber));
    return {configured:true,connected:current==='open'&&matches,state:current,number:data.number,name:data.name,matches};
  }
  async function connect(expectedNumber){
    let data=await details();
    if(!data){
      await request('/instance/create','POST',{instanceName:instance,integration:'WHATSAPP-BAILEYS',qrcode:false,groupsIgnore:true,alwaysOnline:false,readMessages:false,readStatus:false,syncFullHistory:false});
    }else if(data.state==='open'){
      return {connection:await connection(expectedNumber),qr_image:null};
    }
    const result=await request('/instance/connect/'+encodeURIComponent(instance));
    const qr=result.qrcode||result;
    const raw=String(qr.base64||'');
    const qrImage=/^data:image\/png;base64,[A-Za-z0-9+/=\r\n]+$/.test(raw)?raw:null;
    return {connection:await connection(expectedNumber),qr_image:qrImage};
  }
  async function send(number,text){
    const data=await request('/message/sendText/'+encodeURIComponent(instance),'POST',{number,text});
    const id=data.key?.id||data.message?.key?.id;
    if(!id){const e=new Error('O serviço não retornou o identificador da confirmação.');e.retryable=true;throw e;}
    return id;
  }
  return {configured,connection,connect,send};
}
module.exports={createEvolution,canonicalOwner};
