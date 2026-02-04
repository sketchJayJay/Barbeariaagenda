(() => {
  const $ = (id) => document.getElementById(id);
  const loginCard = $("loginCard");
  const app = $("app");
  const pass = $("pass");
  const loginBtn = $("loginBtn");
  const loginMsg = $("loginMsg");

  const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
  const normalizePhoneBR = (input) => {
    let d = onlyDigits(input);
    if (d.length === 10 || d.length === 11) d = '55' + d;
    return d;
  };


  const bDate = $("bDate");
  const refreshBookings = $("refreshBookings");
  const bookingsList = $("bookingsList");
  const bookKpis = $("bookKpis");

  const fKind = $("fKind");
  const fAmount = $("fAmount");
  const fNote = $("fNote");
  const fDate = $("fDate");
  const addMove = $("addMove");
  const refreshFinance = $("refreshFinance");
  const movesList = $("movesList");
  const finKpis = $("finKpis");
  const range = $("range");
  const rangeDate = $("rangeDate");

  const cfgLine = $("cfgLine");

  function digitsOnly(s){ return (s||"").replace(/\D+/g,""); }
  function fmtTimeLabelFromMin(m){
    const hh = String(Math.floor(m/60)).padStart(2,"0");
    const mm = String(m%60).padStart(2,"0");
    return `${hh}:${mm}`;
  }
  function escapeHtml(s){
    return String(s||"").replace(/[&<>\"']/g, (c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
  }
  function money(v){ return `R$ ${v}`; }

  async function api(path, opts){
    const res = await fetch(path, opts);
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "Erro");
    return data;
  }

  async function loadConfig(){
    const cfg = await api("/api/config");
    cfgLine.textContent = `${cfg.shopName} • ${cfg.open} às ${cfg.close} • WhatsApp: ${cfg.whatsappBarbershop}`;
  }

  async function login(){
    loginMsg.textContent = "";
    try{
      await api("/api/admin/login", {
        method:"POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ password: pass.value })
      });
      loginCard.classList.add("hidden");
      app.classList.remove("hidden");
      await initApp();
    }catch(e){
      loginMsg.textContent = e.message;
    }
  }

  loginBtn.addEventListener("click", login);
  pass.addEventListener("keydown", (e)=>{ if(e.key==="Enter") login(); });

  function setTodayInputs(){
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    const iso = `${yyyy}-${mm}-${dd}`;
    bDate.value = iso;
    fDate.value = iso;
    rangeDate.value = iso;
  }

  async function loadBookings(){
    bookingsList.innerHTML = "Carregando...";
    bookKpis.innerHTML = "";
    const date = bDate.value;
    try{
      const data = await api(`/api/admin/bookings?date=${encodeURIComponent(date)}`);
      const list = data.bookings || [];
      const total = list.reduce((acc, b)=> acc + (b.price||0), 0);
      bookKpis.innerHTML = `
        <div class="kpi"><strong>${list.length}</strong><span>Agendamentos</span></div>
        <div class="kpi"><strong>${money(total)}</strong><span>Valor total (dia)</span></div>
      `;

      if(list.length === 0){
        bookingsList.innerHTML = `<div class="muted">Sem agendamentos para ${date}.</div>`;
        return;
      }

      bookingsList.innerHTML = "";
      for(const b of list){
        const wa = `${data.whatsapp_link_prefix}${normalizePhoneBR(b.phone)}?text=${encodeURIComponent(
          `Olá ${b.name}! ✅\n` +
          `Seu horário foi confirmado na Barbearia.\n` +
          `Data: ${b.date}\n` +
          `Horário: ${b.time_label}\n` +
          `Serviço: ${b.service_label}\n` +
          `Valor: R$ ${b.price}\n\n` +
          `Qualquer dúvida, chama a gente aqui.`
        );

        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `
          <div>
            <strong>${escapeHtml(b.time_label)} • ${escapeHtml(b.service_label)}</strong>
            <small>${escapeHtml(b.name)} • ${escapeHtml(b.phone)} • ${money(b.price)}</small>
          </div>
          <div class="actions">
            <a class="pill" target="_blank" rel="noopener" href="${wa}">
              <span aria-hidden="true" style="font-size:16px;line-height:1">📲</span>
              WhatsApp cliente
            </a>
            <button class="btn danger" data-cancel="${b.id}">Cancelar</button>
          </div>
        `;
        bookingsList.appendChild(item);
      }

      bookingsList.querySelectorAll("button[data-cancel]").forEach(btn=>{
        btn.addEventListener("click", async ()=>{
          const id = btn.getAttribute("data-cancel");
          if(!confirm("Cancelar este agendamento?")) return;
          try{
            await api("/api/admin/cancel", {
              method:"POST",
              headers: {"Content-Type":"application/json"},
              body: JSON.stringify({ id: Number(id) })
            });
            await loadBookings();
          }catch(e){ alert(e.message); }
        });
      });

    }catch(e){
      bookingsList.innerHTML = `<div class="muted">Erro: ${escapeHtml(e.message)}</div>`;
    }
  }

  function isoRange(base, which){
    const d = new Date(base + "T00:00:00");
    if(which === "week"){
      // start monday
      const day = (d.getDay()+6)%7; // 0 monday
      const start = new Date(d); start.setDate(d.getDate()-day);
      const end = new Date(start); end.setDate(start.getDate()+7);
      return { start, end };
    }
    // month
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth()+1, 1);
    return { start, end };
  }

  function toISODate(d){
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,"0");
    const dd = String(d.getDate()).padStart(2,"0");
    return `${yyyy}-${mm}-${dd}`;
  }

  async function loadFinance(){
    movesList.innerHTML = "Carregando...";
    finKpis.innerHTML = "";
    try{
      const { start, end } = isoRange(rangeDate.value, range.value);
      const data = await api(`/api/admin/finance?from=${encodeURIComponent(toISODate(start))}&to=${encodeURIComponent(toISODate(end))}`);
      const moves = data.moves || [];

      finKpis.innerHTML = `
        <div class="kpi"><strong>${money(data.bookings_total)}</strong><span>Entradas (agendamentos)</span></div>
        <div class="kpi"><strong>${money(data.in_total)}</strong><span>Outras entradas</span></div>
        <div class="kpi"><strong>${money(data.out_total)}</strong><span>Saídas</span></div>
        <div class="kpi"><strong>${money(data.net_total)}</strong><span>Saldo (período)</span></div>
      `;

      if(moves.length === 0){
        movesList.innerHTML = `<div class="muted">Sem movimentações no período.</div>`;
        return;
      }

      movesList.innerHTML = "";
      for(const m of moves){
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `
          <div>
            <strong>${m.kind === "in" ? "Entrada" : "Saída"} • ${money(m.amount)}</strong>
            <small>${escapeHtml(m.date)} • ${escapeHtml(m.note || "")}</small>
          </div>
        `;
        movesList.appendChild(item);
      }
    }catch(e){
      movesList.innerHTML = `<div class="muted">Erro: ${escapeHtml(e.message)}</div>`;
    }
  }

  addMove.addEventListener("click", async ()=>{
    const payload = {
      kind: fKind.value,
      amount: Number(fAmount.value),
      note: fNote.value || "",
      date: fDate.value
    };
    if(!payload.amount || payload.amount < 0){
      alert("Informe o valor.");
      return;
    }
    try{
      await api("/api/admin/finance/add", {
        method:"POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify(payload)
      });
      fAmount.value = "";
      fNote.value = "";
      await loadFinance();
    }catch(e){
      alert(e.message);
    }
  });

  refreshBookings.addEventListener("click", loadBookings);
  refreshFinance.addEventListener("click", loadFinance);
  range.addEventListener("change", loadFinance);
  rangeDate.addEventListener("change", loadFinance);
  bDate.addEventListener("change", loadBookings);

  function setupTabs(){
    document.querySelectorAll(".tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        const t = btn.getAttribute("data-tab");
        $("tab-bookings").style.display = t==="bookings" ? "" : "none";
        $("tab-finance").style.display = t==="finance" ? "" : "none";
        if(t==="bookings") loadBookings();
        if(t==="finance") loadFinance();
      });
    });
  }

  async function initApp(){
    setupTabs();
    setTodayInputs();
    await loadConfig();
    await loadBookings();
    await loadFinance();
  }

  // auto-check if already logged
  (async ()=>{
    try{
      await api("/api/admin/me");
      loginCard.classList.add("hidden");
      app.classList.remove("hidden");
      await initApp();
    }catch(_){
      // stay on login
    }
  })();
})();
