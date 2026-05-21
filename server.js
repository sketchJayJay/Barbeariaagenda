const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Config ----
const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = process.env.DATABASE_URL || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const FINANCE_PASSWORD = process.env.FINANCE_PASSWORD || ADMIN_PASSWORD || "";
const OWNER_WHATSAPP = (process.env.OWNER_WHATSAPP || "3298195165").replace(/\D/g, "");
// Webhook opcional para Make/n8n/Zapier. Quando configurado, o sistema dispara
// os dados do agendamento confirmado para a automação enviar o WhatsApp.
const WHATSAPP_WEBHOOK_URL = String(process.env.WHATSAPP_WEBHOOK_URL || "").trim();
const WHATSAPP_WEBHOOK_SECRET = String(process.env.WHATSAPP_WEBHOOK_SECRET || "").trim();
const TZ = process.env.TZ || "America/Sao_Paulo";

// Horário de funcionamento e passo da agenda
const OPEN_MIN = parseHHMM(process.env.OPEN_TIME || "08:00", 8 * 60);
const CLOSE_MIN = parseHHMM(process.env.CLOSE_TIME || "20:20", 20 * 60 + 20);
const SLOT_STEP = Number(process.env.SLOT_STEP_MIN || 20);

// WhatsApp Cloud API opcional
const WA_TOKEN = process.env.WA_TOKEN || "";
const WA_PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || "";
const WA_TEMPLATE_NAME = process.env.WA_TEMPLATE_NAME || "booking_alert";
const WA_TEMPLATE_LANG = process.env.WA_TEMPLATE_LANG || "pt_BR";
const OWNER_WHATSAPP_E164 = (process.env.OWNER_WHATSAPP_E164 || normalizeWa(OWNER_WHATSAPP)).replace(/\D/g, "");

const SERVICES = [
  { key: "corte_sobrancelha", label: "Corte + Sobrancelha", duration_min: 40, price_reais: 40 },
  { key: "corte", label: "Corte", duration_min: 40, price_reais: 35 },
  { key: "corte_barba", label: "Corte + Barba", duration_min: 50, price_reais: 50 },
  { key: "corte_pigmentacao", label: "Corte + Pigmentação", duration_min: 60, price_reais: 50 },
  { key: "barba", label: "Barba", duration_min: 20, price_reais: 20 },
  { key: "corte_barba_pigmentacao", label: "Corte + Barba + Pigmentação", duration_min: 60, price_reais: 60 },
];

let pool = null;

function getPool() {
  if (!pool) {
    if (!DATABASE_URL) throw new Error("FALTOU DATABASE_URL");
    const useSSL = String(process.env.PGSSL || "").toLowerCase() === "true";
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: useSSL ? { rejectUnauthorized: false } : undefined,
    });
  }
  return pool;
}

function parseHHMM(value, fallback) {
  const m = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return fallback;
  return hh * 60 + mm;
}

function toHHMM(min) {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function normalizeWa(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

function cleanPhone(phone) {
  return normalizeWa(phone);
}

function genTicket() {
  return `BS-${crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 6)}`;
}

function nowInSaoPaulo() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
}

function formatISODateLocal(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toBRDate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "");
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function formatPhoneBR(raw) {
  const dig = String(raw || "").replace(/\D/g, "");
  if (dig.length === 11) return `(${dig.slice(0,2)}) ${dig.slice(2,7)}-${dig.slice(7)}`;
  if (dig.length === 10) return `(${dig.slice(0,2)}) ${dig.slice(2,6)}-${dig.slice(6)}`;
  if (dig.startsWith("55")) return formatPhoneBR(dig.slice(2));
  return raw ? String(raw) : "Não informado";
}

function buildOwnerMessageServer(b) {
  const phoneText = b.phone ? formatPhoneBR(b.phone) : "Não informado";
  return `✅ Novo agendamento confirmado - Barbearia Suprema
Ticket: ${b.ticket}
Cliente: ${b.name}
Telefone: ${phoneText}
Data: ${toBRDate(b.date)}
Horário: ${b.start} às ${b.end}
Serviço: ${b.service_label}
Valor: R$ ${b.price_reais}`;
}

// Regra: só permite agendamento a partir de amanhã
function minAllowedBookingDateISO() {
  const spNow = nowInSaoPaulo();
  const dt = new Date(spNow.getFullYear(), spNow.getMonth(), spNow.getDate());
  dt.setDate(dt.getDate() + 1);
  return formatISODateLocal(dt);
}

function parseISODate(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDaysISO(iso, days) {
  const d = parseISODate(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + days);
  return formatISODateLocal(d);
}

function monthLastDay(year, month0) {
  return new Date(year, month0 + 1, 0);
}

async function safeQuery(sql, params = []) {
  try {
    return await getPool().query(sql, params);
  } catch (e) {
    console.log("[DB migration warning]", e.message);
    return null;
  }
}

async function initDb() {
  const p = getPool();

  await p.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      ticket TEXT,
      ticket_code TEXT,
      name TEXT,
      phone TEXT,
      service_key TEXT,
      service_label TEXT,
      duration_min INT,
      price INT,
      price_cents INT,
      date TEXT,
      start_min INT,
      end_min INT,
      status TEXT DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone_e164 TEXT NOT NULL UNIQUE,
      birth_date TEXT,
      marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
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
      method TEXT,
      category TEXT,
      booking_id INT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Colunas para bases antigas, sem apagar nada.
  const alters = [
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ticket_code TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS name TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS phone TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_key TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS service_label TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS duration_min INT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price INT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS price_cents INT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS date TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS start_min INT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS end_min INT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS status TEXT`,
    `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS created_at TIMESTAMP`,
    `ALTER TABLE finance ADD COLUMN IF NOT EXISTS note TEXT`,
    `ALTER TABLE finance ADD COLUMN IF NOT EXISTS method TEXT`,
    `ALTER TABLE finance ADD COLUMN IF NOT EXISTS category TEXT`,
    `ALTER TABLE finance ADD COLUMN IF NOT EXISTS booking_id INT`,
  ];
  for (const q of alters) await safeQuery(q);

  await safeQuery(`UPDATE bookings SET status='active' WHERE status IS NULL`);
  await safeQuery(`UPDATE bookings SET created_at=NOW() WHERE created_at IS NULL`);
  await safeQuery(`UPDATE bookings SET ticket=COALESCE(ticket, ticket_code, 'BS-LEGACY-' || id::text) WHERE ticket IS NULL`);
  await safeQuery(`UPDATE bookings SET ticket_code=COALESCE(ticket_code, ticket, 'BS-LEGACY-' || id::text) WHERE ticket_code IS NULL`);
  await safeQuery(`UPDATE bookings SET price_cents = price * 100 WHERE price_cents IS NULL AND price IS NOT NULL`);
  await safeQuery(`UPDATE bookings SET price = ROUND(price_cents / 100.0) WHERE price IS NULL AND price_cents IS NOT NULL`);
  await safeQuery(`UPDATE bookings SET price = 0 WHERE price IS NULL`);

  // Compatibilidade com schemas antigos que tinham start_time/end_time ou start_ts/end_ts.
  await safeQuery(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='start_time') THEN
        UPDATE bookings
        SET start_min = (split_part(start_time::text, ':', 1)::int * 60 + split_part(start_time::text, ':', 2)::int)
        WHERE start_min IS NULL AND start_time IS NOT NULL AND start_time::text ~ '^\\d{1,2}:\\d{2}';
      END IF;

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='end_time') THEN
        UPDATE bookings
        SET end_min = (split_part(end_time::text, ':', 1)::int * 60 + split_part(end_time::text, ':', 2)::int)
        WHERE end_min IS NULL AND end_time IS NOT NULL AND end_time::text ~ '^\\d{1,2}:\\d{2}';
      END IF;

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

      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bookings' AND column_name='duration') THEN
        UPDATE bookings SET duration_min = duration WHERE duration_min IS NULL AND duration IS NOT NULL;
      END IF;
    END $$;
  `);

  // Migra tabela antiga finance_entries, se existir.
  await safeQuery(`
    INSERT INTO finance (kind, amount_cents, description, note, date, created_at)
    SELECT kind, amount_cents, COALESCE(label, description, 'Movimento'), note, date, COALESCE(created_at, NOW())
    FROM finance_entries
    WHERE to_regclass('public.finance_entries') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM finance LIMIT 1)
  `);

  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_bookings_date_start ON bookings(date, start_min)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_customers_birth ON customers(birth_date)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_finance_date ON finance(date)`);
  await safeQuery(`CREATE INDEX IF NOT EXISTS idx_finance_booking ON finance(booking_id)`);
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  cookieHeader.split(";").forEach(part => {
    const idx = part.indexOf("=");
    if (idx === -1) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function sign(payload, secret) {
  return crypto.createHmac("sha256", secret || "default").update(payload).digest("base64url");
}

function makeToken(secret) {
  const payload = JSON.stringify({ t: Date.now(), r: crypto.randomBytes(4).toString("hex") });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

function verifyToken(token, secret) {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, sig] = parts;
  const expected = sign(payloadB64, secret);
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    return payload.t && (Date.now() - payload.t) < 7 * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

function adminAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  if (verifyToken(cookies.admin_session, ADMIN_PASSWORD)) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

function financeAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  const headerToken = req.headers["x-finance-token"];
  if (verifyToken(cookies.finance_session, FINANCE_PASSWORD)) return next();
  if (verifyToken(headerToken, FINANCE_PASSWORD)) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

async function sendOwnerWhatsAppTemplate({ name, serviceLabel, date, startHHMM, ticket }) {
  try {
    if (!WA_TOKEN || !WA_PHONE_NUMBER_ID || !OWNER_WHATSAPP_E164) return false;

    const url = `https://graph.facebook.com/v19.0/${WA_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: OWNER_WHATSAPP_E164,
      type: "template",
      template: {
        name: WA_TEMPLATE_NAME,
        language: { code: WA_TEMPLATE_LANG },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: String(name || "") },
            { type: "text", text: String(serviceLabel || "") },
            { type: "text", text: String(date || "") },
            { type: "text", text: String(startHHMM || "") },
            { type: "text", text: String(ticket || "") },
          ],
        }],
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${WA_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.log("[WA] erro ao enviar aviso:", data);
      return false;
    }
    return true;
  } catch (e) {
    console.log("[WA] falha ao enviar aviso:", e?.message || e);
    return false;
  }
}

async function sendBookingWebhook(booking) {
  if (!WHATSAPP_WEBHOOK_URL) return { enabled: false, sent: false };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const payload = {
      event: "booking.confirmed",
      source: "barbearia_suprema",
      sent_at: new Date().toISOString(),
      owner_whatsapp: normalizeWa(OWNER_WHATSAPP),
      message: buildOwnerMessageServer(booking),
      booking: {
        id: booking.id,
        ticket: booking.ticket,
        name: booking.name,
        phone: booking.phone || "",
        phone_e164: booking.phone ? cleanPhone(booking.phone) : "",
        date: booking.date,
        date_br: toBRDate(booking.date),
        start: booking.start,
        end: booking.end,
        start_min: booking.start_min,
        end_min: booking.end_min,
        service_key: booking.service_key,
        service_label: booking.service_label,
        duration_min: booking.duration_min,
        price_reais: booking.price_reais,
        price_cents: booking.price_cents,
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "BarbeariaSupremaAgenda/1.0",
    };
    if (WHATSAPP_WEBHOOK_SECRET) headers["X-Webhook-Secret"] = WHATSAPP_WEBHOOK_SECRET;

    const response = await fetch(WHATSAPP_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.log("[WEBHOOK] erro ao disparar aviso:", response.status, text.slice(0, 300));
      return { enabled: true, sent: false, status: response.status };
    }

    return { enabled: true, sent: true, status: response.status };
  } catch (e) {
    console.log("[WEBHOOK] falha ao disparar aviso:", e?.message || e);
    return { enabled: true, sent: false, error: e?.message || String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

function buildFinanceRange(query) {
  const range = String(query.range || "day");
  const today = formatISODateLocal(nowInSaoPaulo());

  if (range === "month") {
    const month = String(query.month || today.slice(0, 7));
    const m = month.match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]) - 1;
    return { range, from: `${m[1]}-${m[2]}-01`, to: formatISODateLocal(monthLastDay(y, mo)) };
  }

  const date = String(query.date || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  if (range === "week") {
    const d = parseISODate(date);
    if (!d) return null;
    const day = d.getDay();
    const diffToMon = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diffToMon);
    const from = formatISODateLocal(d);
    const end = new Date(d);
    end.setDate(d.getDate() + 6);
    return { range, from, to: formatISODateLocal(end) };
  }

  return { range: "day", from: date, to: date };
}

async function addFinanceFromBooking(client, bookingId) {
  const { rows } = await client.query(
    `SELECT id, ticket, name, service_label, date, start_min, price_cents
     FROM bookings WHERE id=$1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) return;
  const amount = Number(b.price_cents || 0);
  if (amount <= 0) return;

  await client.query(
    `INSERT INTO finance (kind, amount_cents, description, note, date, method, category, booking_id)
     SELECT 'in', $1, $2, $3, $4, '', 'Agendamento', $5
     WHERE NOT EXISTS (SELECT 1 FROM finance WHERE booking_id=$5 AND kind='in')`,
    [
      amount,
      `Serviço finalizado: ${b.service_label || 'Agendamento'}`,
      `Ticket ${b.ticket || ''} - Cliente ${b.name || ''} - ${toHHMM(Number(b.start_min || 0))}`,
      b.date,
      b.id,
    ]
  );
}

// ---- API pública ----
app.get("/api/health", async (req, res) => {
  try {
    const r = await getPool().query("SELECT 1 AS ok");
    res.json({ ok: true, db: r.rows[0].ok, tz: TZ, open: toHHMM(OPEN_MIN), close: toHHMM(CLOSE_MIN) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/api/services", (req, res) => {
  res.json({
    ok: true,
    owner_whatsapp: OWNER_WHATSAPP,
    webhook_enabled: Boolean(WHATSAPP_WEBHOOK_URL),
    open: toHHMM(OPEN_MIN),
    close: toHHMM(CLOSE_MIN),
    services: SERVICES.map(s => ({
      key: s.key,
      label: `${s.label} (${s.duration_min} min) • R$ ${s.price_reais}`,
      duration_min: s.duration_min,
      price_reais: s.price_reais,
    })),
  });
});

app.get("/api/customers/lookup", async (req, res) => {
  try {
    const phone = String(req.query.phone || "").trim();
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) return res.status(400).json({ ok: false, error: "Informe um WhatsApp válido." });

    const phoneE164 = cleanPhone(phone);
    const { rows } = await getPool().query(
      `SELECT id, name, phone_e164, birth_date, marketing_opt_in, created_at
       FROM customers
       WHERE phone_e164=$1
       LIMIT 1`,
      [phoneE164]
    );

    if (!rows[0]) return res.json({ ok: true, found: false });

    res.json({
      ok: true,
      found: true,
      customer: {
        id: rows[0].id,
        name: rows[0].name || "",
        phone: rows[0].phone_e164 || phoneE164,
        phone_br: formatPhoneBR(rows[0].phone_e164 || phoneE164),
        birth_date: rows[0].birth_date || "",
        marketing_opt_in: Boolean(rows[0].marketing_opt_in),
      },
    });
  } catch (e) {
    console.error("customer lookup error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/slots", async (req, res) => {
  try {
    const date = String(req.query.date || "");
    const serviceKey = String(req.query.service || "");
    const svc = SERVICES.find(s => s.key === serviceKey);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "date inválida (YYYY-MM-DD)" });
    if (date < minAllowedBookingDateISO()) return res.json({ ok: true, slots: [] });
    if (!svc) return res.status(400).json({ ok: false, error: "service inválido" });

    const { rows } = await getPool().query(
      `SELECT start_min, end_min FROM bookings WHERE date=$1 AND status='active' ORDER BY start_min`,
      [date]
    );
    const busy = rows
      .filter(r => r.start_min !== null && r.end_min !== null)
      .map(r => ({ start: Number(r.start_min), end: Number(r.end_min) }));

    const slots = [];
    for (let start = OPEN_MIN; start <= CLOSE_MIN; start += SLOT_STEP) {
      const end = start + svc.duration_min;
      const conflict = busy.some(b => start < b.end && end > b.start);
      if (!conflict) slots.push({ value: start, label: toHHMM(start) });
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
  const marketingOptIn = Boolean(req.body.marketing_opt_in);
  const birthDate = String(req.body.birth_date || "").trim();
  const svc = SERVICES.find(s => s.key === serviceKey);

  if (!name || name.length < 2) return res.status(400).json({ ok: false, error: "Nome inválido" });
  const phoneDigits = phone.replace(/\D/g, "");
  if (phone && phoneDigits.length < 10) return res.status(400).json({ ok: false, error: "Telefone inválido" });
  if (marketingOptIn && !phone) return res.status(400).json({ ok: false, error: "Para receber promoções, informe o WhatsApp." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "Data inválida" });
  if (date < minAllowedBookingDateISO()) return res.status(400).json({ ok: false, error: "Só é possível agendar a partir de amanhã." });
  if (!svc) return res.status(400).json({ ok: false, error: "Serviço inválido" });
  if (!Number.isFinite(startMin)) return res.status(400).json({ ok: false, error: "Horário inválido" });
  if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return res.status(400).json({ ok: false, error: "Data de nascimento inválida" });

  const endMin = startMin + svc.duration_min;
  if (startMin < OPEN_MIN || startMin > CLOSE_MIN) return res.status(400).json({ ok: false, error: "Fora do horário de funcionamento" });

  const ticket = genTicket();
  const priceCents = Math.round(Number(svc.price_reais) * 100);
  const client = await getPool().connect();

  try {
    await client.query("BEGIN");
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

    if (phone) {
      const phoneE164 = cleanPhone(phone);
      await client.query(
        `INSERT INTO customers (name, phone_e164, birth_date, marketing_opt_in)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (phone_e164) DO UPDATE
         SET name=EXCLUDED.name,
             birth_date=COALESCE(EXCLUDED.birth_date, customers.birth_date),
             marketing_opt_in=(customers.marketing_opt_in OR EXCLUDED.marketing_opt_in)`,
        [name, phoneE164, birthDate || null, marketingOptIn]
      );
    }

    const ins = await client.query(
      `INSERT INTO bookings (ticket_code, ticket, name, phone, service_key, service_label, duration_min, price, price_cents, date, start_min, end_min, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'active')
       RETURNING id, ticket, ticket_code, created_at`,
      [ticket, ticket, name, phone, svc.key, svc.label, svc.duration_min, svc.price_reais, priceCents, date, startMin, endMin]
    );

    await client.query("COMMIT");

    const bookingResponse = {
      id: ins.rows[0].id,
      ticket: ins.rows[0].ticket || ins.rows[0].ticket_code,
      created_at: ins.rows[0].created_at,
      name,
      phone,
      date,
      start: toHHMM(startMin),
      end: toHHMM(endMin),
      start_min: startMin,
      end_min: endMin,
      service_key: svc.key,
      service_label: svc.label,
      duration_min: svc.duration_min,
      price_reais: svc.price_reais,
      price_cents: priceCents,
      owner_whatsapp: OWNER_WHATSAPP,
    };

    const webhookResult = await sendBookingWebhook(bookingResponse);
    sendOwnerWhatsAppTemplate({ name, serviceLabel: svc.label, date, startHHMM: toHHMM(startMin), ticket }).catch(() => {});

    res.json({
      ok: true,
      webhook_enabled: webhookResult.enabled,
      webhook_sent: webhookResult.sent,
      booking: {
        ...bookingResponse,
        webhook_enabled: webhookResult.enabled,
        webhook_sent: webhookResult.sent,
      },
    });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("create booking error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  } finally {
    client.release();
  }
});

// ---- Login Admin ----
app.get("/admin/login", (req, res) => res.sendFile(path.join(__dirname, "public", "admin-login.html")));

app.post("/admin/login", (req, res) => {
  const pass = String(req.body.password || "");
  if (!ADMIN_PASSWORD) return res.status(500).send("FALTOU ADMIN_PASSWORD no Coolify.");
  if (pass !== ADMIN_PASSWORD) return res.status(401).sendFile(path.join(__dirname, "public", "admin-login.html"));
  const token = makeToken(ADMIN_PASSWORD);
  res.setHeader("Set-Cookie", `admin_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
  res.redirect("/admin");
});

app.get("/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", "admin_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect("/admin/login");
});

app.get("/admin", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  if (!verifyToken(cookies.admin_session, ADMIN_PASSWORD)) return res.redirect("/admin/login");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ---- Login Financeiro ----
app.get("/finance/login", (req, res) => res.sendFile(path.join(__dirname, "public", "finance-login.html")));

app.post("/finance/login", (req, res) => {
  const pass = String(req.body.password || "");
  if (!FINANCE_PASSWORD) return res.status(500).send("FALTOU FINANCE_PASSWORD ou ADMIN_PASSWORD no Coolify.");
  if (pass !== FINANCE_PASSWORD) return res.status(401).sendFile(path.join(__dirname, "public", "finance-login.html"));
  const token = makeToken(FINANCE_PASSWORD);
  res.setHeader("Set-Cookie", `finance_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`);
  res.redirect("/finance");
});

app.get("/finance/logout", (req, res) => {
  res.setHeader("Set-Cookie", "finance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect("/finance/login");
});

app.get("/finance", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  if (!verifyToken(cookies.finance_session, FINANCE_PASSWORD)) return res.redirect("/finance/login");
  res.sendFile(path.join(__dirname, "public", "finance.html"));
});

// API de login legado do financeiro, se alguma tela antiga chamar.
app.post("/api/finance/login", (req, res) => {
  const pass = String(req.body.password || "");
  if (!FINANCE_PASSWORD) return res.status(500).json({ ok: false, error: "FALTOU FINANCE_PASSWORD" });
  if (pass !== FINANCE_PASSWORD) return res.status(401).json({ ok: false, error: "Senha inválida" });
  res.json({ ok: true, token: makeToken(FINANCE_PASSWORD) });
});

// ---- Admin API ----
app.get("/api/admin/bookings", adminAuth, async (req, res) => {
  const date = String(req.query.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "date inválida" });

  try {
    const { rows } = await getPool().query(
      `SELECT id,
              COALESCE(ticket, ticket_code) AS ticket,
              name, phone, service_label, duration_min,
              COALESCE(price_cents, ROUND(COALESCE(price, 0) * 100)::int) AS price_cents,
              date, start_min, end_min, status, created_at
       FROM bookings
       WHERE date=$1
       ORDER BY start_min`,
      [date]
    );
    res.json({ ok: true, bookings: rows.map(r => ({
      ...r,
      start: r.start_min === null ? "--:--" : toHHMM(Number(r.start_min)),
      end: r.end_min === null ? "--:--" : toHHMM(Number(r.end_min)),
      price_reais: (Number(r.price_cents || 0) / 100).toFixed(2),
    })) });
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

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE bookings SET status=$1 WHERE id=$2", [status, id]);
    if (status === "done") await addFinanceFromBooking(client, id);
    await client.query("COMMIT");
    res.json({ ok: true });
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error("admin booking update error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/customers", adminAuth, async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, phone_e164, birth_date, marketing_opt_in, created_at
       FROM customers
       WHERE marketing_opt_in = TRUE
       ORDER BY created_at DESC, id DESC`
    );
    res.json({ ok: true, customers: rows });
  } catch (e) {
    console.error("admin customers error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// Financeiro usado no painel admin
app.get("/api/admin/finance", adminAuth, async (req, res) => {
  const start = String(req.query.start || "");
  const end = String(req.query.end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return res.status(400).json({ ok: false, error: "start/end inválidos (YYYY-MM-DD)" });
  }

  try {
    const { rows } = await getPool().query(
      `SELECT id, kind, amount_cents, description, note, date, method, category, booking_id, created_at
       FROM finance
       WHERE date >= $1 AND date <= $2
       ORDER BY date DESC, id DESC`,
      [start, end]
    );
    res.json({ ok: true, items: rows.map(r => ({ ...r, amount_reais: (Number(r.amount_cents || 0) / 100).toFixed(2) })) });
  } catch (e) {
    console.error("finance list error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/admin/finance/summary", adminAuth, async (req, res) => {
  const start = String(req.query.start || "");
  const end = String(req.query.end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return res.status(400).json({ ok: false, error: "start/end inválidos" });

  try {
    const { rows } = await getPool().query(
      `SELECT COALESCE(SUM(CASE WHEN kind='in' THEN amount_cents ELSE 0 END),0) AS total_in,
              COALESCE(SUM(CASE WHEN kind='out' THEN amount_cents ELSE 0 END),0) AS total_out
       FROM finance
       WHERE date >= $1 AND date <= $2`,
      [start, end]
    );
    const totalIn = Number(rows[0].total_in || 0);
    const totalOut = Number(rows[0].total_out || 0);
    res.json({ ok: true, total_in_reais: (totalIn / 100).toFixed(2), total_out_reais: (totalOut / 100).toFixed(2), net_reais: ((totalIn - totalOut) / 100).toFixed(2) });
  } catch (e) {
    console.error("finance summary error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/admin/finance", adminAuth, async (req, res) => {
  const kind = String(req.body.kind || "");
  const amount = Number(req.body.amount_reais);
  const description = String(req.body.description || "").trim() || "Movimento manual";
  const date = String(req.body.date || "").trim();

  if (!["in", "out"].includes(kind)) return res.status(400).json({ ok: false, error: "kind inválido" });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "valor inválido" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "date inválida" });

  try {
    await getPool().query(
      `INSERT INTO finance (kind, amount_cents, description, date) VALUES ($1,$2,$3,$4)`,
      [kind, Math.round(amount * 100), description, date]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("finance add error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ---- API Financeiro separado ----
app.get("/api/finance/summary", financeAuth, async (req, res) => {
  const r = buildFinanceRange(req.query);
  if (!r) return res.status(400).json({ ok: false, error: "Período inválido" });

  try {
    const { rows } = await getPool().query(
      `SELECT COALESCE(SUM(CASE WHEN kind='in' THEN amount_cents ELSE 0 END),0) AS total_in,
              COALESCE(SUM(CASE WHEN kind='out' THEN amount_cents ELSE 0 END),0) AS total_out
       FROM finance
       WHERE date >= $1 AND date <= $2`,
      [r.from, r.to]
    );
    const totalIn = Number(rows[0].total_in || 0) / 100;
    const totalOut = Number(rows[0].total_out || 0) / 100;
    res.json({ ok: true, range: r.range, from: r.from, to: r.to, total_in: totalIn, total_out: totalOut, net: totalIn - totalOut });
  } catch (e) {
    console.error("finance summary api error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.get("/api/finance/tx", financeAuth, async (req, res) => {
  const r = buildFinanceRange(req.query);
  if (!r) return res.status(400).json({ ok: false, error: "Período inválido" });

  try {
    const { rows } = await getPool().query(
      `SELECT id, kind AS type, (amount_cents / 100.0) AS amount, method, category, description, note, date, created_at, booking_id
       FROM finance
       WHERE date >= $1 AND date <= $2
       ORDER BY date DESC, id DESC`,
      [r.from, r.to]
    );
    res.json({ ok: true, range: r.range, from: r.from, to: r.to, rows });
  } catch (e) {
    console.error("finance tx api error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.post("/api/finance/tx", financeAuth, async (req, res) => {
  const type = String(req.body.type || "");
  const amount = Number(req.body.amount);
  const method = String(req.body.method || "").trim();
  const category = String(req.body.category || "").trim();
  const description = String(req.body.description || "").trim() || "Movimento manual";
  const date = String(req.body.date || "").trim();

  if (!["in", "out"].includes(type)) return res.status(400).json({ ok: false, error: "Tipo inválido" });
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ ok: false, error: "Valor inválido" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ ok: false, error: "Data inválida" });

  try {
    await getPool().query(
      `INSERT INTO finance (kind, amount_cents, method, category, description, date)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [type, Math.round(amount * 100), method, category, description, date]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error("finance tx add error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

app.delete("/api/finance/tx/:id", financeAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "ID inválido" });

  try {
    await getPool().query(`DELETE FROM finance WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    console.error("finance tx delete error:", e);
    res.status(500).json({ ok: false, error: "db_error" });
  }
});

// ---- Static ----
app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

(async () => {
  try {
    process.env.TZ = TZ;
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server running on ${PORT}`);
      console.log(`OWNER_WHATSAPP=${OWNER_WHATSAPP}`);
      console.log(`WHATSAPP_WEBHOOK_URL=${WHATSAPP_WEBHOOK_URL ? "configurado" : "não configurado"}`);
      console.log(`Agenda: ${toHHMM(OPEN_MIN)} até ${toHHMM(CLOSE_MIN)} / passo ${SLOT_STEP}min`);
    });
  } catch (e) {
    console.error("FALHA AO INICIAR:", e.message);
    process.exit(1);
  }
})();
