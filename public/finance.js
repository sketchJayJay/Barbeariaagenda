const el = (id)=>document.getElementById(id);

function formatDateISO(d){
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}

function toBRDate(iso){
  const [y,m,d] = String(iso||"").split("-");
  if(!y) return "";
  return `${d}/${m}/${y}`;
}

function reais(v){
  return "R$ " + String(v).replace(".", ",");
}

async function fetchJSON(url, opts){
  const r = await fetch(url, { credentials:"include", ...opts });
  const j = await r.json();
  if(!j.ok) throw new Error(j.error || "erro");
  return j;
}

function showError(msg){
  const box = el("finError");
  box.style.display = msg ? "block" : "none";
  box.textContent = msg || "";
}

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

async function loadSummaryAndList(){
  const start = el("finStart").value;
  const end = el("finEnd").value;

  const sum = await fetchJSON(`/api/finance/summary?start=${start}&end=${end}`);
  el("sumIn").textContent = reais(sum.total_in_reais);
  el("sumOut").textContent = reais(sum.total_out_reais);
  el("sumNet").textContent = reais(sum.net_reais);

  const list = await fetchJSON(`/api/finance?start=${start}&end=${end}`);
  const rows = list.items;

  const html = `
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Tipo</th>
        <th>Descrição</th>
        <th>Obs.</th>
        <th>Valor</th>
        <th></th>
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
            <td>${escapeHtml(it.label || "")}</td>
            <td>${escapeHtml(it.note || "")}</td>
            <td><b>${reais(it.amount_reais)}</b></td>
            <td><button class="ghost small" data-del="${it.id}">Excluir</button></td>
          </tr>
        `;
      }).join("")}
    </tbody>
  </table>`;

  el("finList").innerHTML = html;
  el("finList").querySelectorAll("button[data-del]").forEach(btn=>{
    btn.addEventListener("click", ()=> delItem(btn.getAttribute("data-del")));
  });
}

function escapeHtml(s){
  return String(s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/\"/g,"&quot;")
    .replace(/'/g,"&#39;");
}

async function addItem(){
  const kind = el("finKind").value;
  const amount = Number(el("finAmount").value);
  const date = el("finDate").value;
  const label = el("finLabel").value.trim();
  const note = el("finNote").value.trim();

  if(!amount || amount <= 0) return showError("Informe um valor válido.");
  if(!date) return showError("Informe a data.");
  if(!label) return showError("Informe a descrição.");

  showError("");
  await fetchJSON("/api/finance", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ kind, amount_reais: amount, date, label, note })
  });

  el("finAmount").value = "";
  el("finLabel").value = "";
  el("finNote").value = "";
  await loadSummaryAndList();
}

async function delItem(id){
  if(!confirm("Excluir este lançamento?")) return;
  try{
    await fetchJSON(`/api/finance/${id}`, { method:"DELETE" });
    await loadSummaryAndList();
  }catch(e){
    showError("Erro: " + e.message);
  }
}

async function init(){
  const today = new Date();
  const [ms, me] = monthRange(today);
  el("finStart").value = formatDateISO(ms);
  el("finEnd").value = formatDateISO(me);
  el("finDate").value = formatDateISO(today);

  el("btnWeek").addEventListener("click", ()=>{
    const [s,e] = weekRange(new Date());
    el("finStart").value = formatDateISO(s);
    el("finEnd").value = formatDateISO(e);
    loadSummaryAndList().catch(err=>{
      showError("Erro (login expirou?): " + err.message);
      location.href="/finance/login";
    });
  });
  el("btnMonth").addEventListener("click", ()=>{
    const [s,e] = monthRange(new Date());
    el("finStart").value = formatDateISO(s);
    el("finEnd").value = formatDateISO(e);
    loadSummaryAndList().catch(err=>{
      showError("Erro (login expirou?): " + err.message);
      location.href="/finance/login";
    });
  });

  el("finStart").addEventListener("change", ()=> loadSummaryAndList().catch(()=>{}));
  el("finEnd").addEventListener("change", ()=> loadSummaryAndList().catch(()=>{}));
  el("btnReload").addEventListener("click", ()=> loadSummaryAndList().catch(()=>{}));
  el("btnAddFin").addEventListener("click", ()=> addItem().catch(e=>showError(e.message)));

  try{
    await loadSummaryAndList();
  }catch(e){
    showError("Erro (login expirou?): " + e.message);
    location.href="/finance/login";
  }
}

init();
