const $ = (id) => document.getElementById(id);

const SERVICES = {
  corte_sobrancelha: { label: "Corte + Sobrancelha", duration: 40, price: 40 },
  corte: { label: "Corte", duration: 40, price: 35 },
  corte_barba: { label: "Corte + Barba", duration: 50, price: 50 },
  corte_pigmentacao: { label: "Corte + Pigmentação", duration: 60, price: 50 },
  barba: { label: "Barba", duration: 20, price: 20 },
  corte_barba_pigmentacao: { label: "Corte + Barba + Pigmentação", duration: 60, price: 60 },
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function brl(v) {
  try { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  catch { return `R$ ${v}`; }
}

let WA_LINK = "https://wa.me/5532998195165";

async function loadMeta() {
  try {
    const res = await fetch("/api/meta");
    const data = await res.json();
    if (data?.whatsapp_link) WA_LINK = data.whatsapp_link;

    const msg = encodeURIComponent("Oi! Não achei meu serviço na lista. Pode me ajudar? 😊");
    $("waTop").href = `${WA_LINK}?text=${msg}`;
    $("waOther").href = `${WA_LINK}?text=${msg}`;
  } catch (_) {
    // ignore
  }
}

function renderServiceInfo() {
  const key = $("service").value;
  const s = SERVICES[key];
  $("serviceInfo").textContent = s ? `${s.duration} min • ${brl(s.price)}` : "";
}

async function loadSlots() {
  const date = $("date").value;
  const service = $("service").value;
  const sel = $("time");
  sel.innerHTML = "";

  if (!date || !service) return;

  $("msg").textContent = "Carregando horários...";
  try {
    const res = await fetch(`/api/slots?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}`);
    const data = await res.json();

    if (!res.ok) {
      $("msg").textContent = data?.error === "db_error"
        ? "Erro: db_error (banco desconectado ou tabela não criada)"
        : (data?.error || "Erro ao carregar horários.");
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      $("msg").textContent = "Sem horários disponíveis para essa data/serviço.";
      return;
    }

    data.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });

    $("msg").textContent = "";
  } catch (e) {
    $("msg").textContent = "Falha ao carregar horários.";
  }
}

async function book() {
  const payload = {
    name: $("name").value.trim(),
    phone: $("phone").value.trim(),
    date: $("date").value,
    time: $("time").value,
    serviceKey: $("service").value,
  };

  if (!payload.name || !payload.phone || !payload.date || !payload.time || !payload.serviceKey) {
    $("msg").textContent = "Preencha nome, telefone, data, serviço e horário.";
    return;
  }

  $("msg").textContent = "Salvando...";
  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      $("msg").textContent = data?.error === "slot_taken"
        ? "Esse horário acabou de ser ocupado. Tente outro."
        : (data?.error || "Erro ao agendar.");
      return;
    }

    $("msg").textContent = "Agendado ✅";
    await loadSlots();
  } catch (_) {
    $("msg").textContent = "Erro ao agendar.";
  }
}

$("date").value = todayISO();

$("service").addEventListener("change", () => {
  renderServiceInfo();
  loadSlots();
});
$("date").addEventListener("change", loadSlots);
$("btnBook").addEventListener("click", book);

renderServiceInfo();
loadMeta();
loadSlots();
