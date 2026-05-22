function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

const el = (id) => document.getElementById(id);
function onlyDigits(v) { return String(v || "").replace(/\D/g, ""); }
function toWaNumber(raw) {
  const dig = onlyDigits(raw);
  if (dig.startsWith("55") && (dig.length === 12 || dig.length === 13)) return dig;
  if (dig.length === 10 || dig.length === 11) return "55" + dig;
  return dig;
}
function waLink(number, text) {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
function formatDateISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function toBRDate(iso) {
  if (!iso || !iso.includes("-")) return iso || "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function reais(v) {
  return "R$ " + Number(String(v).replace(",", ".") || 0).toFixed(2).replace(".", ",");
}

async function fetchJSON(url, opts = {}) {
  const r = await fetch(url, { credentials: "include", ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || "erro");
  return j;
}

async function loadBookings() {
  const date = el("admDate").value;
  const j = await fetchJSON(`/api/admin/bookings?date=${encodeURIComponent(date)}`);
  const rows = j.bookings || [];

  if (!rows.length) {
    el("admBookings").innerHTML = `<div class="muted" style="padding:12px">Nenhum agendamento para esta data.</div>`;
    return;
  }

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
      ${rows.map(b => {
        const st = b.status === "active" ? "neu" : (b.status === "done" ? "ok" : "bad");
        const statusLabel = b.status === "active" ? "Ativo" : (b.status === "done" ? "Feito" : "Cancelado");
        const msg = `✅ Agendamento confirmado (Barbearia Suprema)\nTicket: ${b.ticket || ""}\nCliente: ${b.name || ""}\nData: ${toBRDate(b.date)}\nHorário: ${b.start}\nServiço: ${b.service_label || ""}\nValor: R$ ${b.price_reais}\n\nGuarde seu ticket.`;
        const wa = waLink(toWaNumber(b.phone), msg);
        return `
        <tr>
          <td><b>${escapeHtml(b.start)}</b></td>
          <td>${escapeHtml(b.name)}<div class="muted2">${escapeHtml(b.phone)}</div></td>
          <td>${escapeHtml(b.service_label)}</td>
          <td><span class="pill">${escapeHtml(b.ticket)}</span></td>
          <td><span class="pill ${st}">${statusLabel}</span></td>
          <td><a class="ghost small" target="_blank" rel="noopener" href="${wa}">Whats</a></td>
          <td>
            <button class="ghost small" onclick="setStatus(${Number(b.id)},'done')">Feito</button>
            <button class="ghost small" onclick="setStatus(${Number(b.id)},'cancelled')">Cancelar</button>
            <button class="ghost small" onclick="setStatus(${Number(b.id)},'active')">Ativo</button>
          </td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
  el("admBookings").innerHTML = html;
}

window.setStatus = async (id, status) => {
  try {
    await fetchJSON(`/api/admin/bookings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
    await Promise.all([loadBookings(), loadFinance()]);
  } catch (e) {
    alert("Erro: " + e.message);
  }
};

function weekRange(today) {
  const d = new Date(today);
  const day = d.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return [start, end];
}
function monthRange(today) {
  const d = new Date(today);
  return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
}

async function loadFinance() {
  const start = el("finStart").value;
  const end = el("finEnd").value;

  const sum = await fetchJSON(`/api/admin/finance/summary?start=${start}&end=${end}`);
  el("sumIn").textContent = reais(sum.total_in_reais);
  el("sumOut").textContent = reais(sum.total_out_reais);
  el("sumNet").textContent = reais(sum.net_reais);

  const list = await fetchJSON(`/api/admin/finance?start=${start}&end=${end}`);
  const rows = list.items || [];

  if (!rows.length) {
    el("finList").innerHTML = `<div class="muted" style="padding:12px">Nenhum movimento no período.</div>`;
    return;
  }

  el("finList").innerHTML = `
  <table>
    <thead>
      <tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Valor</th><th>Ações</th></tr>
    </thead>
    <tbody>
      ${rows.map(it => {
        const pill = it.kind === "in" ? "ok" : "bad";
        const label = it.kind === "in" ? "Entrada" : "Saída";
        const desc = it.description || "";
        const isBookingEntry = Boolean(it.booking_id);
        const delTitle = isBookingEntry
          ? "Excluir este lançamento do financeiro. Use se o cliente não pagou."
          : "Excluir este lançamento manual.";
        return `<tr>
          <td>${toBRDate(it.date)}</td>
          <td><span class="pill ${pill}">${label}</span></td>
          <td>${escapeHtml(desc)}${isBookingEntry ? `<div class="muted2">Vinculado ao agendamento #${Number(it.booking_id)}</div>` : ""}</td>
          <td><b>${reais(it.amount_reais)}</b></td>
          <td><button class="ghost small" title="${escapeHtml(delTitle)}" onclick="deleteFinance(${Number(it.id)}, ${isBookingEntry ? 'true' : 'false'})">Excluir</button></td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>`;
}

window.deleteFinance = async (id, isBookingEntry = false) => {
  const msg = isBookingEntry
    ? "Excluir este lançamento do financeiro?\n\nUse esta opção quando o cliente não pagou. O agendamento continua salvo no histórico, mas o valor sai do financeiro."
    : "Excluir este lançamento do financeiro?";
  if (!confirm(msg)) return;

  try {
    await fetchJSON(`/api/admin/finance/${id}`, { method: "DELETE" });
    await loadFinance();
  } catch (e) {
    alert("Erro ao excluir lançamento: " + e.message);
  }
};

async function addFinance() {
  const kind = el("finKind").value;
  const amount = Number(el("finAmount").value);
  const date = el("finDate").value;
  const desc = el("finDesc").value;

  if (!amount || amount <= 0) return alert("Informe um valor válido.");
  if (!date) return alert("Informe a data.");

  try {
    await fetchJSON("/api/admin/finance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, amount_reais: amount, date, description: desc })
    });
    el("finAmount").value = "";
    el("finDesc").value = "";
    await loadFinance();
  } catch (e) {
    alert("Erro: " + e.message);
  }
}

async function loadCustomers() {
  try {
    const j = await fetchJSON("/api/admin/customers");
    const box = el("custList");
    if (!box) return;
    if (!j.customers || j.customers.length === 0) {
      box.innerHTML = '<div class="muted" style="padding:12px">Nenhum cliente cadastrado ainda.</div>';
      return;
    }
    box.innerHTML = `
      <table>
        <thead><tr><th>Nome</th><th>WhatsApp</th><th>Nascimento</th></tr></thead>
        <tbody>
          ${j.customers.map(c => `<tr>
            <td><b>${escapeHtml(c.name)}</b></td>
            <td>${escapeHtml(c.phone_e164)}</td>
            <td>${escapeHtml(c.birth_date || "")}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;
  } catch (e) {
    console.log("customers error", e);
  }
}

function copyCustomers() {
  const rows = Array.from(document.querySelectorAll("#custList tbody tr"));
  const lines = rows.map(r => {
    const cols = r.querySelectorAll("td");
    if (cols.length < 2) return "";
    return `${cols[0].innerText.replace(/\s+/g, " ").trim()}\t${cols[1].innerText.replace(/\s+/g, "").trim()}`;
  }).filter(Boolean);

  const txt = lines.join("\n");
  navigator.clipboard.writeText(txt).then(() => {
    const btn = el("btnCopyCustomers");
    if (btn) {
      const old = btn.textContent;
      btn.textContent = "Copiado!";
      setTimeout(() => btn.textContent = old, 1200);
    }
  }).catch(() => alert("Não foi possível copiar automaticamente."));
}

async function init() {
  const today = new Date();
  el("admDate").value = formatDateISO(today);

  const [ms, me] = monthRange(today);
  el("finStart").value = formatDateISO(ms);
  el("finEnd").value = formatDateISO(me);
  el("finDate").value = formatDateISO(today);

  el("btnReload").addEventListener("click", loadBookings);
  el("admDate").addEventListener("change", loadBookings);
  el("btnWeek").addEventListener("click", () => {
    const [s, e] = weekRange(new Date());
    el("finStart").value = formatDateISO(s);
    el("finEnd").value = formatDateISO(e);
    loadFinance();
  });
  el("btnMonth").addEventListener("click", () => {
    const [s, e] = monthRange(new Date());
    el("finStart").value = formatDateISO(s);
    el("finEnd").value = formatDateISO(e);
    loadFinance();
  });
  el("finStart").addEventListener("change", loadFinance);
  el("finEnd").addEventListener("change", loadFinance);
  el("btnAddFin").addEventListener("click", addFinance);

  const b1 = el("btnReloadCustomers");
  const b2 = el("btnCopyCustomers");
  if (b1) b1.addEventListener("click", loadCustomers);
  if (b2) b2.addEventListener("click", copyCustomers);

  try {
    await Promise.all([loadBookings(), loadFinance(), loadCustomers()]);
  } catch (e) {
    alert("Erro (login expirou?): " + e.message + "\nVolte e faça login de novo.");
    location.href = "/admin/login";
  }
}

init();
