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

function renderServiceInfo() {
  const key = $("service").value;
  const s = SERVICES[key];
  $("serviceInfo").textContent = s ? `${s.duration} min • R$ ${s.price}` : "";
}

async function loadSlots() {
  const date = $("date").value;
  const service = $("service").value;
  const sel = $("time");
  sel.innerHTML = "";
  sel.disabled = true;

  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "Carregando horários...";
  sel.appendChild(o0);

  if (!date || !service) {
    $("msg").textContent = "Selecione data e serviço.";
    return;
  }

  try {
    const res = await fetch(`/api/slots?date=${encodeURIComponent(date)}&service=${encodeURIComponent(service)}`);
    let data = null;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok) {
      $("msg").textContent = (data && data.error) ? `Erro: ${data.error}` : `Erro ao carregar horários (${res.status}).`;
      sel.innerHTML = "";
      sel.disabled = true;
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      $("msg").textContent = "Sem horários disponíveis para essa data/serviço.";
      sel.innerHTML = "";
      sel.disabled = true;
      return;
    }

    sel.innerHTML = "";
    data.forEach(t => {
      const o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });

    sel.disabled = false;
    $("msg").textContent = "";
  } catch (e) {
    $("msg").textContent = "Falha ao buscar horários. Verifique se o banco (Postgres) está ligado e se DATABASE_URL está certo.";
    sel.innerHTML = "";
    sel.disabled = true;
  }
}

async function book() {
  const key = $("service").value;
  const s = SERVICES[key];

  const payload = {
    name: $("name").value.trim(),
    phone: $("phone").value.trim(),
    date: $("date").value,
    time: $("time").value,
    serviceKey: key,
  };

  if (!payload.name || !payload.phone || !payload.date || !payload.time || !payload.serviceKey) {
    $("msg").textContent = "Preencha nome, telefone, serviço, data e horário.";
    return;
  }

  const res = await fetch("/api/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    $("msg").textContent = data.error || "Erro ao agendar.";
    return;
  }

  $("msg").textContent = `Agendado ✅ (${s.label} - R$ ${s.price})`;
  await loadSlots();
}

$("date").value = todayISO();
$("service").addEventListener("change", () => {
  renderServiceInfo();
  loadSlots();
});
$("date").addEventListener("change", loadSlots);
$("btnBook").addEventListener("click", book);

renderServiceInfo();
loadSlots();
