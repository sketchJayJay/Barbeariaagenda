const path = require("path");
const express = require("express");
const helmet = require("helmet");
const { Pool } = require("pg");
const { DateTime } = require("luxon");

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "256kb" }));

// Static site
app.use(express.static(path.join(__dirname, "public")));

const PORT = Number(process.env.PORT || 3000);

// Business hours & settings
const OPEN_TIME = process.env.OPEN_TIME || "09:00";
const CLOSE_TIME = process.env.CLOSE_TIME || "19:00";
const BREAK_START = process.env.BREAK_START || "12:00";
const BREAK_END = process.env.BREAK_END || "13:00";
const SLOT_STEP_MIN = Number(process.env.SLOT_STEP_MIN || 10);
const TZ_OFFSET = process.env.TZ_OFFSET || "-03:00"; // Brazil default

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const DATABASE_URL = process.env.DATABASE_URL;
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
});

const SERVICES = [
  { id: "corte", name: "Corte", durationMin: 30, price: 30 },
  { id: "barba", name: "Barba", durationMin: 20, price: 20 },
  { id: "corte_barba", name: "Corte + Barba", durationMin: 50, price: 45 },
  { id: "sobrancelha", name: "Sobrancelha", durationMin: 10, price: 10 },
];

function requireAdmin(req, res, next) {
  const provided = req.header("x-admin-password") || "";
  if (!ADMIN_PASSWORD || provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  next();
}

function parseHHMM(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return { h, m };
}

function dtLocal(dateISO, timeHHMM) {
  // Build a DateTime in the given TZ offset (fixed offset).
  const { h, m } = parseHHMM(timeHHMM);
  return DateTime.fromISO(dateISO, { zone: "utc" })
    .set({ hour: h, minute: m, second: 0, millisecond: 0 })
    .setZone(`UTC${TZ_OFFSET}`, { keepLocalTime: true });
}

function randomCode(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function ensureSchema() {
  const sql = `
    create table if not exists public.bookings (
      id uuid primary key default gen_random_uuid(),
      created_at timestamptz default now(),
      date date not null,
      start_time time not null,
      end_time time not null,
      start_ts timestamptz not null,
      end_ts timestamptz not null,
      duration_min int not null,
      service_id text not null,
      service_name text not null,
      price numeric not null,
      client_name text not null,
      client_whatsapp text,
      status text not null default 'confirmed',
      code text not null
    );
    create unique index if not exists bookings_unique_start on public.bookings (start_ts) where status = 'confirmed';
    create index if not exists bookings_date_idx on public.bookings (date);
  `;
  // gen_random_uuid requires pgcrypto extension in some setups
  try {
    await pool.query(`create extension if not exists pgcrypto;`);
  } catch (e) {
    // ignore if not allowed
  }
  await pool.query(sql);
}

async function getConfirmedBookingsForDate(dateISO) {
  const r = await pool.query(
    `select id, start_ts, end_ts, start_time, end_time, service_name, client_name, client_whatsapp, status, code
     from public.bookings
     where date = $1 and status = 'confirmed'
     order by start_ts asc`,
    [dateISO]
  );
  return r.rows;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function withinBreak(startDT, endDT, dateISO) {
  const bStart = dtLocal(dateISO, BREAK_START);
  const bEnd = dtLocal(dateISO, BREAK_END);
  return overlaps(startDT.toMillis(), endDT.toMillis(), bStart.toMillis(), bEnd.toMillis());
}

function buildSlots(dateISO, service) {
  const openDT = dtLocal(dateISO, OPEN_TIME);
  const closeDT = dtLocal(dateISO, CLOSE_TIME);
  const step = SLOT_STEP_MIN;

  const slots = [];
  let cursor = openDT;

  while (cursor.plus({ minutes: service.durationMin }) <= closeDT) {
    const startDT = cursor;
    const endDT = cursor.plus({ minutes: service.durationMin });

    if (!withinBreak(startDT, endDT, dateISO)) {
      slots.push({
        start: startDT.toFormat("HH:mm"),
        end: endDT.toFormat("HH:mm"),
        startISO: startDT.toUTC().toISO(),
        endISO: endDT.toUTC().toISO(),
      });
    }
    cursor = cursor.plus({ minutes: step });
  }
  return slots;
}

app.get("/api/services", (req, res) => {
  res.json({ ok: true, services: SERVICES });
});

app.get("/api/health", async (req, res) => {
  try {
    if (!DATABASE_URL) return res.status(500).json({ ok: false, error: "DATABASE_URL missing" });
    await pool.query("select 1 as ok");
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.get("/api/availability", async (req, res) => {
  const date = String(req.query.date || "");
  const serviceId = String(req.query.service || "");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "invalid date" });

  const service = SERVICES.find(s => s.id === serviceId) || SERVICES[0];
  try {
    const bookings = await getConfirmedBookingsForDate(date);
    const slots = buildSlots(date, service);

    const busy = bookings.map(b => ({
      start: DateTime.fromISO(b.start_ts).toMillis(),
      end: DateTime.fromISO(b.end_ts).toMillis(),
    }));

    const available = slots.filter(s => {
      const sStart = DateTime.fromISO(s.startISO).toMillis();
      const sEnd = DateTime.fromISO(s.endISO).toMillis();
      return !busy.some(b => overlaps(sStart, sEnd, b.start, b.end));
    });

    res.json({ ok: true, date, service, available, settings: { OPEN_TIME, CLOSE_TIME, BREAK_START, BREAK_END, SLOT_STEP_MIN, TZ_OFFSET } });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/book", async (req, res) => {
  const { date, time, serviceId, clientName, clientWhatsapp } = req.body || {};
  if (!DATABASE_URL) return res.status(500).json({ ok: false, error: "DATABASE_URL missing" });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return res.status(400).json({ ok: false, error: "invalid date" });
  if (!time || !/^\d{2}:\d{2}$/.test(String(time))) return res.status(400).json({ ok: false, error: "invalid time" });
  if (!clientName || String(clientName).trim().length < 2) return res.status(400).json({ ok: false, error: "invalid name" });

  const service = SERVICES.find(s => s.id === String(serviceId)) || SERVICES[0];
  const startDT = dtLocal(String(date), String(time));
  const endDT = startDT.plus({ minutes: service.durationMin });

  // Validate within hours and not in break
  const openDT = dtLocal(String(date), OPEN_TIME);
  const closeDT = dtLocal(String(date), CLOSE_TIME);
  if (startDT < openDT || endDT > closeDT) return res.status(400).json({ ok: false, error: "outside business hours" });
  if (withinBreak(startDT, endDT, String(date))) return res.status(400).json({ ok: false, error: "inside break time" });

  const code = randomCode(6);

  try {
    // Conflict check via unique index on start_ts (confirmed)
    const q = `
      insert into public.bookings
        (date, start_time, end_time, start_ts, end_ts, duration_min, service_id, service_name, price, client_name, client_whatsapp, status, code)
      values
        ($1, $2::time, $3::time, $4::timestamptz, $5::timestamptz, $6, $7, $8, $9, $10, $11, 'confirmed', $12)
      returning id;
    `;
    const startUTC = startDT.toUTC().toISO();
    const endUTC = endDT.toUTC().toISO();
    const r = await pool.query(q, [
      String(date),
      startDT.toFormat("HH:mm"),
      endDT.toFormat("HH:mm"),
      startUTC,
      endUTC,
      service.durationMin,
      service.id,
      service.name,
      service.price,
      String(clientName).trim(),
      clientWhatsapp ? String(clientWhatsapp).trim() : null,
      code,
    ]);

    res.json({ ok: true, id: r.rows[0]?.id, code });
  } catch (e) {
    // Unique violation -> already booked
    const msg = String(e.message || e);
    if (msg.includes("bookings_unique_start")) {
      return res.status(409).json({ ok: false, error: "slot already booked" });
    }
    res.status(500).json({ ok: false, error: msg });
  }
});

// Admin routes
app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  const date = String(req.query.date || "");
  try {
    let r;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      r = await pool.query(
        `select id, created_at, date, start_time, end_time, service_name, price, client_name, client_whatsapp, status, code
         from public.bookings where date = $1
         order by start_ts asc`,
        [date]
      );
    } else {
      r = await pool.query(
        `select id, created_at, date, start_time, end_time, service_name, price, client_name, client_whatsapp, status, code
         from public.bookings
         order by start_ts desc
         limit 200`
      );
    }
    res.json({ ok: true, rows: r.rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.post("/api/admin/cancel", requireAdmin, async (req, res) => {
  const { id } = req.body || {};
  if (!id) return res.status(400).json({ ok: false, error: "missing id" });

  try {
    const r = await pool.query(
      `update public.bookings set status = 'canceled' where id = $1 returning id`,
      [id]
    );
    res.json({ ok: true, id: r.rows[0]?.id || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

async function start() {
  try {
    if (!DATABASE_URL) {
      console.log("[WARN] DATABASE_URL não configurada ainda. Configure no Coolify e faça Redeploy.");
    } else {
      await ensureSchema();
      console.log("[OK] Banco conectado e schema pronto.");
    }
  } catch (e) {
    console.log("[WARN] Falha ao preparar schema:", e.message || e);
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[OK] Barbearia Suprema rodando na porta ${PORT}`);
  });
}

start();
