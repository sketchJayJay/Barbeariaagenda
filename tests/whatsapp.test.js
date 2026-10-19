const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalizeNumber,validNumber,whatsappUrl,bookingMessage,providerConfig}=require('../lib/whatsapp');
test('destino aceita formatos brasileiros, sem inventar o nono dígito',()=>{
 assert.equal(normalizeNumber('(32) 99999-8888'),'5532999998888');
 assert.equal(normalizeNumber('32 9819-5165'),'553298195165');
 assert.equal(normalizeNumber('55 32 99999-8888'),'5532999998888');
 assert.equal(validNumber('abc'),false);assert.equal(validNumber('123'),false);
 assert.equal(whatsappUrl('123','Mensagem'),'');
});
test('somente um canal envia mesmo com dois provedores configurados',()=>{
 const env={WA_TOKEN:'test',WA_PHONE_NUMBER_ID:'123',WHATSAPP_WEBHOOK_URL:'https://example.invalid/hook'};
 assert.equal(providerConfig(env,'32999998888').provider,'webhook');
 assert.equal(providerConfig({...env,WHATSAPP_PROVIDER:'cloud'},'32999998888').provider,'cloud');
 assert.equal(providerConfig({...env,WHATSAPP_PROVIDER:'manual'},'32999998888').enabled,false);
});
test('não declara integração automática com configuração incompleta',()=>{
 assert.equal(providerConfig({},'32999998888').enabled,false);
 assert.equal(providerConfig({WHATSAPP_PROVIDER:'cloud',WA_TOKEN:'x'},'32999998888').enabled,false);
 assert.equal(providerConfig({WHATSAPP_PROVIDER:'desconhecido'},'32999998888').enabled,false);
 assert.equal(providerConfig({WA_TOKEN:'x',WA_PHONE_NUMBER_ID:'123'},'123').enabled,false);
});
test('mensagem e link preservam acentos, dados e valor',()=>{
 const b={name:'João & José',service_label:'Corte + Barba',date:'2026-10-20',start:'14:00',end:'14:50',duration_min:50,price_reais:50,ticket:'BS-ABC123',phone:''};
 const message=bookingMessage(b),url=new URL(whatsappUrl('32999998888',message));
 assert.match(message,/20\/10\/2026 às 14:00/);assert.match(message,/BS-ABC123/);assert.match(message,/Não informado/);
 assert.equal(url.searchParams.get('text'),message);assert.equal(url.pathname,'/5532999998888');
});
