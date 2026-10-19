const crypto = require('crypto');
const {createEvolution}=require('./evolution');
const CUSTOMER_EVENT='booking.customer_confirmation';

function normalizeNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^(\d{10}|\d{11})$/.test(digits) ? `55${digits}` : digits;
}
function validNumber(value) { return /^55\d{10,11}$/.test(normalizeNumber(value)); }
function dateBR(value) { return String(value).split('-').reverse().join('/'); }
function bookingMessage(b) {
  return `✂️ *Novo agendamento — Barbearia Suprema*\n\n👤 ${b.name}\n💈 ${b.service_label}\n📅 ${dateBR(b.date)} às ${b.start}\n⏱ ${b.duration_min} minutos (${b.start} às ${b.end})\n💰 ${Number(b.price_reais).toLocaleString('pt-BR', {style:'currency', currency:'BRL'})}\n📱 ${b.phone || 'Não informado'}\n🎟 ${b.ticket}\n\nO horário já está reservado na agenda.`;
}
function customerMessage(b) {
  return `Olá, ${b.name}! ✂️\n\nSeu horário na *Barbearia Suprema* está confirmado.\n\n💈 ${b.service_label}\n📅 ${dateBR(b.date)}\n🕐 ${b.start} às ${b.end}\n💰 ${Number(b.price_reais).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}\n🎟 Reserva: ${b.ticket}\n\nSe precisar alterar ou cancelar, responda por aqui. Até lá!`;
}
function whatsappUrl(number, message) {
  return validNumber(number) ? `https://wa.me/${normalizeNumber(number)}?text=${encodeURIComponent(message)}` : '';
}
function providerConfig(env, number) {
  const requested = String(env.WHATSAPP_PROVIDER || 'auto');
  const choice = ['auto','manual','cloud','webhook','evolution'].includes(requested) ? requested : 'manual';
  const cloud = Boolean(env.WA_TOKEN && env.WA_PHONE_NUMBER_ID && /^\d+$/.test(env.WA_PHONE_NUMBER_ID));
  const webhook = Boolean(env.WHATSAPP_CUSTOMER_WEBHOOK_URL);
  const evolution=Boolean(env.EVOLUTION_API_URL&&env.EVOLUTION_API_KEY);
  const provider = choice === 'auto' ? (evolution?'evolution':webhook ? 'webhook' : cloud ? 'cloud' : 'manual') : choice;
  const missing = [];
  if (!validNumber(number)) missing.push('WhatsApp do barbeiro com DDD');
  if (provider === 'cloud' && !cloud) missing.push('WA_TOKEN e WA_PHONE_NUMBER_ID no servidor');
  if (provider === 'webhook' && !webhook) missing.push('WHATSAPP_CUSTOMER_WEBHOOK_URL no servidor');
  if (provider==='evolution'&&!evolution)missing.push('EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor');
  if (provider === 'manual') missing.push('Conexão automática (API oficial ou webhook)');
  return {provider, enabled: provider !== 'manual' && missing.length === 0, missing};
}

function createWhatsApp(pool, env = process.env, fetcher = fetch) {
  const evolution=createEvolution(env,fetcher);
  let running = false;
  let timer;
  async function init() {
    await pool.query(`CREATE TABLE IF NOT EXISTS suprema_settings (
      key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS whatsapp_notifications (
      id SERIAL PRIMARY KEY, booking_id INT, event TEXT NOT NULL DEFAULT 'booking.confirmed',
      recipient TEXT NOT NULL, provider TEXT NOT NULL, payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INT NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), locked_at TIMESTAMPTZ,
      provider_message_id TEXT, last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), accepted_at TIMESTAMPTZ,
      UNIQUE(booking_id, event)
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_wa_queue ON whatsapp_notifications(status, next_attempt_at)`);
  }
  async function config(client = pool) {
    const result = await client.query("SELECT value FROM suprema_settings WHERE key='owner_whatsapp'");
    const configured = normalizeNumber(result.rows[0]?.value || env.OWNER_WHATSAPP_E164 || env.OWNER_WHATSAPP || '5532998195165');
    // Corrige apenas o destino antigo que veio sem o nono dígito, confirmado pelo proprietário.
    const number = configured === '553298195165' ? '5532998195165' : configured;
    return {owner_whatsapp: number, ...providerConfig(env, number)};
  }
  async function saveNumber(value) {
    if (!validNumber(value)) throw new Error('Informe o WhatsApp com DDD, com 10 ou 11 dígitos.');
    await pool.query(`INSERT INTO suprema_settings(key,value) VALUES('owner_whatsapp',$1::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [JSON.stringify(normalizeNumber(value))]);
    return config();
  }
  async function enqueue(client, booking) {
    const c=await config(client);
    const recipient=validNumber(booking.phone)?normalizeNumber(booking.phone):'';
    const status=!recipient?'no_phone':c.enabled?'pending':'manual';
    const result=await client.query(`INSERT INTO whatsapp_notifications(booking_id,event,recipient,provider,payload,status)
      VALUES($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT(booking_id,event) DO UPDATE SET booking_id=EXCLUDED.booking_id
      RETURNING id,status`,[booking.id,CUSTOMER_EVENT,recipient,c.provider,JSON.stringify({...booking,owner_whatsapp:c.owner_whatsapp}),status]);
    return {...result.rows[0],event:CUSTOMER_EVENT,provider:c.provider,owner_whatsapp:c.owner_whatsapp,
      whatsapp_url:whatsappUrl(c.owner_whatsapp,bookingMessage(booking))};
  }
  async function deliver(job) {
    const b = job.payload;
    let url, payload, headers = {'Content-Type':'application/json'};
    if (job.provider === 'cloud') {
      const version = /^v\d+\.\d+$/.test(env.WA_API_VERSION || '') ? env.WA_API_VERSION : 'v23.0';
      url = `https://graph.facebook.com/${version}/${env.WA_PHONE_NUMBER_ID}/messages`;
      headers.Authorization = `Bearer ${env.WA_TOKEN}`;
      payload = {messaging_product:'whatsapp', to:job.recipient, type:'template', template:{
        name:env.WA_CUSTOMER_TEMPLATE_NAME || 'booking_confirmation', language:{code:env.WA_TEMPLATE_LANG || 'pt_BR'},
        components:[{type:'body', parameters:[b.name,b.service_label,dateBR(b.date),b.start,b.ticket].map(v=>({type:'text',text:String(v)}))}]
      }};
    } else if (job.provider === 'webhook') {
      url = env.WHATSAPP_CUSTOMER_WEBHOOK_URL;
      payload = {event:job.event, event_id:`suprema-${job.id}`, source:'barbearia_suprema',
        sent_at:new Date().toISOString(), owner_whatsapp:b.owner_whatsapp, recipient_whatsapp:job.recipient,
        message:customerMessage(b), booking:{...b,date_br:dateBR(b.date)}};
      headers['Idempotency-Key'] = `suprema-${job.id}`;
      if (env.WHATSAPP_WEBHOOK_SECRET) headers['X-Webhook-Secret'] = env.WHATSAPP_WEBHOOK_SECRET;
    } else if(job.provider==='evolution'){
      const c=await config();
      const state=await evolution.connection(c.owner_whatsapp);
      if(!state.connected)throw new Error('Conecte o WhatsApp da barbearia antes de enviar a confirmação.');
      return evolution.send(job.recipient,customerMessage(b));
    } else { throw new Error('Conexão automática não configurada.'); }
    const parsed = new URL(url);
    if (!['https:','http:'].includes(parsed.protocol)) throw new Error('Endereço da integração inválido.');
    const body = JSON.stringify(payload);
    if (job.provider === 'webhook' && env.WHATSAPP_WEBHOOK_SECRET) {
      headers['X-Suprema-Signature'] = `sha256=${crypto.createHmac('sha256',env.WHATSAPP_WEBHOOK_SECRET).update(body).digest('hex')}`;
    }
    const response = await fetcher(url, {method:'POST',headers,body,signal:AbortSignal.timeout(10000),redirect:'error'});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || data.ok === false || data.error) {
      const code = data.error?.code ? ` (${data.error.code})` : '';
      const e = new Error(`Integração recusou a solicitação: HTTP ${response.status}${code}. Confira as credenciais e o modelo de mensagem.`);
      e.retryable = response.status === 429 || response.status >= 500;
      throw e;
    }
    if (job.provider === 'cloud' && !data.messages?.[0]?.id) throw new Error('A API não retornou o identificador da mensagem.');
    return data.messages?.[0]?.id || data.message_id || null;
  }
  async function processBatch() {
    if (running) return;
    running = true;
    try {
      const c=await config();
      if(!c.enabled)return;
      if(c.provider==='evolution'&&!(await evolution.connection(c.owner_whatsapp)).connected)return;
      await pool.query(`UPDATE whatsapp_notifications SET status='pending',locked_at=NULL
        WHERE event='booking.customer_confirmation' AND status='sending' AND locked_at < NOW() - INTERVAL '2 minutes'`);
      for (let i=0; i<4; i++) {
        const result = await pool.query(`UPDATE whatsapp_notifications SET status='sending',locked_at=NOW(),attempts=attempts+1
          WHERE id=(SELECT id FROM whatsapp_notifications WHERE event='booking.customer_confirmation' AND status='pending' AND next_attempt_at<=NOW()
            ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`);
        const job = result.rows[0];
        if (!job) break;
        try {
          if (!validNumber(job.recipient) || (job.provider==='cloud' && !(env.WA_TOKEN && env.WA_PHONE_NUMBER_ID)) ||
              (job.provider==='webhook' && !env.WHATSAPP_CUSTOMER_WEBHOOK_URL)) throw new Error('Conexão incompleta. Confira as variáveis de ambiente.');
          const id = await deliver(job);
          await pool.query(`UPDATE whatsapp_notifications SET status='accepted',provider_message_id=$2,accepted_at=NOW(),last_error=NULL,locked_at=NULL WHERE id=$1`,[job.id,id]);
        } catch(e) {
          const retry = job.attempts < 4 && e.retryable !== false;
          const delay = [0,15,60,300][Math.min(job.attempts,3)];
          await pool.query(`UPDATE whatsapp_notifications SET status=$2,last_error=$3,locked_at=NULL,
            next_attempt_at=NOW()+($4 * INTERVAL '1 second') WHERE id=$1`,[job.id,retry?'pending':'failed',String(e.message).slice(0,500),delay]);
        }
      }
    } catch(e) { console.error('[WhatsApp] Falha na fila:',e.message); }
    finally { running=false; }
  }
  async function retry(id) {
    const c=await config();
    if(!c.enabled)throw new Error('Configure a conexão antes de reenviar.');
    // Mantém o destinatário original do cliente. Nunca redireciona para o barbeiro.
    const r=await pool.query(`UPDATE whatsapp_notifications SET provider=$2,status='pending',attempts=0,
      last_error=NULL,next_attempt_at=NOW(),locked_at=NULL WHERE id=$1 AND event=$3
      AND status IN ('failed','manual') AND recipient ~ '^55[0-9]{10,11}$' RETURNING id`,[id,c.provider,CUSTOMER_EVENT]);
    if(!r.rowCount)throw new Error('Confirmação inexistente, sem telefone, já enviada ou em processamento.');
    return r.rows[0];
  }
  async function connection(){const c=await config();return evolution.connection(c.owner_whatsapp);}
  async function connect(){const c=await config();if(c.provider!=='evolution')throw new Error('Configure o provedor Evolution para conectar por QR Code.');return evolution.connect(c.owner_whatsapp);}
  async function list() {
    const c=await config();
    const {rows}=await pool.query(`SELECT id,booking_id,event,recipient,provider,status,attempts,last_error,created_at,accepted_at,
      payload->>'name' AS name,payload->>'ticket' AS ticket,payload->>'date' AS date,payload->>'start' AS start,payload
      FROM whatsapp_notifications ORDER BY id DESC LIMIT 50`);
    return {config:c,notifications:rows.map(({payload,...r})=>({...r,whatsapp_url:whatsappUrl(r.recipient,r.event===CUSTOMER_EVENT?customerMessage(payload):bookingMessage(payload))}))};
  }
  function start() { timer=setInterval(processBatch,10000); timer.unref(); void processBatch(); }
  function stop() { clearInterval(timer); }
  return {init,config,saveNumber,enqueue,processBatch,retry,list,connection,connect,start,stop};
}
module.exports={createWhatsApp,normalizeNumber,validNumber,bookingMessage,customerMessage,whatsappUrl,providerConfig,CUSTOMER_EVENT};
