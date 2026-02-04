const $ = (id) => document.getElementById(id);
let token = "";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function brl(n) {
  const v = Number(n || 0);
  try { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  catch { return `R$ ${v.toFixed(2)}`; }
}

function msg(t) { $("finMsg").textContent = t; }
function txMsg(t) { $("txMsg").textContent = t; }

async function login() {
  const pass = $("finPass").value.trim();
  if (!pass) return msg("Digite a senha.");
  const res = await fetch("/api/finance/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pass }),
  });
  const data = await res.json();
  if (!res.ok) return msg(data.error || "Falha no login.");
  token = data.token;

  $("loginCard").classList.add("hidden");
  $("finCard").classList.remove("hidden");
  msg("");

  await refreshAll();
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadTx()]);
}

async function loadSummary() {
  const date = $("finDate").value;
  const res = await fetch(`/api/finance/summary?date=${encodeURIComponent(date)}`, {
    headers: { "x-finance-token": token },
  });
  const data = await res.json();
  if (!res.ok) {
    txMsg(data.error || "Erro no resumo.");
    return;
  }
  $("kpiIn").textContent = brl(data.total_in);
  $("kpiOut").textContent = brl(data.total_out);
  $("kpiNet").textContent = brl(data.net);
}

function renderTxTable(rows) {
  if (!rows.length) return "<p class='hint'>Nenhum movimento neste dia.</p>";

  const head = `
    <div class="row head">
      <div>Hora</div><div>Tipo</div><div>Valor</div><div>Método</div><div>Categoria</div><div>Descrição</div><div>Ações</div>
    </div>
  `;

  const body = rows.map(r => {
    const dt = new Date(r.created_at);
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    const typeLabel = r.type === "in" ? "Entrada" : "Saída";

    return `
      <div class="row">
        <div>${hh}:${mm}</div>
        <div>${typeLabel}</div>
        <div>${brl(Number(r.amount))}</div>
        <div>${r.method || ""}</div>
        <div>${r.category || ""}</div>
        <div>${r.description || ""}</div>
        <div><button class="btn danger" data-del="${r.id}">Excluir</button></div>
      </div>
    `;
  }).join("");

  return head + body;
}

async function loadTx() {
  const date = $("finDate").value;
  const res = await fetch(`/api/finance/tx?date=${encodeURIComponent(date)}`, {
    headers: { "x-finance-token": token },
  });
  const data = await res.json();
  if (!res.ok) {
    txMsg(data.error || "Erro ao carregar movimentos.");
    return;
  }
  $("txTable").innerHTML = renderTxTable(Array.isArray(data) ? data : []);
  $("txTable").querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => delTx(btn.getAttribute("data-del")));
  });
}

async function addTx() {
  const date = $("finDate").value;
  const payload = {
    date,
    type: $("txType").value,
    amount: Number($("txAmount").value),
    method: $("txMethod").value,
    category: $("txCategory").value.trim(),
    description: $("txDesc").value.trim(),
  };

  if (!payload.amount || payload.amount < 0) {
    txMsg("Informe um valor válido.");
    return;
  }

  txMsg("Salvando...");
  const res = await fetch("/api/finance/tx", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-finance-token": token },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    txMsg(data.error || "Erro ao salvar.");
    return;
  }

  $("txAmount").value = "";
  $("txDesc").value = "";
  txMsg("Salvo ✅");

  await refreshAll();
}

async function delTx(id) {
  const res = await fetch(`/api/finance/tx/${id}`, {
    method: "DELETE",
    headers: { "x-finance-token": token },
  });
  const data = await res.json();
  if (!res.ok) {
    txMsg(data.error || "Erro ao excluir.");
    return;
  }
  txMsg("Excluído ✅");
  await refreshAll();
}

$("finDate").value = todayISO();
$("btnFinLogin").addEventListener("click", login);
$("btnFinRefresh").addEventListener("click", refreshAll);
$("btnTxAdd").addEventListener("click", addTx);
