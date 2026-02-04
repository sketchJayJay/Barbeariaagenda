function qs(id){ return document.getElementById(id); }
const elPass = qs("pass");
const elDate = qs("date");
const elTbl = qs("tbl").querySelector("tbody");
const elMsg = qs("msg");
const btnLoad = qs("btnLoad");
const btnCsv = qs("btnCsv");

function setMsg(t){ elMsg.textContent = t || ""; }

async function api(path, opts = {}) {
  const pass = elPass.value || "";
  const res = await fetch(path, { 
    headers: { 
      "content-type": "application/json",
      "x-admin-password": pass
    }, 
    ...opts 
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "erro");
  return data;
}

function rowToCsv(r){
  const vals = [r.date, r.start_time, r.end_time, r.service_name, r.client_name, r.client_whatsapp || "", r.status, r.code];
  return vals.map(v => `"${String(v).replaceAll('"','""')}"`).join(",");
}

function downloadCsv(rows){
  const head = '"Data","Início","Fim","Serviço","Cliente","WhatsApp","Status","Código"';
  const body = rows.map(rowToCsv).join("\n");
  const blob = new Blob([head + "\n" + body], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "agendamentos.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function render(rows){
  elTbl.innerHTML = "";
  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.start_time}</td>
      <td>${r.end_time}</td>
      <td>${r.service_name}</td>
      <td>${r.client_name}</td>
      <td>${r.client_whatsapp || ""}</td>
      <td>${r.status}</td>
      <td>${r.code}</td>
      <td>${r.status === "confirmed" ? `<button class="cancel">Cancelar</button>` : ""}</td>
    `;
    const btn = tr.querySelector("button.cancel");
    if (btn){
      btn.onclick = async () => {
        if (!confirm("Cancelar este agendamento?")) return;
        btn.disabled = true;
        try{
          await api("/api/admin/cancel", { method:"POST", body: JSON.stringify({ id: r.id })});
          setMsg("Cancelado.");
          btnLoad.click();
        }catch(e){
          setMsg(e.message);
        }finally{
          btn.disabled = false;
        }
      };
    }
    elTbl.appendChild(tr);
  });
}

btnLoad.onclick = async () => {
  setMsg("Carregando...");
  try{
    const date = elDate.value;
    const url = date ? `/api/admin/bookings?date=${encodeURIComponent(date)}` : "/api/admin/bookings";
    const r = await api(url);
    window.__rows = r.rows || [];
    render(window.__rows);
    setMsg(`OK. ${window.__rows.length} registros.`);
  }catch(e){
    setMsg(e.message);
  }
};

btnCsv.onclick = () => {
  const rows = window.__rows || [];
  if (!rows.length) return setMsg("Nada para exportar.");
  downloadCsv(rows);
};

(function init(){
  setMsg("Digite a senha e clique em Carregar.");
})();
