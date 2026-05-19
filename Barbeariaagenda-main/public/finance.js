const $ = (id) => document.getElementById(id);

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function currentMonth() {
  return todayISO().slice(0, 7);
}

function brl(n) {
  const v = Number(n || 0);
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function txMsg(t) {
  const box = $("txMsg");
  if (box) box.textContent = t || "";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

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
  monthWrap.classList.toggle("hidden", r !== "month");
}

function rangeLabel(data) {
  if (!data || !data.range) return "";
  if (data.range === "day") return `Dia: ${data.from}`;
  if (data.range === "week") return `Semana: ${data.from} a ${data.to}`;
  if (data.range === "month") return `Mês: ${String(data.from).slice(0, 7)} (${data.from} a ${data.to})`;
  return `Período: ${data.from} a ${data.to}`;
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, { credentials: "include", ...opts });
  if (res.status === 401) {
    location.href = "/finance/login";
    throw new Error("Sessão expirada");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || "Erro");
  return data;
}

async function refreshAll() {
  await Promise.all([loadSummary(), loadTx()]);
}

async function loadSummary() {
  const data = await fetchJSON(`/api/finance/summary?${periodQuery()}`);
  $("kpiIn").textContent = brl(data.total_in);
  $("kpiOut").textContent = brl(data.total_out);
  $("kpiNet").textContent = brl(data.net);
  const pl = $("periodLabel");
  if (pl) pl.textContent = rangeLabel(data);
}

function renderTxTable(rows, range) {
  if (!rows.length) {
    if (range === "day") return "<div class='muted' style='padding:12px'>Nenhum movimento neste dia.</div>";
    if (range === "week") return "<div class='muted' style='padding:12px'>Nenhum movimento nesta semana.</div>";
    return "<div class='muted' style='padding:12px'>Nenhum movimento neste mês.</div>";
  }

  const hasDateCol = range !== "day";
  return `
    <table>
      <thead>
        <tr>
          ${hasDateCol ? "<th>Data</th>" : ""}
          <th>Hora</th><th>Tipo</th><th>Valor</th><th>Método</th><th>Categoria</th><th>Descrição</th><th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => {
          const dt = new Date(r.created_at);
          const hh = String(dt.getHours()).padStart(2, "0");
          const mm = String(dt.getMinutes()).padStart(2, "0");
          const typeLabel = r.type === "in" ? "Entrada" : "Saída";
          const pill = r.type === "in" ? "ok" : "bad";
          return `<tr>
            ${hasDateCol ? `<td>${escapeHtml(r.date)}</td>` : ""}
            <td>${hh}:${mm}</td>
            <td><span class="pill ${pill}">${typeLabel}</span></td>
            <td><b>${brl(Number(r.amount))}</b></td>
            <td>${escapeHtml(r.method || "")}</td>
            <td>${escapeHtml(r.category || "")}</td>
            <td>${escapeHtml(r.description || "")}</td>
            <td><button class="ghost small" data-del="${Number(r.id)}">Excluir</button></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

async function loadTx() {
  const range = getRange();
  const data = await fetchJSON(`/api/finance/tx?${periodQuery()}`);
  const rows = data.rows || [];
  $("txTable").innerHTML = renderTxTable(rows, range);
  $("txTable").querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", () => delTx(btn.getAttribute("data-del")));
  });
}

async function addTx() {
  const date = $("finDate").value || todayISO();
  const payload = {
    date,
    type: $("txType").value,
    amount: Number($("txAmount").value),
    method: $("txMethod").value,
    category: $("txCategory").value.trim(),
    description: $("txDesc").value.trim(),
  };

  if (!payload.amount || payload.amount <= 0) return txMsg("Informe um valor válido.");

  txMsg("Salvando...");
  await fetchJSON("/api/finance/tx", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  $("txAmount").value = "";
  $("txDesc").value = "";
  txMsg("Salvo ✅");
  await refreshAll();
}

async function delTx(id) {
  if (!confirm("Excluir este movimento?")) return;
  await fetchJSON(`/api/finance/tx/${id}`, { method: "DELETE" });
  txMsg("Excluído ✅");
  await refreshAll();
}

async function init() {
  $("finRange").value = "day";
  $("finDate").value = todayISO();
  $("finMonth").value = currentMonth();
  updateRangeUI();

  $("btnFinRefresh").addEventListener("click", refreshAll);
  $("btnTxAdd").addEventListener("click", () => addTx().catch(e => txMsg(e.message)));
  $("finRange").addEventListener("change", () => { updateRangeUI(); refreshAll().catch(e => txMsg(e.message)); });
  $("finDate").addEventListener("change", () => refreshAll().catch(e => txMsg(e.message)));
  $("finMonth").addEventListener("change", () => refreshAll().catch(e => txMsg(e.message)));

  try {
    await refreshAll();
  } catch (e) {
    txMsg(e.message || "Erro ao carregar financeiro.");
  }
}

init();
