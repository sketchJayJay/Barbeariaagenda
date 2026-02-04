const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '256kb' }));

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- Config --------------------
const BARBERSHOP_NAME = process.env.BARBERSHOP_NAME || 'Barbearia Suprema';
const WHATSAPP_BARBERSHOP = (process.env.WHATSAPP_BARBERSHOP || '55998195165').replace(/\D/g, '');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123'; // troque no Coolify!

const TIME_OPEN = process.env.TIME_OPEN || '08:00';
const TIME_CLOSE = process.env.TIME_CLOSE || '20:00';
const SLOT_INTERVAL_MIN = Number(process.env.SLOT_INTERVAL_MIN || 10);

function hhmmToMin(hhmm) {
  const [h, m] = String(hhmm).split(':').map(n => Number(n));
  return (h * 60) + (m || 0);
}
function minToHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, '0');
  const m = String(min % 60).padStart(2, '0');
  return `${h}:${m}`;
}
const OPEN_MIN = hhmmToMin(TIME_OPEN);
const CLOSE_MIN = hhmmToMin(TIME_CLOSE);

// Services (você pode editar depois)
const SERVICES = [
  { key: 'corte_sobrancelha', name: 'Corte + Sobrancelha', duration_min: 40, price: 40 },
  { key: 'corte', name: 'Corte', duration_min: 40, price: 35 },
  { key: 'corte_barba', name: 'Corte + Barba', duration_min: 50, price: 50 },
  { key: 'corte_pigmentacao', name: 'Corte + Pigmentação', duration_min: 60, price: 50 },
  { key: 'barba', name: 'Barba', duration_min: 20, price: 20 },
  { key: 'corte_barba_pigmentacao', name: 'Corte + Barba + Pigmentação', duration_min: 60, price: 60 },
];

function serviceLabel(s) {
  return `${s.name} (${s.duration_min} min) • R$ ${s.price}`;
}

function normalizePhoneBR(input) {
  let digits = String(input || '').replace(/\D/g, '');
  // Se usuário digitou DDD+numero (ex 32998123456), adiciona 55
  if (digits.length === 10 || digits.length === 11) digits = '55' + digits;
  return digits;
}

function formatTicketText(b) {
  return [
    `✅ Agendamento confirmado - ${BARBERSHOP_NAME}`,
    ``,
    `🎟️ Ticket: ${b.ticket_code}`,
    `👤 Nome: ${b.name}`,
    `💈 Serviço: ${b.service_label}`,
    `📅 Data: ${b.date}`,
    `🕒 Horário: ${b.time}`,
    `⏱️ Duração: ${b.duration_min} min`,
    `💰 Valor: R$ ${b.price}`,
    ``,
    `Guarde este ticket. Se precisar alterar/cancelar, fale conosco.`,
  ].join('\n');
}

function whatsappLink(phoneDigits, text) {
  const p = normalizePhoneBR(phoneDigits);
  const t = encodeURIComponent(text);
  return `https://wa.me/${p}?text=${t}`;
}

// -------------------- Database --------------------
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('FALTOU DATABASE_URL (configure no Coolify > Environment Variables)');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Para Postgres interno do Coolify normalmente NÃO precisa SSL.
  // Se você usar um Postgres externo com SSL, ajuste a URL (sslmode=require) ou configure PGSSLMODE.
});

async function ensureSchema() {
  // bookings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      service_key TEXT NOT NULL,
      service_label TEXT NOT NULL,
      duration_min INT NOT NULL,
      price INT NOT NULL,
      date TEXT NOT NULL,
      start_min INT NOT NULL,
      end_min INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      ticket_code TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);`);

  // migrations (se uma tabela antiga existir com colunas diferentes)
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='bookings'
  `);
  const colset = new Set(cols.rows.map(r => r.column_name));
  if (!colset.has('start_min')) {
    // tenta migrar de start_time (HH:MM) se existir
    if (colset.has('start_time')) {
      await pool.query(`ALTER TABLE bookings ADD COLUMN start_min INT;`);
      await pool.query(`UPDATE bookings SET start_min = (split_part(start_time, ':', 1)::int*60 + split_part(start_time, ':', 2)::int) WHERE start_min IS NULL;`);
    } else {
      await pool.query(`ALTER TABLE bookings ADD COLUMN start_min INT DEFAULT 0;`);
    }
    await pool.query(`ALTER TABLE bookings ALTER COLUMN start_min SET NOT NULL;`);
  }
  if (!colset.has('end_min')) {
    if (colset.has('end_time')) {
      await pool.query(`ALTER TABLE bookings ADD COLUMN end_min INT;`);
      await pool.query(`UPDATE bookings SET end_min = (split_part(end_time, ':', 1)::int*60 + split_part(end_time, ':', 2)::int) WHERE end_min IS NULL;`);
    } else {
      await pool.query(`ALTER TABLE bookings ADD COLUMN end_min INT DEFAULT 0;`);
    }
    await pool.query(`ALTER TABLE bookings ALTER COLUMN end_min SET NOT NULL;`);
  }
  if (!colset.has('ticket_code')) {
    await pool.query(`ALTER TABLE bookings ADD COLUMN ticket_code TEXT;`);
    await pool.query(`UPDATE bookings SET ticket_code = 'BS-' || id || '-' || replace(date,'-','') WHERE ticket_code IS NULL;`);
    await pool.query(`ALTER TABLE bookings ALTER COLUMN ticket_code SET NOT NULL;`);
  }

  // finance_moves
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_moves (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('in','out')),
      amount NUMERIC(10,2) NOT NULL,
      note TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_finance_date ON finance_moves(date);`);
}

ensureSchema()
  .then(() => console.log('DB schema ok'))
  .catch((e) => {
    console.error('DB schema fail:', e);
    process.exit(1);
  });

// -------------------- Public API --------------------
app.get('/api/health', async (req, res) => {
  try {
    const r = await pool.query('select 1 as ok');
    res.json({ ok: true, db: r.rows?.[0]?.ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'db_error' });
  }
});

app.get('/api/config', (req, res) => {
  res.json({
    open: TIME_OPEN,
    close: TIME_CLOSE,
    interval: SLOT_INTERVAL_MIN,
    barbershopName: BARBERSHOP_NAME,
    whatsappBarbershop: WHATSAPP_BARBERSHOP,
  });
});

app.get('/api/services', (req, res) => {
  res.json({
    services: SERVICES.map(s => ({
      key: s.key,
      name: s.name,
      duration_min: s.duration_min,
      price: s.price,
      label: serviceLabel(s),
    })),
  });
});

app.get('/api/slots', async (req, res) => {
  const date = String(req.query.date || '').trim();
  const service_key = String(req.query.service_key || '').trim();

  const svc = SERVICES.find(s => s.key === service_key);
  if (!date || !svc) return res.status(400).json({ error: 'bad_request' });

  try {
    const { rows } = await pool.query(
      `SELECT start_min, end_min FROM bookings WHERE date=$1 AND status='active'`,
      [date]
    );

    const taken = rows.map(r => ({ start: Number(r.start_min), end: Number(r.end_min) }));
    const slots = [];

    for (let start = OPEN_MIN; start + svc.duration_min <= CLOSE_MIN; start += SLOT_INTERVAL_MIN) {
      const end = start + svc.duration_min;
      const clash = taken.some(b => start < b.end && end > b.start);
      if (!clash) slots.push(minToHHMM(start));
    }

    res.json({ slots });
  } catch (e) {
    console.error('slots error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/bookings', async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const phone = String(req.body?.phone || '').trim();
  const date = String(req.body?.date || '').trim();
  const service_key = String(req.body?.service_key || '').trim();
  const time = String(req.body?.time || '').trim();

  const svc = SERVICES.find(s => s.key === service_key);
  if (!name || !phone || !date || !svc || !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  const start_min = hhmmToMin(time);
  const end_min = start_min + svc.duration_min;

  if (start_min < OPEN_MIN || end_min > CLOSE_MIN) {
    return res.status(400).json({ error: 'outside_hours' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const conflict = await client.query(
      `SELECT id FROM bookings
       WHERE date=$1 AND status='active'
         AND ($2 < end_min AND $3 > start_min)
       LIMIT 1`,
      [date, start_min, end_min]
    );

    if (conflict.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'slot_unavailable' });
    }

    // cria ticket_code previsível
    const ticket_code = `BS-${Date.now().toString(36).toUpperCase()}-${date.replace(/-/g, '')}`;

    const insert = await client.query(
      `INSERT INTO bookings
        (name, phone, service_key, service_label, duration_min, price, date, start_min, end_min, status, ticket_code)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)
       RETURNING id, created_at`,
      [name, phone, service_key, serviceLabel(svc), svc.duration_min, svc.price, date, start_min, end_min, ticket_code]
    );

    await client.query('COMMIT');

    const booking = {
      id: insert.rows[0].id,
      created_at: insert.rows[0].created_at,
      name,
      phone,
      date,
      time,
      service_key,
      service_label: serviceLabel(svc),
      duration_min: svc.duration_min,
      price: svc.price,
      ticket_code,
    };

    const ticket_text = formatTicketText(booking);
    const whatsapp_url = whatsappLink(phone, ticket_text);

    res.json({ ok: true, booking, ticket_text, whatsapp_url });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('create booking error:', e);
    res.status(500).json({ error: 'db_error' });
  } finally {
    client.release();
  }
});

// -------------------- Admin Auth (simple) --------------------
const adminTokens = new Map(); // token -> expiresAt (ms)

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || '');
  const t = cookies.admin_token;
  if (!t) return res.status(401).json({ error: 'unauthorized' });
  const exp = adminTokens.get(t);
  if (!exp || Date.now() > exp) {
    adminTokens.delete(t);
    return res.status(401).json({ error: 'unauthorized' });
  }
  return next();
}

app.post('/api/admin/login', (req, res) => {
  const password = String(req.body?.password || '');
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'bad_password' });

  const token = crypto.randomUUID();
  adminTokens.set(token, Date.now() + (24 * 60 * 60 * 1000)); // 24h

  // secure se estiver em https
  const secure = (req.headers['x-forwarded-proto'] || '').includes('https');
  res.setHeader('Set-Cookie',
    `admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${24 * 60 * 60}${secure ? '; Secure' : ''}`
  );
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies.admin_token) adminTokens.delete(cookies.admin_token);
  res.setHeader('Set-Cookie', 'admin_token=; Path=/; Max-Age=0; SameSite=Lax');
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ ok: true, barbershopName: BARBERSHOP_NAME });
});

// -------------------- Admin Bookings --------------------
app.get('/api/admin/bookings', requireAdmin, async (req, res) => {
  const date = String(req.query.date || '').trim();
  if (!date) return res.status(400).json({ error: 'bad_request' });

  try {
    const { rows } = await pool.query(
      `SELECT id, name, phone, service_label, duration_min, price, date, start_min, end_min, status, ticket_code, created_at
       FROM bookings
       WHERE date=$1
       ORDER BY start_min ASC`,
      [date]
    );

    const bookings = rows.map(r => ({
      id: r.id,
      name: r.name,
      phone: r.phone,
      service_label: r.service_label,
      duration_min: r.duration_min,
      price: Number(r.price),
      date: r.date,
      time_label: minToHHMM(Number(r.start_min)),
      end_label: minToHHMM(Number(r.end_min)),
      status: r.status,
      ticket_code: r.ticket_code,
      created_at: r.created_at,
    }));

    res.json({
      bookings,
      whatsapp_link_prefix: 'https://wa.me/', // admin.js vai montar com telefone
      barbershop_whatsapp: WHATSAPP_BARBERSHOP,
      barbershop_name: BARBERSHOP_NAME,
    });
  } catch (e) {
    console.error('admin bookings error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});


// compat: endpoint antigo usado pelo admin.js
app.post('/api/admin/cancel', requireAdmin, async (req, res) => {
  const id = Number(req.body?.id);
  if (!id) return res.status(400).json({ error: 'bad_request' });

  try {
    await pool.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('cancel booking error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/bookings/cancel', requireAdmin, async (req, res) => {
  const id = Number(req.body?.id);
  if (!id) return res.status(400).json({ error: 'bad_request' });

  try {
    await pool.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('cancel booking error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// -------------------- Admin Finance --------------------
function parseDateISO(s) {
  // s: YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return null;
  return String(s);
}

app.get('/api/admin/finance', requireAdmin, async (req, res) => {
  const from = parseDateISO(req.query.from);
  const to = parseDateISO(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'bad_request' });

  try {
    const movesQ = await pool.query(
      `SELECT id, kind, amount, note, date, created_at
       FROM finance_moves
       WHERE date >= $1 AND date <= $2
       ORDER BY date DESC, id DESC`,
      [from, to]
    );

    const bookingsQ = await pool.query(
      `SELECT COALESCE(SUM(price),0) as total
       FROM bookings
       WHERE status='active' AND date >= $1 AND date <= $2`,
      [from, to]
    );

    const moves = movesQ.rows.map(r => ({
      id: r.id,
      kind: r.kind,
      amount: Number(r.amount),
      note: r.note,
      date: r.date,
      created_at: r.created_at,
    }));

    const in_total = moves.filter(m => m.kind === 'in').reduce((a, m) => a + m.amount, 0);
    const out_total = moves.filter(m => m.kind === 'out').reduce((a, m) => a + m.amount, 0);
    const bookings_total = Number(bookingsQ.rows[0].total || 0);
    const net_total = (bookings_total + in_total) - out_total;

    res.json({
      from, to,
      bookings_total,
      in_total,
      out_total,
      net_total,
      moves,
    });
  } catch (e) {
    console.error('finance error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/finance/add', requireAdmin, async (req, res) => {
  const kind = String(req.body?.kind || '');
  const amount = Number(req.body?.amount);
  const note = String(req.body?.note || '').trim();
  const date = String(req.body?.date || '').trim();

  if (!['in', 'out'].includes(kind) || !isFinite(amount) || amount <= 0 || !note || !parseDateISO(date)) {
    return res.status(400).json({ error: 'bad_request' });
  }

  try {
    await pool.query(
      `INSERT INTO finance_moves(kind, amount, note, date) VALUES($1,$2,$3,$4)`,
      [kind, amount.toFixed(2), note, date]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error('finance add error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});

app.post('/api/admin/finance/delete', requireAdmin, async (req, res) => {
  const id = Number(req.body?.id);
  if (!id) return res.status(400).json({ error: 'bad_request' });

  try {
    await pool.query(`DELETE FROM finance_moves WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('finance delete error:', e);
    res.status(500).json({ error: 'db_error' });
  }
});

// Fallback: serve index for unknown routes (SPA-ish)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------- Start --------------------
const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on ${PORT}`);
});
