const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const crypto = require("crypto");

const app = express();
app.use(express.json());

// Site estático
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

if (!DATABASE_URL) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

// Serviços (duração e preço)
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
  return h * 60 + m;
}

function minToTime(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function buildSlots() {
  const open = process.env.OPEN_TIME || "09:00";
  const close = process.env.CLOSE_TIME || "19:00";
  const step = parseInt(process.env.SLOT_STEP_MIN || "10", 10);

  const start = timeToMin(open);
  const end = timeToMin(close);

  const slots = [];
  for (let m = start; m <= end; m += step) slots.push(m);
  return { start, end, slots };
}

async function ensureSchema() {
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
      time TEXT NOT NULL,
      start_min INT NOT NULL,
      end_min INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

async function hasOverlap(date, startMin, endMin) {
  const q = `
    SELECT 1
    FROM bookings
    WHERE date = $1
      AND status = 'active'
      AND NOT (end_min <= $2 OR start_min >= $3)
    LIMIT 1;
  `;
  const r = await pool.query(q, [date, startMin, endMin]);
  return r.rowCount > 0;
}

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "connected" });
  } catch {
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/slots", async (req, res) => {
  try {
  const date = (req.query.date || "").toString();
  const serviceKey = (req.query.service || "").toString();

  if (!date) return res.status(400).json({ error: "date_required" });
  if (!SERVICES[serviceKey]) return res.status(400).json({ error: "invalid_service" });

  const s = SERVICES[serviceKey];
  const { start, end, slots } = buildSlots();

  // Busca todos os agendamentos do dia UMA vez (bem mais rápido e evita timeout)
  const { rows } = await pool.query(
    "SELECT start_min, end_min FROM bookings WHERE date = $1 AND status = 'active'",
    [date]
  );
  const booked = rows.map(r => ({ start: Number(r.start_min), end: Number(r.end_min) }));

  const possible = [];
  for (const st of slots) {
    const en = st + s.duration;
    if (st < start) continue;
    if (en > end) continue;

    const conflict = booked.some(b => !(b.end <= st || b.start >= en));
    if (!conflict) possible.push(minToTime(st));
  }

  res.json(possible);
  } catch (e) {
    console.error("slots error:", e);
    return res.status(500).json({ error: "db_error" });
  }
});

app.post("/api/bookings", async (req, res) => {
  const { name, phone, date, time, serviceKey } = req.body || {};
  if (!name || !phone || !date || !time || !serviceKey) {
    return res.status(400).json({ error: "missing_fields" });
  }
  if (!SERVICES[serviceKey]) {
    return res.status(400).json({ error: "invalid_service" });
  }

  const s = SERVICES[serviceKey];
  const startMin = timeToMin(time);
  const endMin = startMin + s.duration;

  try {
    const conflict = await hasOverlap(date, startMin, endMin);
    if (conflict) return res.status(409).json({ error: "slot_taken" });

    const q = `
      INSERT INTO bookings
      (name, phone, service_key, service_label, duration_min, price, date, time, start_min, end_min)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id;
    `;
    const r = await pool.query(q, [
      name, phone, serviceKey, s.label, s.duration, s.price, date, time, startMin, endMin
    ]);

    res.json({ ok: true, id: r.rows[0].id });
  } catch {
    res.status(500).json({ error: "server_error" });
  }
});

// Admin simples
let adminToken = "";
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
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
  const date = (req.query.date || "").toString();
  const q = date
    ? "SELECT * FROM bookings WHERE date=$1 ORDER BY start_min ASC"
    : "SELECT * FROM bookings ORDER BY date DESC, start_min ASC LIMIT 300";
  const args = date ? [date] : [];
  const { rows } = await pool.query(q, args);
  res.json(rows);
});

app.post("/api/admin/bookings/:id/cancel", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await pool.query("UPDATE bookings SET status='cancelled' WHERE id=$1", [id]);
  res.json({ ok: true });
});

ensureSchema()
  .then(() => app.listen(PORT, () => console.log(`Server running on ${PORT}`)))
  .catch((e) => {
    console.error("Schema error:", e);
    process.exit(1);
  });
