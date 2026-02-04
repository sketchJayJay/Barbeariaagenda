// Barbearia Suprema - Front (Agendamentos)

const $ = (id) => document.getElementById(id);

let CONFIG = null;
let SERVICES = [];

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }
function normalizePhoneBR(input) {
  let digits = onlyDigits(input);
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits;
}

function showMsg(text, type = 'info', html = false) {
  const el = $('msg');
  el.style.display = 'block';
  el.className = 'note ' + type;
  if (html) el.innerHTML = text;
  else el.textContent = text;
}

function renderTicket({ booking, ticket_text, whatsapp_url }) {
  const safe = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const wa = whatsapp_url || `https://wa.me/${normalizePhoneBR(booking.phone)}?text=${encodeURIComponent(ticket_text || '')}`;

  const html = `
    <div class="ticket">
      <div class="ticket__title">✅ Agendamento confirmado</div>
      <div class="ticket__row"><b>Ticket:</b> <span class="mono">${safe(booking.ticket_code || '')}</span></div>
      <div class="ticket__row"><b>Nome:</b> ${safe(booking.name)}</div>
      <div class="ticket__row"><b>Telefone:</b> ${safe(booking.phone)}</div>
      <div class="ticket__row"><b>Serviço:</b> ${safe(booking.service_label)}</div>
      <div class="ticket__row"><b>Data:</b> ${safe(booking.date)} <b style="margin-left:10px">Horário:</b> ${safe(booking.time)}</div>
      <div class="ticket__row"><b>Duração:</b> ${safe(booking.duration_min)} min <b style="margin-left:10px">Valor:</b> R$ ${safe(booking.price)}</div>

      <div class="ticket__actions">
        <a class="btn btn-whatsapp" target="_blank" rel="noopener" href="${wa}">
          <span class="wa">🟢</span> Enviar ticket no WhatsApp
        </a>
        <button class="btn btn-copy" type="button" id="copyTicket">Copiar ticket</button>
      </div>

      <div class="ticket__hint">Guarde este ticket. Se precisar alterar/cancelar, chame no WhatsApp.</div>

      <details style="margin-top:10px">
        <summary>Ver mensagem completa</summary>
        <pre class="ticket__pre">${safe(ticket_text || '')}</pre>
      </details>
    </div>
  `;

  showMsg(html, 'ok', true);

  const btn = $('copyTicket');
  btn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(ticket_text || '');
      btn.textContent = 'Copiado ✅';
      setTimeout(() => (btn.textContent = 'Copiar ticket'), 1500);
    } catch {
      alert('Não consegui copiar automaticamente. Segure e copie a mensagem no bloco "Ver mensagem completa".');
    }
  });

  // Tenta abrir automaticamente (pode ser bloqueado por pop-up)
  try { window.open(wa, '_blank'); } catch {}
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    const err = (data && (data.error || data.message)) || `Erro ${r.status}`;
    throw new Error(err);
  }
  return data;
}

function money(n) {
  return `R$ ${Number(n || 0).toFixed(0)}`;
}

async function loadConfig() {
  CONFIG = await api('/api/config');

  $('shopName').textContent = CONFIG.barbershopName || 'Barbearia';
  $('kpiOpen').textContent = CONFIG.open;
  $('kpiClose').textContent = CONFIG.close;
  $('shopHours').textContent = `${CONFIG.open} às ${CONFIG.close}`;

  // WhatsApp topo
  const phone = String(CONFIG.whatsappBarbershop || '').replace(/\D/g,'') || '55998195165';
  const text = encodeURIComponent('Olá! Quero um serviço que não está na lista. Pode me ajudar?');
  $('whatsPill').href = `https://wa.me/${phone}?text=${text}`;
}

async function loadServices() {
  const data = await api('/api/services');
  SERVICES = data.services || [];
  const sel = $('service');
  sel.innerHTML = '';
  SERVICES.forEach((s) => {
    const o = document.createElement('option');
    o.value = s.key;
    o.textContent = s.label;
    sel.appendChild(o);
  });
}

async function loadSlots() {
  const date = $('date').value;
  const service_key = $('service').value;

  $('time').innerHTML = '';
  const o0 = document.createElement('option');
  o0.value = '';
  o0.textContent = 'Selecione...';
  $('time').appendChild(o0);

  if (!date || !service_key) return;

  try {
    const data = await api(`/api/slots?date=${encodeURIComponent(date)}&service_key=${encodeURIComponent(service_key)}`);
    const slots = data.slots || [];
    slots.forEach((t) => {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      $('time').appendChild(o);
    });

    if (slots.length === 0) showMsg('Sem horários disponíveis para esta data/serviço.', 'warn');
    else showMsg('Selecione um horário disponível e confirme.', 'info');
  } catch (e) {
    showMsg(`Erro ao carregar horários: ${e.message}`, 'err');
  }
}

function updateServiceInfo() {
  const key = $('service').value;
  const svc = SERVICES.find(s => s.key === key);
  if (!svc) return;
  $('meta').textContent = `${svc.duration_min} min • ${money(svc.price)}`;
}

async function main() {
  await loadConfig();
  await loadServices();

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  $('date').value = `${yyyy}-${mm}-${dd}`;

  $('service').addEventListener('change', () => {
    updateServiceInfo();
    loadSlots();
  });
  $('date').addEventListener('change', loadSlots);

  updateServiceInfo();
  await loadSlots();

  $('bookingForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const payload = {
      name: $('name').value.trim(),
      phone: $('phone').value.trim(),
      date: $('date').value,
      service_key: $('service').value,
      time: $('time').value,
    };

    if (!payload.name || !payload.phone || !payload.date || !payload.service_key || !payload.time) {
      showMsg('Preencha nome, WhatsApp, data, serviço e horário.', 'warn');
      return;
    }

    $('submitBtn').disabled = true;
    showMsg('Confirmando...', 'info');

    try {
      const data = await api('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      renderTicket(data);

      // Tenta abrir o WhatsApp já com a mensagem pronta (alguns navegadores podem bloquear pop-up)
      if (data && data.whatsapp_url) {
        try { window.open(data.whatsapp_url, '_blank'); } catch (_) {}
      }

      // Recarrega slots para sumir o horário já agendado
      await loadSlots();

      $('time').value = '';
    } catch (e) {
      if (e.message === 'slot_unavailable') {
        showMsg('Esse horário acabou de ser ocupado. Escolha outro horário.', 'warn');
        await loadSlots();
      } else if (e.message === 'outside_hours') {
        showMsg('Horário fora do funcionamento. Escolha outro.', 'warn');
      } else {
        showMsg(`Erro: ${e.message}`, 'err');
      }
    } finally {
      $('submitBtn').disabled = false;
    }
  });
}

main().catch((e) => {
  console.error(e);
  showMsg('Erro ao iniciar o site.', 'err');
});
