async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "erro");
  return data;
}

function qs(id){ return document.getElementById(id); }

const elDate = qs("date");
const elService = qs("service");
const elName = qs("name");
const elWhats = qs("whats");
const elSlots = qs("slots");
const elMsg = qs("msg");
const btnLoad = qs("btnLoad");

function todayISO(){
  const d = new Date();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function setMsg(t){ elMsg.textContent = t || ""; }

async function loadServices(){
  const { services } = await api("/api/services");
  elService.innerHTML = services.map(s => `<option value="${s.id}">${s.name} (${s.durationMin}min)</option>`).join("");
}

function renderSlots(list, date, serviceId){
  elSlots.innerHTML = "";
  if (!list.length){
    setMsg("Nenhum horário disponível para essa data.");
    return;
  }
  setMsg("Clique em um horário para agendar.");
  list.forEach(s => {
    const b = document.createElement("button");
    b.className = "slotBtn";
    b.textContent = `${s.start}`;
    b.onclick = async () => {
      const clientName = (elName.value || "").trim();
      if (clientName.length < 2) return setMsg("Digite seu nome para confirmar.");
      b.disabled = true;
      try{
        const body = {
          date,
          time: s.start,
          serviceId,
          clientName,
          clientWhatsapp: (elWhats.value || "").trim()
        };
        const r = await api("/api/book", { method:"POST", body: JSON.stringify(body) });
        setMsg(`Agendado! Código: ${r.code}`);
        btnLoad.click(); // refresh
      }catch(e){
        setMsg(e.message);
      }finally{
        b.disabled = false;
      }
    };
    elSlots.appendChild(b);
  });
}

btnLoad.onclick = async () => {
  const date = elDate.value;
  const serviceId = elService.value;
  if (!date) return setMsg("Selecione uma data.");
  setMsg("Carregando horários...");
  try{
    const r = await api(`/api/availability?date=${encodeURIComponent(date)}&service=${encodeURIComponent(serviceId)}`);
    renderSlots(r.available || [], date, serviceId);
  }catch(e){
    setMsg(e.message);
  }
};

(async function init(){
  elDate.value = todayISO();
  await loadServices();
  btnLoad.click();
})();
