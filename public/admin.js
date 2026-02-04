const el = (id)=>document.getElementById(id);

function onlyDigits(v){ return String(v||"").replace(/\D/g,""); }
function toWaNumber(raw){
  const dig = onlyDigits(raw);
  if (dig.startsWith("55") && (dig.length === 12 || dig.length === 13)) return dig;
  if (dig.length === 10 || dig.length === 11) return "55" + dig;
  return dig;
}
function waLink(number, text){
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

function formatDateISO(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function toBRDate(iso){
  const [y,m,d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

async function fetchJSON(url, opts){
  const r = await fetch(url, { credentials:"include", ...opts });
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || "erro");
  return j;
}

async function loadBookings(){
  const date = el("admDate").value;
  const j = await fetchJSON(`/api/admin/bookings?date=${encodeURIComponent(date)}`);
  const rows = j.bookings;

  const html = `
  <table>
    <thead>
      <tr>
        <th>Hora</th>
        <th>Cliente</th>
        <th>Serviço</th>
        <th>Ticket</th>
        <th>Status</th>
        <th>Whats</th>
        <th>Ações</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(b=>{
        const st = b.status === "active" ? "neu" : (b.status === "done" ? "ok" : "bad");
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

        return `
        <tr>
          <td><b>${b.start}</b></td>
          <td>${b.name}<div class="muted2">${b.phone}</div></td>
          <td>${b.service_label}</td>
          <td><span class="pill">${b.ticket}</span></td>
          <td><span class="pill ${st}">${b.status}</span></td>
          <td><a class="ghost small" target="_blank" rel="noopener" href="${wa}">Whats</a></td>
          <td>
            <button class="ghost small" onclick="setStatus(${b.id},'done')">Feito</button>
            <button class="ghost small" onclick="setStatus(${b.id},'cancelled')">Cancelar</button>
            <button class="ghost small" onclick="setStatus(${b.id},'active')">Ativo</button>
          </td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;

  el("admBookings").innerHTML = html;
}

window.setStatus = async (id, status)=>{
  try{
    await fetchJSON(`/api/admin/bookings/${id}`, {
      method:"PATCH",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ status })
    });
    await loadBookings();
  }catch(e){
    alert("Erro: " + e.message);
  }
};

async function init(){
  const today = new Date();
  el("admDate").value = formatDateISO(today);
  el("btnReload").addEventListener("click", loadBookings);
  el("admDate").addEventListener("change", loadBookings);

  try{
    await loadBookings();
  }catch(e){
    alert("Erro (login expirou?): " + e.message + "\nVolte e faça login de novo.");
    location.href="/admin/login";
  }
}

init();
