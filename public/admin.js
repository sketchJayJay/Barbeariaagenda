const $ = (id) => document.getElementById(id);
let token = "";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeFromMin(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function msg(t) { $("msg").textContent = t; }

async function login() {
  const pass = $("pass").value.trim();
  if (!pass) return msg("Digite a senha.");
  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pass }),
  });
  const data = await res.json();
  if (!res.ok) return msg(data.error || "Falha no login.");
  token = data.token;
  msg("Logado ✅");
  await fetchBookings();
}

async function fetchBookings() {
  if (!token) return;
  const d = $("filterDate").value;
  const url = d ? `/api/admin/bookings?date=${encodeURIComponent(d)}` : "/api/admin/bookings";
  const res = await fetch(url, { headers: { "x-admin-token": token } });
  const data = await res.json();
  if (!res.ok) {
    msg(data.error || "Erro ao carregar.");
    return;
  }

  const el = $("table");
  if (!Array.isArray(data) || data.length === 0) {
    el.innerHTML = "<p class='hint'>Nenhum agendamento.</p>";
    return;
  }

  el.innerHTML = `
    <div class="row head">
      <div>Data</div><div>Hora</div><div>Nome</div><div>Telefone</div><div>Serviço</div><div>Status</div><div>Ações</div>
    </div>
    ${data.map(b => `
      <div class="row">
        <div>${b.date || ""}</div>
        <div>${Number.isFinite(b.start_min) ? timeFromMin(b.start_min) : ""}</div>
        <div>${b.name || ""}</div>
        <div>${b.phone || ""}</div>
        <div>${b.service_label || b.service_key || ""}</div>
        <div>${b.status || ""}</div>
        <div>
          ${b.status === "active" ? `<button class="btn danger" data-id="${b.id}">Cancelar</button>` : ""}
        </div>
      </div>
    `).join("")}
  `;

  el.querySelectorAll("button[data-id]").forEach(btn => {
    btn.addEventListener("click", () => cancelBooking(btn.getAttribute("data-id")));
  });
}

async function cancelBooking(id) {
  if (!token) return;
  const res = await fetch(`/api/admin/bookings/${id}/cancel`, {
    method: "POST",
    headers: { "x-admin-token": token },
  });
  const data = await res.json();
  if (!res.ok) return msg(data.error || "Erro ao cancelar.");
  msg("Cancelado ✅");
  await fetchBookings();
}

$("filterDate").value = todayISO();

$("btnLogin").addEventListener("click", login);
$("btnRefresh").addEventListener("click", fetchBookings);
