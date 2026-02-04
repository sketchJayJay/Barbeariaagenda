\
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "1mb" }));

// Static site
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// Env
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const FINANCE_PASSWORD = process.env.FINANCE_PASSWORD || process.env.OWNER_PASSWORD || ADMIN_PASSWORD;

// WhatsApp (country code +55 + DDD + número)
const WHATSAPP_NUMBER = (process.env.WHATSAPP_NUMBER || "5532998195165").replace(/\D/g, "");

// Opening hours config
const OPEN_TIME = process.env.OPEN_TIME || "09:00";
const CLOSE_TIME = process.env.CLOSE_TIME || "19:00";
const SLOT_STEP_MIN = Number(process.env.SLOT_STEP_MIN || 10);

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing. Configure it in Coolify Environment Variables.");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Services (key -> label/duration/price)
const SERVICES = {
  corte_sobrancelha: { label: "Corte + Sobrancelha", duration: 40, price: 40 },
  corte: { label: "Corte", duration: 40, price: 35 },
  corte_barba: { label: "Corte + Barba", duration: 50, price: 50 },
  corte_pigmentacao: { label: "Corte + Pigmentação", duration: 60, price: 50 },
  barba: { label: "Barba", duration: 20, price: 20 },
  corte_barba_pigmentacao: { label: "Corte + Barba + Pigmentação", duration: 60, price: 60 },
};

function timeToMin(t) {
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}
function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}
function clampDateStr(date) {
  // Expect YYYY-MM-DD, basic validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return date;
}

function buildCandidateStarts(durationMin) {
  const start = timeToMin(OPEN_TIME);
  const end = timeToMin(CLOSE_TIME);
  if (start === null || end === null) return [];

  const latestStart = end - durationMin;
  const out = [];
  for (let m = start; m <= latestStart; m += SLOT_STEP_MIN) out.push(m);
  return out;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  // overlap if not disjoint
  return !(aEnd <= bStart || aStart >= bEnd);
}

// DB schema (self-healing as much as possible)
async function ensureSchema() {
  // Bookings table (v2 schema). If an old table exists, we try to add missing columns.
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
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Detect & patch legacy schemas
  const colsRes = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings'
  `);
  const colset = new Set(colsRes.rows.map(r => r.column_name));

  async function addCol(sql, name) {
    if (!colset.has(name)) {
      await pool.query(sql);
      colset.add(name);
    }
  }

  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_key TEXT;`, "service_key");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_label TEXT;`, "service_label");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_min INT;`, "duration_min");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price INT;`, "price");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_min INT;`, "start_min");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_min INT;`, "end_min");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';`, "status");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT NOW();`, "created_at");
  await addCol(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS date TEXT;`, "date");

  // Best-effort backfill from common legacy columns (if they exist)
  // start_time/end_time (text/time/timestamp) -> start_min/end_min
  if (colset.has("start_time")) {
    await pool.query(`
      UPDATE bookings
      SET start_min = (EXTRACT(HOUR FROM start_time::time)*60 + EXTRACT(MINUTE FROM start_time::time))::int
      WHERE start_min IS NULL AND start_time IS NOT NULL
    `).catch(() => {});
  }
  if (colset.has("end_time")) {
    await pool.query(`
      UPDATE bookings
      SET end_min = (EXTRACT(HOUR FROM end_time::time)*60 + EXTRACT(MINUTE FROM end_time::time))::int
      WHERE end_min IS NULL AND end_time IS NOT NULL
    `).catch(() => {});
  }
  if (colset.has("start_ts")) {
    await pool.query(`
      UPDATE bookings
      SET start_min = (EXTRACT(HOUR FROM start_ts::time)*60 + EXTRACT(MINUTE FROM start_ts::time))::int
      WHERE start_min IS NULL AND start_ts IS NOT NULL
    `).catch(() => {});
  }
  if (colset.has("end_ts")) {
    await pool.query(`
      UPDATE bookings
      SET end_min = (EXTRACT(HOUR FROM end_ts::time)*60 + EXTRACT(MINUTE FROM end_ts::time))::int
      WHERE end_min IS NULL AND end_ts IS NOT NULL
    `).catch(() => {});
  }

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);`);

  // Finance table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS finance_tx (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('in','out')),
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      method TEXT,
      category TEXT,
      description TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_finance_date ON finance_tx(date);`);
}

// Health
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: "connected" });
  } catch (e) {
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Metadata for front-end
app.get("/api/meta", (_req, res) => {
  const waLink = `https://wa.me/${WHATSAPP_NUMBER}`;
  res.json({
    whatsapp_number: WHATSAPP_NUMBER,
    whatsapp_link: waLink,
    open_time: OPEN_TIME,
    close_time: CLOSE_TIME,
    slot_step_min: SLOT_STEP_MIN,
    services: SERVICES,
  });
});

// Slots
app.get("/api/slots", async (req, res) => {
  const date = clampDateStr(String(req.query.date || ""));
  const serviceKey = String(req.query.service || "");
  if (!date) return res.status(400).json({ error: "date_required" });
  const s = SERVICES[serviceKey];
  if (!s) return res.status(400).json({ error: "invalid_service" });

  try {
    const { rows } = await pool.query(
      "SELECT start_min, end_min FROM bookings WHERE date=$1 AND status='active'",
      [date]
    );

    const intervals = rows
      .map(r => ({ start: Number(r.start_min), end: Number(r.end_min) }))
      .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end));

    const candidates = buildCandidateStarts(s.duration);
    const available = [];
    for (const st of candidates) {
      const en = st + s.duration;
      const conflict = intervals.some(iv => overlaps(st, en, iv.start, iv.end));
      if (!conflict) available.push(minToTime(st));
    }
    res.json(available);
  } catch (e) {
    console.error("slots error:", e);
    res.status(500).json({ error: "db_error" });
  }
});

// Create booking
app.post("/api/bookings", async (req, res) => {
  const body = req.body || {};
  const name = String(body.name || "").trim();
  const phone = String(body.phone || "").trim();
  const date = clampDateStr(String(body.date || ""));
  const time = String(body.time || "");
  const serviceKey = String(body.serviceKey || "");

  if (!name || !phone || !date || !time || !serviceKey) {
    return res.status(400).json({ error: "missing_fields" });
  }

  const s = SERVICES[serviceKey];
  if (!s) return res.status(400).json({ error: "invalid_service" });

  const startMin = timeToMin(time);
  if (startMin === null) return res.status(400).json({ error: "invalid_time" });
  const endMin = startMin + s.duration;

  try {
    // conflict check in SQL
    const conflict = await pool.query(
      `SELECT 1
       FROM bookings
       WHERE date=$1 AND status='active'
         AND NOT (end_min <= $2 OR start_min >= $3)
       LIMIT 1`,
      [date, startMin, endMin]
    );
    if (conflict.rowCount > 0) return res.status(409).json({ error: "slot_taken" });

    const r = await pool.query(
      `INSERT INTO bookings
       (name, phone, service_key, service_label, duration_min, price, date, start_min, end_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [name, phone, serviceKey, s.label, s.duration, s.price, date, startMin, endMin]
    );

    res.json({ ok: true, id: r.rows[0].id });
  } catch (e) {
    console.error("booking error:", e);
    res.status(500).json({ error: "server_error" });
  }
});

// Admin auth (simple token)
let adminToken = "";
app.post("/api/admin/login", (req, res) => {
  const password = String((req.body || {}).password || "");
  if (!password || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "invalid_password" });
  }
  adminToken = crypto.randomBytes(16).toString("hex");
  res.json({ ok: true, token: adminToken });
});

function requireAdmin(req, res, next) {
  const t = req.headers["x-admin-token"];
  if (!t || t !== adminToken) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/api/admin/bookings", requireAdmin, async (req, res) => {
  const date = clampDateStr(String(req.query.date || ""));
  try {
    const q = date
      ? "SELECT * FROM bookings WHERE date=$1 ORDER BY start_min ASC"
      : "SELECT * FROM bookings ORDER BY date DESC, start_min ASC LIMIT 300";
    const args = date ? [date] : [];
    const { rows } = await pool.query(q, args);
    res.json(rows);
  } catch (e) {
    console.error("admin list error:", e);
    res.status(500).json({ error: "db_error" });
  }
});

app.post("/api/admin/bookings/:id/cancel", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });
  try {
    await pool.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("admin cancel error:", e);
    res.status(500).json({ error: "db_error" });
  }
});



// Admin: reset bookings schema (use only if you had an old DB schema)
app.post("/api/admin/reset-bookings", requireAdmin, async (_req, res) => {
  try {
    await pool.query("DROP TABLE IF EXISTS bookings;");
    await pool.query(`
      CREATE TABLE bookings (
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
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);`);
    res.json({ ok: true });
  } catch (e) {
    console.error("reset bookings error:", e);
    res.status(500).json({ error: "db_error" });
  }
});
// Finance auth
let financeToken = "";
app.post("/api/finance/login", (req, res) => {
  const password = String((req.body || {}).password || "");
  if (!password || password !== FINANCE_PASSWORD) {
    return res.status(401).json({ error: "invalid_password" });
  }
  financeToken = crypto.randomBytes(16).toString("hex");
  res.json({ ok: true, token: financeToken });
});

function requireFinance(req, res, next) {
  const t = req.headers["x-finance-token"];
  if (!t || t !== financeToken) return res.status(401).json({ error: "unauthorized" });
  next();
}

app.get("/api/finance/summary", requireFinance, async (req, res) => {
  const date = clampDateStr(String(req.query.date || ""));
  if (!date) return res.status(400).json({ error: "date_required" });

  try {
    const { rows } = await pool.query(
      `SELECT 
         COALESCE(SUM(amount) FILTER (WHERE type='in'), 0) AS total_in,
         COALESCE(SUM(amount) FILTER (WHERE type='out'), 0) AS total_out
       FROM finance_tx
       WHERE date=$1`,
      [date]
    );
    const totalIn = Number(rows[0]?.total_in || 0);
    const totalOut = Number(rows[0]?.total_out || 0);
    res.json({ ok: true, date, total_in: totalIn, total_out: totalOut, net: totalIn - totalOut });
  } catch (e) {
    console.error("finance summary error:", e);
    res.status(500).json({ error: "db_error" });
  }
});

app.get("/api/finance/tx", requireFinance, async (req, res) => {
  const date = clampDateStr(String(req.query.date || ""));
  if (!date) return res.status(400).json({ error: "date_required" });

  try {
    const { rows } = await pool.query(
      `SELECT id, date, type, amount, method, category, description, created_at
       FROM finance_tx
       WHERE date=$1
       ORDER BY created_at DESC, id DESC`,
      [date]
    );
    res.json(rows);
  } catch (e) {
    console.error("finance list error:", e);
    res.status(500).json({ error: "db_error" });
  }
});

app.post("/api/finance/tx", requireFinance, async (req, res) => {
  const b = req.body || {};
  const date = clampDateStr(String(b.date || ""));
  const type = String(b.type || "");
  const amount = Number(b.amount);
  const method = String(b.method || "").trim();
  const category = String(b.category || "").trim();
  const description = String(b.description || "").trim();

  if (!date) return res.status(400).json({ error: "date_required" });
  if (!["in", "out"].includes(type)) return res.status(400).json({ error: "invalid_type" });
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: "invalid_amount" });

  try {
    const { rows } = await pool.query(
      `INSERT INTO finance_tx (date, type, amount, method, category, description)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id`,
      [date, type, amount, method || null, category || null, description || null]
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (e) {
    console.error("finance create error:", e);
    res.status(500).json({ error: "db_error" });
  }
});

app.delete("/api/finance/tx/:id", requireFinance, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "invalid_id" });

  try {
    await pool.query("DELETE FROM finance_tx WHERE id=$1", [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("finance delete error:", e);
    res.status(500).json({ error: "db_error" });
  }
});

// Start
ensureSchema()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on ${PORT}`));
  })
  .catch((e) => {
    console.error("Schema error:", e);
    process.exit(1);
  });
