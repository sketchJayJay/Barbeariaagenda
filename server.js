const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Config ----
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const OWNER_WHATSAPP = (process.env.OWNER_WHATSAPP || "32998195165").replace(/\D/g, "");
const TZ = process.env.TZ || "America/Sao_Paulo";

// Horário de funcionamento: 08:00 - 20:00
const OPEN_MIN = 8 * 60;
const CLOSE_MIN = 20 * 60;
const SLOT_STEP = 10; // minutos (passo de agenda)

// Serviços
const SERVICES = [
  { key: "corte_sobrancelha", label: "Corte + Sobrancelha", duration_min: 40, price_reais: 40 },
  { key: "corte", label: "Corte", duration_min: 40, price_reais: 35 },
  { key: "corte_barba", label: "Corte + Barba", duration_min: 50, price_reais: 50 },
  { key: "corte_pigmentacao", label: "Corte + Pigmentação", duration_min: 60, price_reais: 50 },
  { key: "barba", label: "Barba", duration_min: 20, price_reais: 20 },
  { key: "corte_barba_pigmentacao", label: "Corte + Barba + Pigmentação", duration_min: 60, price_reais: 60 },
];

// ---- DB ----
let pool = null;

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error("FALTOU DATABASE_URL");
    }
    // SSL opcional: se seu Postgres exigir, set PGSSL=true no Coolify.
    const useSSL = String(process.env.PGSSL || "").toLowerCase() === "true";
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

async function initDb() {
  const p = getPool();

  // Base tables (idempotent)
  await p.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      ticket TEXT,
      name TEXT,
      phone TEXT,
      service_key TEXT,
      service_label TEXT,
      duration_min INT,
      price_cents INT,
      date TEXT,
      start_min INT,
      end_min INT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS finance (
      id SERIAL PRIMARY KEY,
      kind TEXT NOT NULL,
      amount_cents INT NOT NULL,
      description TEXT NOT NULL,
      note TEXT,
      date TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Compat: se existir tabela antiga "finance_entries" e a nova estiver vazia,
  // migra os dados (label -> description).
  try {
    const hasOld = await p.query(`SELECT to_regclass('public.finance_entries') AS t;`);
    if (hasOld.rows?.[0]?.t) {
      const cntNew = await p.query(`SELECT COUNT(*)::int AS c FROM finance;`);
      if ((cntNew.rows?.[0]?.c || 0) === 0) {
        await p.query(`
          INSERT INTO finance (kind, amount_cents, description, note, date, created_at)
          SELECT kind, amount_cents, label, note, date, created_at
          FROM finance_entries
        `);
      }
    }
  } catch (_) {
    // silencioso
  }
// Columns migration (supports older schemas like start_time/start_ts etc.)
  const alters = [
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_code TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS name TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_key TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_label TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_min INT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price INT;
    ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_cents INT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS date TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_min INT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_min INT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT;`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;`,
  ];
  for (const q of alters) await p.query(q);

  await p.query(`
DO $$
BEGIN
  -- start_time/end_time stored as TEXT 'HH:MM'
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='start_time') THEN
    UPDATE bookings
      SET start_min = (split_part(start_time, ':', 1)::int * 60 + split_part(start_time, ':', 2)::int)
    WHERE start_min IS NULL AND start_time IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='end_time') THEN
    UPDATE bookings
      SET end_min = (split_part(end_time, ':', 1)::int * 60 + split_part(end_time, ':', 2)::int)
    WHERE end_min IS NULL AND end_time IS NOT NULL;
  
  -- Fill ticket_code for legacy rows
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='ticket_code') THEN
    UPDATE bookings
      SET ticket_code = COALESCE(ticket_code, ticket, ('BS-LEGACY-' || id::text))
    WHERE ticket_code IS NULL;
  END IF;
END IF;

  -- start_ts/end_ts stored as TIMESTAMP
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='start_ts') THEN
    UPDATE bookings
      SET start_min = (EXTRACT(HOUR FROM start_ts)::int * 60 + EXTRACT(MINUTE FROM start_ts)::int)
    WHERE start_min IS NULL AND start_ts IS NOT NULL;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='end_ts') THEN
    UPDATE bookings
      SET end_min = (EXTRACT(HOUR FROM end_ts)::int * 60 + EXTRACT(MINUTE FROM end_ts)::int)
    WHERE end_min IS NULL AND end_ts IS NOT NULL;
  END IF;

  -- price stored as INT in reais (legacy)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='price') THEN
    UPDATE bookings
      SET price_cents = price * 100
    WHERE price_cents IS NULL AND price IS NOT NULL;
  END IF;

  -- keep legacy column price filled (some installs have price NOT NULL)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='price_cents') THEN
    UPDATE bookings
      SET price = COALESCE(price, ROUND(price_cents/100.0))
    WHERE price IS NULL AND price_cents IS NOT NULL;
  END IF;
  UPDATE bookings SET price = 0 WHERE price IS NULL;

  -- duration stored as INT minutes (legacy)
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='duration') THEN
    UPDATE bookings
      SET duration_min = duration
    WHERE duration_min IS NULL AND duration IS NOT NULL;
  END IF;

  -- Fill status/created_at
  UPDATE bookings SET status = 'active' WHERE status IS NULL;
  UPDATE bookings SET created_at = NOW() WHERE created_at IS NULL;

  -- Ticket for older rows
  UPDATE bookings
    SET ticket = ('BS-' || upper(substring(md5(random()::text), 1, 6)))
  WHERE ticket IS NULL;
END $$;
  `);

  // Indexes
  await p.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date_start ON bookings(date, start_min);`);
  await p.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_bookings_ticket ON bookings(ticket);`);

  // Finance indexes
  await p.query(`CREATE INDEX IF NOT EXISTS idx_finance_date ON finance(date);`);
}


function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function cleanPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  // Brasil: se tiver 10 ou 11 dígitos, assume DDD + número
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  // já com 55?
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  return digits; // fallback
}

function genTicket() {
  // Ex: BS-8F3K2Q
  const rand = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `BS-${rand}`;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function sign(payload) {
  // payload: string
  return crypto.createHmac("sha256", ADMIN_PASSWORD || "default").update(payload).digest("base64url");
}

function makeAdminToken() {
  const payload = JSON.stringify({ t: Date.now() });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = sign(payloadB64);
  return `${payloadB64}.${sig}`;
}

function verifyAdminToken(token) {
  if (!token || !ADMIN_PASSWORD) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64);
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  // opcional: expiração 7 dias
  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    if (!payload.t) return false;
    const age = Date.now() - payload.t;
    return age < 7 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function adminAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (verifyAdminToken(cookies.admin_session)) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

// ---- API ----
app.get("/api/health", async (req, res) => {
  try {
    const p = getPool();
    const r = await p.query("select 1 as ok");
    res.json({ ok: true, db: r.rows[0].ok, tz: TZ });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/services", (req, res) => {
  res.json({
    ok: true,
    owner_whatsapp: OWNER_WHATSAPP,
    open: toHHMM(OPEN_MIN),
    close: toHHMM(CLOSE_MIN),
    services: SERVICES.map(s => ({
      key: s.key,
      label: `${s.label} (${s.duration_min} min) • R$ ${s.price_reais}`,
      duration_min: s.duration_min,
      price_reais: s.price_reais
    }))
  });
});

app.get("/api/slots", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    const serviceKey = String(req.query.service || "");
    const svc = SERVICES.find(s => s.key === serviceKey);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ ok: false, error: "date inválida (YYYY-MM-DD)" });
    }
    if (!svc) return res.status(400).json({ ok: false, error: "service inválido" });

    const p = getPool();
    const { rows } = await p.query(
      "SELECT start_min, end_min FROM bookings WHERE date=$1 AND status='active' ORDER BY start_min",
      [date]
    );

    const busy = rows.map(r => ({ start: Number(r.start_min), end: Number(r.end_min) }));
    const slots = [];

    for (let start = OPEN_MIN; start + svc.duration_min <= CLOSE_MIN; start += SLOT_STEP) {
      const end = start + svc.duration_min;
      const conflict = busy.some(b => start < b.end && end > b.start);
      if (!conflict) {
        slots.push({ value: start, label: toHHMM(start) });
      }
    }

    res.json({ ok: true, slots });
  } catch (e) {
    console.error("slots error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/bookings", async (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = String(req.body.phone || "").trim();
  const date = String(req.body.date || "").trim();
  const serviceKey = String(req.body.service_key || "").trim();
  const startMin = Number(req.body.start_min);

  const svc = SERVICES.find(s => s.key === serviceKey);

  if (!name || name.length < 2) return res.status(400).json({ ok: false, error: "Nome inválido" });
  if (!phone || phone.replace(/\D/g, "").length < 10) return res.status(400).json({ ok: false, error: "Telefone inválido" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "Data inválida" });
  if (!svc) return res.status(400).json({ ok: false, error: "Serviço inválido" });
  if (!Number.isFinite(startMin)) return res.status(400).json({ ok: false, error: "Horário inválido" });

  const endMin = startMin + svc.duration_min;
  if (startMin < OPEN_MIN || endMin > CLOSE_MIN) {
    return res.status(400).json({ ok: false, error: "Fora do horário de funcionamento" });
  }

  const ticket = genTicket();
  const priceCents = Math.round(Number(svc.price_reais) * 100);

  const p = getPool();
  const client = await p.connect();
  try {
    await client.query("BEGIN");

    // Confere conflito (reserva concorrente)
    const conflict = await client.query(
      `SELECT 1 FROM bookings
       WHERE date=$1 AND status='active'
       AND ($2 < end_min AND $3 > start_min)
       LIMIT 1`,
      [date, startMin, endMin]
    );
    if (conflict.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ ok: false, error: "Horário acabou de ser ocupado. Escolha outro." });
    }

    const ins = await client.query(
      `INSERT INTO bookings (ticket_code, ticket, name, phone, service_key, service_label, duration_min, price, price_cents, date, start_min, end_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id, ticket, ticket_code, created_at`,
      [ticket, ticket, name, phone, svc.key, svc.label, svc.duration_min, svc.price_reais, priceCents, date, startMin, endMin]
    );

    await client.query("COMMIT");

    res.json({
      ok: true,
      booking: {
        id: ins.rows[0].id,
        ticket: ins.rows[0].ticket,
        created_at: ins.rows[0].created_at,
        name,
        phone,
        date,
        start: toHHMM(startMin),
        end: toHHMM(endMin),
        service_label: svc.label,
        duration_min: svc.duration_min,
        price_reais: svc.price_reais
      }
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("create booking error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  } finally {
    client.release();
  }
});

// ---- Admin login ----
app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

app.post("/admin/login", (req, res) => {
  const pass = String(req.body.password || "");
  if (!ADMIN_PASSWORD) {
    return res.status(500).send("FALTOU ADMIN_PASSWORD no Coolify.");
  }
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).sendFile(path.join(__dirname, "public", "admin-login.html"));
  }
  const token = makeAdminToken();
  res.setHeader("Set-Cookie", `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
  res.redirect("/admin");
});

app.get("/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect("/admin/login");
});

app.get("/admin", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  if (!verifyAdminToken(cookies.admin_session)) {
    return res.redirect("/admin/login");
  }
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ---- Admin API ----
app.get("/api/admin/bookings", adminAuth, async (req, res) => {
  const date = String(req.query.date || "");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: "date inválida" });
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, ticket, name, phone, service_label, duration_min, price_cents, date, start_min, end_min, status, created_at
       FROM bookings
       WHERE date=$1
       ORDER BY start_min`,
      [date]
    );
    res.json({ ok: true, bookings: rows.map(r => ({
      ...r,
      start: toHHMM(Number(r.start_min)),
      end: toHHMM(Number(r.end_min)),
      price_reais: (Number(r.price_cents) / 100).toFixed(2)
    }))});
  } catch (e) {
    console.error("admin bookings error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.patch("/api/admin/bookings/:id", adminAuth, async (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "");
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "id inválido" });
  if (!["active", "cancelled", "done"].includes(status)) return res.status(400).json({ ok: false, error: "status inválido" });

  try {
    const p = getPool();
    await p.query("UPDATE bookings SET status=$1 WHERE id=$2", [status, id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("admin booking update error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/admin/finance", adminAuth, async (req, res) => {
  const start = String(req.query.start || "");
  const end = String(req.query.end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ ok: false, error: "start/end inválidos (YYYY-MM-DD)" });
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT id, kind, amount_cents, description, date, created_at
       FROM finance
       WHERE date >= $1 AND date <= $2
       ORDER BY date DESC, id DESC`,
      [start, end]
    );
    res.json({ ok: true, items: rows.map(r => ({
      ...r,
      amount_reais: (Number(r.amount_cents) / 100).toFixed(2)
    }))});
  } catch (e) {
    console.error("finance list error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/admin/finance/summary", adminAuth, async (req, res) => {
  const start = String(req.query.start || "");
  const end = String(req.query.end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ ok: false, error: "start/end inválidos" });
  }
  try {
    const p = getPool();
    const { rows } = await p.query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind='in' THEN amount_cents ELSE 0 END),0) AS total_in,
         COALESCE(SUM(CASE WHEN kind='out' THEN amount_cents ELSE 0 END),0) AS total_out
       FROM finance
       WHERE date >= $1 AND date <= $2`,
      [start, end]
    );
    const totalIn = Number(rows[0].total_in);
    const totalOut = Number(rows[0].total_out);
    res.json({
      ok: true,
      total_in_reais: (totalIn / 100).toFixed(2),
      total_out_reais: (totalOut / 100).toFixed(2),
      net_reais: ((totalIn - totalOut) / 100).toFixed(2),
    });
  } catch (e) {
    console.error("finance summary error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/admin/finance", adminAuth, async (req, res) => {
  const kind = String(req.body.kind || "");
  const amount = Number(req.body.amount_reais);
  const description = String(req.body.description || "").trim();
  const date = String(req.body.date || "").trim();

  if (!["in", "out"].includes(kind)) return res.status(400).json({ ok: false, error: "kind inválido" });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "valor inválido" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "date inválida" });

  try {
    const p = getPool();
    await p.query(
      `INSERT INTO finance (kind, amount_cents, description, date)
       VALUES ($1,$2,$3,$4)`,
      [kind, Math.round(amount * 100), description, date]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("finance add error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ---- Static ----
app.use(express.static(path.join(__dirname, "public")));

// fallback: SPA index
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ---- Start ----
(async () => {
  try {
    process.env.TZ = TZ;
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
      console.log(`OWNER_WHATSAPP=${OWNER_WHATSAPP}`);
    });
  } catch (e) {
    console.error("FALHA AO INICIAR:", e.message);
    process.exit(1);
  }
})();
