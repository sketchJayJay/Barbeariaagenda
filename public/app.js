const el = (id) => document.getElementById(id);

const state = {
  services: [],
  ownerWhatsapp: "32998195165",
  selectedService: null,
  selectedDate: null
};

let slotTimer = null;

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

function refreshConfirmState(){
  const btn = el("btnConfirm");
  if(!btn) return;
  const nameOk = (el("name")?.value || "").trim().length >= 2;
  const phoneOk = onlyDigits(el("phone")?.value || "").length >= 10;
  const dateOk = !!(el("date")?.value);
  const serviceOk = !!(el("service")?.value);
  const slotOk = !!(el("slot")?.value);
  btn.disabled = !(nameOk && phoneOk && dateOk && serviceOk && slotOk);
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
  ownerBtn.href = waLink(toWaNumber(state.ownerWhatsapp), "Olá! Quero informações sobre outros serviços da Barbearia Suprema.");
}

async function loadSlots(silent = false){
  const date = el("date").value;
  const serviceKey = el("service").value;
  if(!date || !serviceKey) return;

  const prevSlot = el("slot").value;
  const grid = el("slotGrid");
  const hint = el("slotHint");

  // estado de carregamento
  if (!silent) {
    grid.innerHTML = `<div class="slot-loading">Carregando horários...</div>`;
    hint.textContent = "";
  }

  const r = await fetch(`/api/slots?date=${encodeURIComponent(date)}&service=${encodeURIComponent(serviceKey)}`);
  const j = await r.json();
  if(!j.ok){
    grid.innerHTML = `<div class="slot-empty">(erro ao carregar horários)</div>`;
    throw new Error(j.error || "Falha em /api/slots");
  }

  if(j.slots.length === 0){
    grid.innerHTML = `<div class="slot-empty">Sem horários disponíveis</div>`;
    el("slot").value = "";
    hint.textContent = "Escolha outra data ou outro serviço.";
    return;
  }

  // Renderiza slots como botões (cara de app)
  grid.innerHTML = "";
  j.slots.forEach(s=>{
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "slotbtn";
    btn.dataset.value = String(s.value);
    btn.innerHTML = `<div class="slot-time">${s.label}</div><div class="slot-sub">Disponível</div>`;
    btn.addEventListener("click", ()=>{
      el("slot").value = String(s.value);
      document.querySelectorAll(".slotbtn").forEach(b=>{
        b.classList.toggle("active", b.dataset.value === String(s.value));
      });
      hint.textContent = `Selecionado: ${s.label}`;
      refreshConfirmState();
      // ajuda a guiar no celular
      const name = el("name");
      if (name && window.innerWidth <= 520) {
        setTimeout(()=> name.scrollIntoView({behavior:"smooth", block:"start"}), 120);
      }
    });
    grid.appendChild(btn);
  });

  // Mantém seleção (se ainda existir) quando atualiza automaticamente
  if (prevSlot && j.slots.some(s => String(s.value) === String(prevSlot))) {
    el("slot").value = String(prevSlot);
    document.querySelectorAll(".slotbtn").forEach(b=>{
      b.classList.toggle("active", b.dataset.value === String(prevSlot));
    });
    const found = j.slots.find(s => String(s.value) === String(prevSlot));
    if(found) hint.textContent = `Selecionado: ${found.label}`;
  } else {
    el("slot").value = "";
    hint.textContent = "Toque em um horário para selecionar.";
  }

  refreshConfirmState();
}

function startSlotAutoRefresh(){
  if (slotTimer) clearInterval(slotTimer);
  slotTimer = setInterval(async ()=>{
    // se já confirmou, não precisa ficar atualizando
    if (el("ticketBox").style.display === "block") return;
    try { await loadSlots(true); } catch { /* silencioso */ }
  }, 25000);
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

  const msgBarber =
`✅ Novo agendamento (Barbearia Suprema)
Ticket: ${b.ticket}
Cliente: ${b.name}
WhatsApp do cliente: ${formatPhoneBR(b.phone)}
Data: ${toBRDate(b.date)}
Horário: ${b.start}
Serviço: ${b.service_label}
Valor: R$ ${b.price_reais}`;

  const msgMe =
`✅ Meu agendamento confirmado (Barbearia Suprema)
Ticket: ${b.ticket}
Data: ${toBRDate(b.date)}
Horário: ${b.start}
Serviço: ${b.service_label}
Valor: R$ ${b.price_reais}`;

  el("btnWhatsBarber").href = waLink(toWaNumber(state.ownerWhatsapp), msgBarber);
  el("btnWhatsMe").href = waLink(toWaNumber(b.phone), msgMe);

  el("ticketBox").style.display = "block";
  const ab = el("actionBar");
  if (ab) ab.style.display = "none";
  // no celular, desce direto no ticket
  if (window.innerWidth <= 520) {
    setTimeout(()=> el("ticketBox").scrollIntoView({behavior:"smooth", block:"start"}), 120);
  }
}

function hideTicket(){
  el("ticketBox").style.display = "none";
  const ab = el("actionBar");
  if (ab) ab.style.display = "block";
}

async function init(){
  try{
    const today = new Date();
    el("date").value = formatDateISO(today);
    el("date").min = formatDateISO(today);

    await loadServices();
    updateServiceInfo();
    await loadSlots();
    startSlotAutoRefresh();

    refreshConfirmState();

    hideInitError();
  }catch(e){
    console.error(e);
    showInitError("Erro ao iniciar o site. Verifique o banco/variáveis no Coolify e faça Redeploy.");
  }

  el("service").addEventListener("change", async ()=>{
    updateServiceInfo();
    try{ await loadSlots(); }catch(e){ showInitError("Erro ao carregar horários. (DB)"); }
    refreshConfirmState();
    if (window.innerWidth <= 520) {
      setTimeout(()=> el("stepDate").scrollIntoView({behavior:"smooth", block:"start"}), 120);
    }
  });

  el("date").addEventListener("change", async ()=>{
    try{ await loadSlots(); hideInitError(); }catch(e){ showInitError("Erro ao carregar horários. (DB)"); }
    refreshConfirmState();
    if (window.innerWidth <= 520) {
      setTimeout(()=> el("stepTime").scrollIntoView({behavior:"smooth", block:"start"}), 120);
    }
  });

  el("name").addEventListener("input", refreshConfirmState);
  el("phone").addEventListener("input", refreshConfirmState);

  // PWA (cara de app)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(()=>{});
  }

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
    const hint = el("slotHint");
    if (hint) hint.textContent = "";
    document.querySelectorAll(".slotbtn").forEach(b=> b.classList.remove("active"));
    refreshConfirmState();
    el("name").focus();
  });
}

init();
