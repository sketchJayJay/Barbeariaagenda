const $ = (id) => document.getElementById(id);
let token = "";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonth() {
  const t = todayISO();
  return t.slice(0, 7);
}

function brl(n) {
  const v = Number(n || 0);
  try { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  catch { return `R$ ${v.toFixed(2)}`; }
}

function msg(t) { $("finMsg").textContent = t; }
function txMsg(t) { $("txMsg").textContent = t; }

function getRange() {
  return $("finRange") ? $("finRange").value : "day";
}

function periodQuery() {
  const range = getRange();
  const date = $("finDate") ? $("finDate").value : "";
  const month = $("finMonth") ? $("finMonth").value : "";
  const qs = new URLSearchParams();
  qs.set("range", range);
  if (date) qs.set("date", date);
  if (month) qs.set("month", month);
  return qs.toString();
}

function updateRangeUI() {
  const r = getRange();
  const dateWrap = $("finDateWrap");
  const monthWrap = $("finMonthWrap");
  if (!dateWrap || !monthWrap) return;

  if (r === "month") {
    monthWrap.classList.remove("hidden");
  } else {
    monthWrap.classList.add("hidden");
  }
}

function rangeLabel(data) {
  if (!data || !data.range) return "";
  if (data.range === "day") return `Dia: ${data.from}`;
  if (data.range === "week") return `Semana: ${data.from} a ${data.to}`;
  if (data.range === "month") return `Mês: ${String(data.from).slice(0, 7)} (${data.from} a ${data.to})`;
  return `Período: ${data.from} a ${data.to}`;
}

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
  const res = await fetch(`/api/finance/summary?${periodQuery()}`, {
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

  const pl = $("periodLabel");
  if (pl) pl.textContent = rangeLabel(data);
}

function renderTxTable(rows, range) {
  if (!rows.length) {
    if (range === "day") return "<p class='hint'>Nenhum movimento neste dia.</p>";
    if (range === "week") return "<p class='hint'>Nenhum movimento nesta semana.</p>";
    return "<p class='hint'>Nenhum movimento neste mês.</p>";
  }

  const hasDateCol = range !== "day";

  const head = `
    <div class="row head">
      ${hasDateCol ? "<div>Data</div>" : ""}
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
        ${hasDateCol ? `<div>${r.date}</div>` : ""}
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
  const range = getRange();
  const res = await fetch(`/api/finance/tx?${periodQuery()}`, {
    headers: { "x-finance-token": token },
  });
  const data = await res.json();
  if (!res.ok) {
    txMsg(data.error || "Erro ao carregar movimentos.");
    return;
  }

  const rows = Array.isArray(data) ? data : (data.rows || []);
  $("txTable").innerHTML = renderTxTable(rows, range);
  $("txTable").querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => delTx(btn.getAttribute("data-del")));
  });
}

async function addTx() {
  const range = getRange();
  const date = (range === "month") ? ($("finDate").value || todayISO()) : $("finDate").value;

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

// Defaults
$("finRange").value = "day";
$("finDate").value = todayISO();
$("finMonth").value = currentMonth();
updateRangeUI();

$("btnFinLogin").addEventListener("click", login);
$("btnFinRefresh").addEventListener("click", refreshAll);
$("btnTxAdd").addEventListener("click", addTx);

$("finRange").addEventListener("change", () => {
  updateRangeUI();
  refreshAll();
});
$("finDate").addEventListener("change", refreshAll);
$("finMonth").addEventListener("change", refreshAll);
