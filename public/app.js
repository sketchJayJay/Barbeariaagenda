const el = (id) => document.getElementById(id);

const state = {
  services: [],
  ownerWhatsapp: "3298195165",
  webhookEnabled: false,
  selectedService: null,
  selectedDate: null,
  mode: "with_phone",
  loadedCustomerPhone: "",
  loadedCustomerName: ""
};

function setActiveStep(n){
  document.querySelectorAll(".step-pill").forEach(b=>{
    b.classList.toggle("is-active", Number(b.dataset.step)===n);
  });
}


function updateProgress(n){
  const pct = Math.round((n/4)*100);
  const fill = document.getElementById('progressFill');
  const text = document.getElementById('progressText');
  const track = document.querySelector('.progress-track');
  if(fill) fill.style.width = `${(n/4)*100}%`;
  if(text) text.textContent = `Etapa ${n} de 4`;
  if(track) track.setAttribute('aria-valuenow', String(n));
}

// anima transição entre cards (estilo app)
function animateStepChange(fromEl, toEl){
  if(!toEl) return;
  // garante visível
  toEl.style.display = '';
  // anima entrada
  toEl.animate([
    { opacity: 0, transform: 'translateX(14px)' },
    { opacity: 1, transform: 'translateX(0px)' }
  ], { duration: 220, easing: 'ease-out' });

  if(fromEl && fromEl !== toEl){
    const anim = fromEl.animate([
      { opacity: 1, transform: 'translateX(0px)' },
      { opacity: 0, transform: 'translateX(-14px)' }
    ], { duration: 180, easing: 'ease-in' });
    anim.onfinish = ()=>{ fromEl.style.display = 'none'; };
  }
}

let currentStep = 1;
let slotRefreshTimer = null;

function showStep(n){
  const fromEl = document.querySelector(`.step-card:not([style*="display: none"])`);
  const toEl = document.getElementById(`step${n}`);

  currentStep = n;

  // garante que todos estão escondidos (menos o destino)
  document.querySelectorAll('.step-card').forEach(sec=>{
    if(sec !== toEl) sec.style.display = 'none';
  });

  setActiveStep(n);
  updateProgress(n);
  animateStepChange(fromEl, toEl);

  // botões
  const btnBack = el('btnBack');
  const btnNext = el('btnNext');
  const btnConfirm = el('btnConfirm');

  btnBack.disabled = (n === 1);
  btnNext.style.display = (n < 4) ? '' : 'none';
  btnConfirm.style.display = (n === 4) ? '' : 'none';

  // quando entra no passo 4, carrega horários (se tiver dados)
  if(n === 4){
    loadSlots().catch(()=>{});
    startSlotAutoRefresh();
    btnConfirm.disabled = !el('slot').value;
  } else {
    stopSlotAutoRefresh();
  }
}

function startSlotAutoRefresh(){
  stopSlotAutoRefresh();
  slotRefreshTimer = setInterval(()=>{
    if(currentStep === 4) loadSlots().catch(()=>{});
  }, 25000);
}
function stopSlotAutoRefresh(){
  if(slotRefreshTimer){
    clearInterval(slotRefreshTimer);
    slotRefreshTimer = null;
  }
}
function renderSlotButtons(slots){
  const grid = document.getElementById("slotGrid");
  if(!grid) return;
  grid.innerHTML = "";
  if(!slots || slots.length===0){
    grid.innerHTML = `<div class="muted">Sem horários disponíveis.</div>`;
    return;
  }
  const current = el("slot").value;
  slots.forEach(s=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slot-btn" + (String(current)===String(s.value) ? " is-selected" : "");
    btn.innerHTML = `<span class="slot-time">${s.label}</span><span class="slot-sub">Disponível</span>`;
    btn.addEventListener("click", ()=>{
      el("slot").value = s.value;
      // atualizar seleção visual
      grid.querySelectorAll(".slot-btn").forEach(x=>x.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      // habilita confirmar
      el('btnConfirm').disabled = false;
    });
    grid.appendChild(btn);
  });
}


function onlyDigits(v){ return String(v||"").replace(/\D/g,""); }

function formatDateISO(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,"0");
  const day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function addDaysISO(iso, days){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(y, (m-1), d);
  dt.setDate(dt.getDate() + days);
  return formatDateISO(dt);
}

function tomorrowISO(){
  const dt = new Date();
  dt.setDate(dt.getDate() + 1);
  return formatDateISO(dt);
}

function toBRDate(iso){
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatPhoneBR(raw){
  const dig = onlyDigits(raw);
  if (dig.length === 11) return `(${dig.slice(0,2)}) ${dig.slice(2,7)}-${dig.slice(7)}`;
  if (dig.length === 10) return `(${dig.slice(0,2)}) ${dig.slice(2,6)}-${dig.slice(6)}`;
  return raw ? raw : "Não informado";
}

function toWaNumber(raw){
  const dig = onlyDigits(raw);
  if (dig.startsWith("55") && (dig.length === 12 || dig.length === 13)) return dig;
  if (dig.length === 10 || dig.length === 11) return "55" + dig;
  return dig;
}

function waLink(number, text){
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function buildOwnerMessage(b){
  const phoneText = b.phone ? formatPhoneBR(b.phone) : "Não informado";
  return `✅ Novo agendamento confirmado - Barbearia Suprema
Ticket: ${b.ticket}
Cliente: ${b.name}
Telefone: ${phoneText}
Data: ${toBRDate(b.date)}
Horário: ${b.start} às ${b.end}
Serviço: ${b.service_label}
Valor: R$ ${b.price_reais}`;
}

function ownerWhatsAppUrl(b){
  return waLink(toWaNumber(b.owner_whatsapp || state.ownerWhatsapp), buildOwnerMessage(b));
}

function setLookupStatus(type, msg){
  const box = el("lookupStatus");
  if(!box) return;
  box.className = "lookup-status" + (type ? ` ${type}` : "");
  box.textContent = msg || "";
}

function resetLoadedCustomer(){
  state.loadedCustomerPhone = "";
  state.loadedCustomerName = "";
}

function setMode(mode){
  state.mode = mode === "name_only" ? "name_only" : (mode === "existing" ? "existing" : "with_phone");
  const isNameOnly = state.mode === "name_only";
  const isExisting = state.mode === "existing";

  const modeExisting = el("modeExisting");
  const modeQuick = el("modeQuick");
  const modeNameOnly = el("modeNameOnly");
  const phoneField = el("phoneField");
  const phone = el("phone");
  const name = el("name");
  const promoBox = el("promoBox");
  const promoOpt = el("promoOpt");
  const birth = el("birth");
  const phoneOptional = el("phoneOptional");
  const existingBox = el("existingBox");

  if(modeExisting) modeExisting.classList.toggle("is-active", isExisting);
  if(modeQuick) modeQuick.classList.toggle("is-active", state.mode === "with_phone");
  if(modeNameOnly) modeNameOnly.classList.toggle("is-active", isNameOnly);
  if(phoneField) phoneField.style.display = isNameOnly ? "none" : "";
  if(existingBox) existingBox.style.display = isExisting ? "" : "none";
  if(phone) phone.required = !isNameOnly;
  if(phoneOptional) phoneOptional.textContent = isExisting ? " cadastrado" : "";
  if(promoBox) promoBox.style.display = isNameOnly ? "none" : "";

  if(isNameOnly){
    resetLoadedCustomer();
    setLookupStatus("", "");
    if(promoOpt) promoOpt.checked = false;
    if(birth) birth.value = "";
    if(phone) phone.value = "";
    if(name) name.readOnly = false;
  } else if(isExisting){
    resetLoadedCustomer();
    setLookupStatus("", "");
    if(name) name.readOnly = false;
  } else {
    resetLoadedCustomer();
    setLookupStatus("", "");
    if(name) name.readOnly = false;
  }
}

async function findExistingCustomer(){
  const phone = el("phone");
  const name = el("name");
  const promoOpt = el("promoOpt");
  const birth = el("birth");
  const digits = onlyDigits(phone?.value || "");

  resetLoadedCustomer();
  if(!(digits.length === 10 || digits.length === 11)){
    setLookupStatus("bad", "Digite o WhatsApp cadastrado com DDD.");
    return false;
  }

  const btn = el("btnFindCustomer");
  if(btn){ btn.disabled = true; btn.textContent = "Buscando..."; }
  setLookupStatus("", "Consultando cadastro...");

  try{
    const r = await fetch(`/api/customers/lookup?phone=${encodeURIComponent(phone.value)}`);
    const j = await r.json();
    if(!j.ok) throw new Error(j.error || "Falha ao buscar cadastro.");

    if(!j.found){
      setLookupStatus("bad", "Cadastro não encontrado. Use 'Agendar com WhatsApp' para criar um cadastro ou 'Sem cadastro, só nome'.");
      return false;
    }

    const c = j.customer || {};
    if(name) name.value = c.name || "";
    if(phone) phone.value = c.phone_br || phone.value;
    if(birth) birth.value = c.birth_date || "";
    if(promoOpt) promoOpt.checked = Boolean(c.marketing_opt_in);

    state.loadedCustomerPhone = toWaNumber(c.phone || phone.value);
    state.loadedCustomerName = c.name || "";
    setLookupStatus("ok", `Cadastro encontrado: ${c.name || "cliente"}. Pode continuar.`);
    return true;
  }catch(e){
    console.error(e);
    setLookupStatus("bad", e.message || "Erro ao buscar cadastro.");
    return false;
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = "Buscar cadastro"; }
  }
}

async function loadServices(){
  const r = await fetch("/api/services");
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || "Falha em /api/services");

  state.services = j.services;
  if (j.owner_whatsapp) state.ownerWhatsapp = String(j.owner_whatsapp);
  state.webhookEnabled = Boolean(j.webhook_enabled);
  el("brandHours").textContent = `${j.open} às ${j.close}`;

  const sel = el("service");
  sel.innerHTML = "";
  j.services.forEach(s=>{
    const opt = document.createElement("option");
    opt.value = s.key;
    opt.textContent = s.label;
    opt.dataset.duration = s.duration_min;
    opt.dataset.price = s.price_reais;
    sel.appendChild(opt);
  });

  // Owner WhatsApp
  // tenta pegar do backend via /api/health (owner não vem) -> fica no padrão
  const ownerBtn = el("whatsOwner");
  ownerBtn.href = waLink(toWaNumber(state.ownerWhatsapp), "Olá! Quero informações sobre outros serviços da Barbearia Suprema.");
}

async function loadSlots(){
  const date = el("date").value;
  const serviceKey = el("service").value;
  if(!date || !serviceKey) return;

  // Esconde o aviso de "sem horários" antes de recarregar
  if (el('noSlotsBox')) el('noSlotsBox').style.display = 'none';

  el("slot").innerHTML = `<option value="">Carregando...</option>`;

  const r = await fetch(`/api/slots?date=${encodeURIComponent(date)}&service=${encodeURIComponent(serviceKey)}`);
  const j = await r.json();
  if(!j.ok){
    el("slot").innerHTML = `<option value="">(erro)</option>`;
    throw new Error(j.error || "Falha em /api/slots");
  }

  if(j.slots.length === 0){
    el("slot").innerHTML = `<option value="">Sem horários disponíveis</option>`;
    renderSlotButtons([]);
    // Mostra um aviso e dá opção de ir pro próximo dia com horários
    if (el('noSlotsBox')) el('noSlotsBox').style.display = 'block';
    return;
  }

  el("slot").innerHTML = `<option value="">Selecione...</option>`;
  // Botões (app)
  renderSlotButtons(j.slots);
  j.slots.forEach(s=>{
    const opt = document.createElement("option");
    opt.value = s.value;
    opt.textContent = s.label;
    el("slot").appendChild(opt);
  });
}

function updateServiceInfo(){
  const opt = el("service").selectedOptions[0];
  if(!opt) return;
  const duration = opt.dataset.duration;
  const price = opt.dataset.price;
  el("serviceInfo").textContent = `${duration} min • R$ ${price}`;
}

function showInitError(msg){
  const box = el("initError");
  box.style.display = "block";
  box.textContent = msg;
}

function hideInitError(){
  const box = el("initError");
  box.style.display = "none";
  box.textContent = "";
}

function showTicket(b){
  el("ticketCode").textContent = b.ticket;
  el("tName").textContent = b.name;
  el("tPhone").textContent = formatPhoneBR(b.phone);
  el("tDate").textContent = toBRDate(b.date);
  el("tTime").textContent = `${b.start} → ${b.end}`;
  el("tService").textContent = `${b.service_label} (${b.duration_min} min)`;
  el("tPrice").textContent = `R$ ${b.price_reais}`;

  let status = document.getElementById('waAutoStatus');
  if(!status){
    status = document.createElement('div');
    status.id = 'waAutoStatus';
    status.className = 'hint wa-auto-status';
    const grid = document.querySelector('.ticket-grid');
    if(grid) grid.insertAdjacentElement('afterend', status);
  }
  if(status){
    if(b.webhook_enabled && b.webhook_sent){
      status.textContent = 'Aviso automático enviado para a barbearia pela automação.';
    } else if(b.webhook_enabled && !b.webhook_sent){
      status.textContent = 'Agendamento salvo. A automação do WhatsApp não confirmou o envio, use o botão abaixo se precisar reenviar manualmente.';
    } else {
      status.textContent = 'Agendamento salvo. Use o botão abaixo para abrir o WhatsApp com a mensagem pronta.';
    }
  }

  const btn = el('btnWhatsTicket');
  if(btn){
    btn.href = ownerWhatsAppUrl(b);
    btn.textContent = (b.webhook_enabled && b.webhook_sent) ? 'Reenviar aviso no WhatsApp' : 'Enviar comprovante no WhatsApp';
    btn.style.display = '';
  }
  el("ticketBox").style.display = "block";
}

function hideTicket(){
  el("ticketBox").style.display = "none";
}

async function init(){
  try{
    // regra: só pode agendar a partir de amanhã (evita marcar no dia anterior sem querer)
    const minDate = tomorrowISO();
    el("date").min = minDate;
    el("date").value = minDate;

    await loadServices();
    updateServiceInfo();
    // horários serão carregados apenas no passo 4 (para não poluir a tela)

    hideInitError();
  }catch(e){
    console.error(e);
    showInitError("Erro ao iniciar o site. Verifique o banco/variáveis no Coolify e faça Redeploy.");
  }

  function clearSlotSelection(){
    el('slot').value = '';
    const grid = el('slotGrid');
    if(grid) grid.innerHTML = '';
    el('btnConfirm').disabled = true;
  }

  // Modo do agendamento: cadastro salvo, com WhatsApp ou sem cadastro, só nome
  setMode("with_phone");
  if(el("modeExisting")) el("modeExisting").addEventListener("click", ()=> setMode("existing"));
  if(el("modeQuick")) el("modeQuick").addEventListener("click", ()=> setMode("with_phone"));
  if(el("modeNameOnly")) el("modeNameOnly").addEventListener("click", ()=> setMode("name_only"));
  if(el("btnFindCustomer")) el("btnFindCustomer").addEventListener("click", ()=> findExistingCustomer());
  if(el("phone")) el("phone").addEventListener("input", ()=>{
    if(state.mode === "existing"){
      resetLoadedCustomer();
      setLookupStatus("", "Digite o WhatsApp e toque em Buscar cadastro.");
    }
  });

  el("service").addEventListener("change", ()=>{
    updateServiceInfo();
    clearSlotSelection();
  });

  el("date").addEventListener("change", ()=>{
    // garante regra de "a partir de amanhã"
    const minDate = el("date").min || tomorrowISO();
    if(el("date").value && el("date").value < minDate){
      el("date").value = minDate;
    }
    clearSlotSelection();
  });

  // Se o dia estiver lotado, permite pular para o próximo dia com horários
  const btnNextDay = el('btnNextDay');
  if(btnNextDay){
    btnNextDay.addEventListener('click', async ()=>{
      const base = el('date').value || (el('date').min || tomorrowISO());
      // procura até 30 dias à frente
      for(let i=1;i<=30;i++){
        const cand = addDaysISO(base, i);
        try{
          const r = await fetch(`/api/slots?date=${encodeURIComponent(cand)}&service=${encodeURIComponent(el('service').value)}`);
          const j = await r.json();
          if(j.ok && Array.isArray(j.slots) && j.slots.length>0){
            el('date').value = cand;
            clearSlotSelection();
            await loadSlots();
            return;
          }
        } catch {}
      }
      alert('Não encontramos horários nos próximos 30 dias. Tente outra data mais pra frente.');
    });
  }

  // Wizard (Próximo/Voltar)
  el('btnBack').addEventListener('click', ()=>{
    if(currentStep > 1) showStep(currentStep - 1);
  });

  function validStep1(){
    const name = el('name').value.trim();
    const phone = onlyDigits(el('phone').value);
    if(state.mode === 'existing'){
      if(!(phone.length === 10 || phone.length === 11)) return 'Digite o WhatsApp cadastrado com DDD.';
      if(!state.loadedCustomerPhone || state.loadedCustomerPhone !== toWaNumber(el('phone').value)){
        return 'Toque em "Buscar cadastro" antes de continuar.';
      }
    }
    if(name.length < 2) return 'Digite seu nome.';
    if(state.mode !== 'name_only' && !(phone.length === 10 || phone.length === 11)) return 'Digite um WhatsApp válido ou escolha "Sem cadastro, só nome".';
    return '';
  }
  function validStep2(){
    if(!el('service').value) return "Selecione um serviço.";
    return "";
  }
  function validStep3(){
    if(!el('date').value) return "Selecione uma data.";
    const minDate = el('date').min || tomorrowISO();
    if(el('date').value < minDate) return "Só é possível agendar a partir de amanhã.";
    return "";
  }

  el('btnNext').addEventListener('click', async ()=>{
    hideInitError();
    let err = "";
    if(currentStep === 1) err = validStep1();
    if(currentStep === 2) err = validStep2();
    if(currentStep === 3) err = validStep3();

    if(err){
      showInitError(err);
      return;
    }

    // entrando no passo 4: carrega slots
    if(currentStep === 3){
      try{
        await loadSlots();
      }catch(e){
        showInitError("Erro ao carregar horários. (DB)");
        return;
      }
    }

    showStep(currentStep + 1);
  });

  el("bookingForm").addEventListener("submit", async (ev)=>{
    ev.preventDefault();
    hideInitError();

    // evita dupla confirmação / estado confuso
    if (state.__bookingConfirmed) return;

    const payload = {
      name: el("name").value.trim(),
      phone: state.mode === 'name_only' ? '' : el("phone").value.trim(),
      date: el("date").value,
      service_key: el("service").value,
      start_min: Number(el("slot").value),
      marketing_opt_in: state.mode === 'name_only' ? false : Boolean(el('promoOpt')?.checked),
      birth_date: state.mode === 'name_only' ? '' : String(el('birth')?.value || '')
    };

    if(!payload.start_min){
      showInitError("Selecione um horário disponível.");
      return;
    }

    el("btnConfirm").disabled = true;
    el("btnConfirm").textContent = "Confirmando...";

    // Se não tiver webhook configurado, abre uma aba no clique do usuário
    // e depois coloca a mensagem pronta. Com webhook, não abre nada: a automação cuida do aviso.
    let waPopup = null;
    if(!state.webhookEnabled){
      try{
        waPopup = window.open("about:blank", "barbearia_aviso_whatsapp");
        if(waPopup){
          waPopup.document.write("<title>WhatsApp</title><body style='font-family:Arial;padding:22px'>Preparando aviso para a barbearia...</body>");
        }
      }catch{}
    }

    let success = false;
    try{
      const r = await fetch("/api/bookings", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if(!j.ok){
        if(waPopup) try{ waPopup.close(); }catch{}
        showInitError(j.error || "Erro ao confirmar.");
        return;
      }

      success = true;
      state.__bookingConfirmed = true;
      showTicket(j.booking);

      const waUrl = ownerWhatsAppUrl(j.booking);
      if(!j.booking.webhook_enabled){
        if(waPopup){
          waPopup.location.href = waUrl;
        } else {
          setTimeout(()=> window.open(waUrl, "_blank", "noopener"), 250);
        }
      } else if(waPopup){
        try{ waPopup.close(); }catch{}
      }

      // Esconde a barra de navegação para não parecer que "ainda falta confirmar"
      const bottom = document.querySelector('.bottom-bar');
      if (bottom) bottom.style.display = 'none';
      // trava o stepper (evita clicar e tentar confirmar de novo)
      document.querySelectorAll('.step-pill').forEach(b=> b.disabled = true);
      // Atualiza slots após reservar
      await loadSlots();
    }catch(e){
      if(waPopup) try{ waPopup.close(); }catch{}
      console.error(e);
      showInitError("Erro ao confirmar (DB).");
    }finally{
      if(!success){
        el("btnConfirm").disabled = false;
        el("btnConfirm").textContent = "Confirmar";
      } else {
        el("btnConfirm").disabled = true;
        el("btnConfirm").textContent = "Confirmado";
      }
    }
  });

  el("btnCopy").addEventListener("click", async ()=>{
    try{
      await navigator.clipboard.writeText(el("ticketCode").textContent);
      el("btnCopy").textContent = "Copiado!";
      setTimeout(()=> el("btnCopy").textContent = "Copiar ticket", 1200);
    }catch{
      // fallback
      alert("Copie o ticket: " + el("ticketCode").textContent);
    }
  });

  el("btnNew").addEventListener("click", ()=>{
    hideTicket();
    // reabilita navegação
    const bottom = document.querySelector('.bottom-bar');
    if (bottom) bottom.style.display = '';
    document.querySelectorAll('.step-pill').forEach(b=> b.disabled = false);
    state.__bookingConfirmed = false;
    el("name").value = "";
    el("phone").value = "";
    if(el('birth')) el('birth').value = '';
    if(el('promoOpt')) el('promoOpt').checked = false;
    resetLoadedCustomer();
    setLookupStatus("", "");
    setMode("with_phone");
    el("slot").value = "";
    el("name").focus();
    showStep(1);
  });
  // Stepper: permite voltar para passos anteriores (não pula pra frente sem preencher)
  document.querySelectorAll(".step-pill").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const n = Number(btn.dataset.step);
      if(n <= currentStep) showStep(n);
    });
  });

  showStep(1);

  // PWA (instalar como app)
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('/sw.js').catch(()=>{});
  }

}

init();
