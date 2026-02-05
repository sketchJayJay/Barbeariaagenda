const el = (id) => document.getElementById(id);

const state = {
  services: [],
  ownerWhatsapp: "32998195165",
  selectedService: null,
  selectedDate: null
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
    btn.className = "slot-btn" + (current===s.value ? " is-selected" : "");
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

function toBRDate(iso){
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function formatPhoneBR(raw){
  const dig = onlyDigits(raw);
  if (dig.length === 11) return `(${dig.slice(0,2)}) ${dig.slice(2,7)}-${dig.slice(7)}`;
  if (dig.length === 10) return `(${dig.slice(0,2)}) ${dig.slice(2,6)}-${dig.slice(6)}`;
  return raw;
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

async function loadServices(){
  const r = await fetch("/api/services");
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || "Falha em /api/services");

  state.services = j.services;
  if (j.owner_whatsapp) state.ownerWhatsapp = String(j.owner_whatsapp);
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
  ownerBtn.href = waLink("55"+state.ownerWhatsapp, "Olá! Quero informações sobre outros serviços da Barbearia Suprema.");
}

async function loadSlots(){
  const date = el("date").value;
  const serviceKey = el("service").value;
  if(!date || !serviceKey) return;

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

  const msg =
`✅ Agendamento confirmado (Barbearia Suprema)
Ticket: ${b.ticket}
Cliente: ${b.name}
Data: ${toBRDate(b.date)}
Horário: ${b.start}
Serviço: ${b.service_label}
Valor: R$ ${b.price_reais}

Guarde seu ticket.`;

  const wa = waLink(toWaNumber(b.phone), msg);
  el("btnWhatsTicket").href = wa;

  el("ticketBox").style.display = "block";
}

function hideTicket(){
  el("ticketBox").style.display = "none";
}

async function init(){
  try{
    const today = new Date();
    el("date").value = formatDateISO(today);

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

  el("service").addEventListener("change", ()=>{
    updateServiceInfo();
    clearSlotSelection();
  });

  el("date").addEventListener("change", ()=>{
    clearSlotSelection();
  });

  // Wizard (Próximo/Voltar)
  el('btnBack').addEventListener('click', ()=>{
    if(currentStep > 1) showStep(currentStep - 1);
  });

  function validStep1(){
    const name = el('name').value.trim();
    const phone = onlyDigits(el('phone').value);
    if(name.length < 2) return "Digite seu nome.";
    if(!(phone.length === 10 || phone.length === 11)) return "Digite um WhatsApp válido.";
    return "";
  }
  function validStep2(){
    if(!el('service').value) return "Selecione um serviço.";
    return "";
  }
  function validStep3(){
    if(!el('date').value) return "Selecione uma data.";
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

    const payload = {
      name: el("name").value.trim(),
      phone: el("phone").value.trim(),
      date: el("date").value,
      service_key: el("service").value,
      start_min: Number(el("slot").value)
    };

    if(!payload.start_min){
      showInitError("Selecione um horário disponível.");
      return;
    }

    el("btnConfirm").disabled = true;
    el("btnConfirm").textContent = "Confirmando...";
    try{
      const r = await fetch("/api/bookings", {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json();
      if(!j.ok){
        showInitError(j.error || "Erro ao confirmar.");
        return;
      }

      showTicket(j.booking);
      // Atualiza slots após reservar
      await loadSlots();
    }catch(e){
      console.error(e);
      showInitError("Erro ao confirmar (DB).");
    }finally{
      el("btnConfirm").disabled = false;
      el("btnConfirm").textContent = "Confirmar Agendamento";
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
    el("name").value = "";
    el("phone").value = "";
    el("slot").value = "";
    el("name").focus();
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
