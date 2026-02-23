function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",""":"&quot;","'":"&#39;"}[c]));
}

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
function reais(v){
  // v string "12.34"
  return "R$ " + String(v).replace(".", ",");
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

// Finance
function weekRange(today){
  const d = new Date(today);
  const day = d.getDay(); // 0=dom
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [start, end];
}
function monthRange(today){
  const d = new Date(today);
  const start = new Date(d.getFullYear(), d.getMonth(), 1);
  const end = new Date(d.getFullYear(), d.getMonth()+1, 0);
  return [start, end];
}

async function loadFinance(){
  const start = el("finStart").value;
  const end = el("finEnd").value;

  const sum = await fetchJSON(`/api/admin/finance/summary?start=${start}&end=${end}`);
  el("sumIn").textContent = reais(sum.total_in_reais);
  el("sumOut").textContent = reais(sum.total_out_reais);
  el("sumNet").textContent = reais(sum.net_reais);

  const list = await fetchJSON(`/api/admin/finance?start=${start}&end=${end}`);
  const rows = list.items;

  const html = `
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Tipo</th>
        <th>Descrição</th>
        <th>Valor</th>
      </tr>
    </thead>
    <tbody>
      ${rows.map(it=>{
        const pill = it.kind === "in" ? "ok" : "bad";
        const label = it.kind === "in" ? "Entrada" : "Saída";
        return `
          <tr>
            <td>${toBRDate(it.date)}</td>
            <td><span class="pill ${pill}">${label}</span></td>
            <td>${it.description || ""}</td>
            <td><b>${reais(it.amount_reais)}</b></td>
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>`;
  el("finList").innerHTML = html;
}

async function addFinance(){
  const kind = el("finKind").value;
  const amount = Number(el("finAmount").value);
  const date = el("finDate").value;
  const desc = el("finDesc").value;

  if(!amount || amount <= 0) return alert("Informe um valor válido.");
  if(!date) return alert("Informe a data.");

  try{
    await fetchJSON("/api/admin/finance", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify({ kind, amount_reais: amount, date, description: desc })
    });
    el("finAmount").value = "";
    el("finDesc").value = "";
    await loadFinance();
  }catch(e){
    alert("Erro: " + e.message);
  }
}

async function init(){
  const today = new Date();
  el("admDate").value = formatDateISO(today);

  // Finance default: mês atual
  const [ms, me] = monthRange(today);
  el("finStart").value = formatDateISO(ms);
  el("finEnd").value = formatDateISO(me);
  el("finDate").value = formatDateISO(today);

  el("btnReload").addEventListener("click", loadBookings);
  el("admDate").addEventListener("change", loadBookings);

  el("btnWeek").addEventListener("click", ()=>{
    const [s,e]=weekRange(new Date());
    el("finStart").value = formatDateISO(s);
    el("finEnd").value = formatDateISO(e);
    loadFinance();
  });
  el("btnMonth").addEventListener("click", ()=>{
    const [s,e]=monthRange(new Date());
    el("finStart").value = formatDateISO(s);
    el("finEnd").value = formatDateISO(e);
    loadFinance();
  });

  el("finStart").addEventListener("change", loadFinance);
  el("finEnd").addEventListener("change", loadFinance);
  el("btnAddFin").addEventListener("click", addFinance);

  try{
    await loadBookings();
    await loadFinance();
  }catch(e){
    alert("Erro (login expirou?): " + e.message + "\nVolte e faça login de novo.");
    location.href="/admin/login";
  }
}

init();


async function loadCustomers(){
  try{
    const r = await fetch('/api/admin/customers');
    const j = await r.json();
    if(!j.ok) throw new Error(j.error||'erro');
    const el = document.getElementById('custList');
    if(!el) return;
    if(!j.customers || j.customers.length===0){
      el.innerHTML = '<div class="muted">Nenhum cliente cadastrado ainda.</div>';
      return;
    }
    el.innerHTML = `
      <div class="trow thead">
        <div>Nome</div>
        <div>WhatsApp</div>
        <div>Nascimento</div>
      </div>
      ${j.customers.map(c=>`
        <div class="trow">
          <div><b>${escapeHtml(c.name)}</b></div>
          <div>${escapeHtml(c.phone_e164)}</div>
          <div>${escapeHtml(c.birth_date||'')}</div>
        </div>`).join('')}
    `;
  }catch(e){
    console.log('customers error', e);
  }
}

function copyCustomers(){
  // copia em formato simples: Nome - WhatsApp
  const rows = Array.from(document.querySelectorAll('#custList .trow')).slice(1);
  const lines = rows.map(r=>{
    const cols = r.querySelectorAll('div');
    if(cols.length<2) return '';
    return `${cols[0].innerText.replace(/\s+/g,' ').trim()}	${cols[1].innerText.replace(/\s+/g,'').trim()}`;
  }).filter(Boolean);
  const txt = lines.join('
');
  navigator.clipboard.writeText(txt).then(()=>{
    const btn = document.getElementById('btnCopyCustomers');
    if(btn){
      const old = btn.textContent;
      btn.textContent = 'Copiado!';
      setTimeout(()=>btn.textContent=old, 1200);
    }
  }).catch(()=> alert('Não foi possível copiar automaticamente.'));
}

// hooks
document.addEventListener('DOMContentLoaded', ()=>{
  const b1 = document.getElementById('btnReloadCustomers');
  const b2 = document.getElementById('btnCopyCustomers');
  if(b1) b1.addEventListener('click', loadCustomers);
  if(b2) b2.addEventListener('click', copyCustomers);
  // carrega 1x
  loadCustomers();
});
