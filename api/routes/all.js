require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const path = require("path");
const { MongoClient } = require("mongodb");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // the web page

const client = new MongoClient(process.env.MONGODB_URI);
let slots, bookings, idem, attempts;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const fmt = (b) => ({
  id: b.id, slot_id: b.slot_id, name: b.name, email: b.email,
  status: b.status, created_at: b.created_at.toISOString(),
});

// ---------- Level 2: API key on every API request ----------
app.use((req, res, next) => {
  if (req.header("X-API-Key") !== process.env.API_KEY) {
    return res.status(401).json({ error: "invalid or missing API key" });
  }
  next();
});

// ---------- Level 1: reset ----------
app.post("/reset", async (req, res) => {
  const list = req.body && req.body.slots;
  if (!Array.isArray(list)) return res.status(400).json({ error: "slots must be an array" });
  await Promise.all([
    bookings.deleteMany({}), idem.deleteMany({}),
    attempts.deleteMany({}), slots.deleteMany({}),
  ]);
  if (list.length) {
    await slots.insertMany(list.map((s) => ({
      _id: s.id, id: s.id, provider: s.provider,
      start: s.start, end: s.end, startMs: Date.parse(s.start),
    })));
  }
  res.status(200).json({ ok: true });
});

// ---------- Level 1: list slots ----------
app.get("/slots", async (req, res) => {
  const filter = req.query.provider ? { provider: req.query.provider } : {};
  const list = await slots.find(filter).sort({ startMs: 1 }).toArray();
  const taken = new Set(await bookings.distinct("slot_id", { status: "confirmed" }));
  res.json({
    slots: list.map((s) => ({
      id: s.id, provider: s.provider, start: s.start, end: s.end,
      available: !taken.has(s.id),
    })),
  });
});

// ---------- Create a booking (levels 1-5) ----------
async function createBooking(b) {
  const slot_id = typeof b.slot_id === "string" ? b.slot_id.trim() : "";
  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";

  // Level 5: max 5 attempts per email per minute (failed attempts count)
  if (email) {
    const ins = await attempts.insertOne({ email, at: new Date() });
    const windowStart = new Date(Date.now() - 60000);
    const recent = await attempts
      .find({ email, at: { $gt: windowStart } })
      .sort({ at: 1, _id: 1 }).toArray();
    const myIndex = recent.findIndex((a) => a._id.equals(ins.insertedId));
    if (myIndex >= 5) {
      await attempts.deleteOne({ _id: ins.insertedId }); // rejected tries don't extend the window
      const wait = Math.ceil((recent[0].at.getTime() + 60000 - Date.now()) / 1000);
      return { status: 429, retryAfter: Math.max(wait, 1), body: { error: "too many attempts, slow down" } };
    }
  }

  // Level 2: validation
  if (!slot_id || !name || !email || !EMAIL_RE.test(email)) {
    return { status: 400, body: { error: "slot_id, name and a valid email are required" } };
  }
  const slot = await slots.findOne({ _id: slot_id });
  if (!slot) return { status: 404, body: { error: "slot not found" } };
  if (slot.startMs <= Date.now()) {
    return { status: 400, body: { error: "slot has already started" } };
  }

  // Level 3: the partial unique index makes the database reject a second confirmed booking
  const booking = {
    id: crypto.randomUUID(), slot_id, name, email,
    status: "confirmed", created_at: new Date(),
  };
  try {
    await bookings.insertOne({ ...booking });
  } catch (e) {
    if (e.code === 11000) return { status: 409, body: { error: "slot already booked" } };
    throw e;
  }
  return { status: 201, body: fmt(booking) };
}

app.post("/bookings", async (req, res) => {
  const key = req.header("Idempotency-Key");
  const raw = req.body && typeof req.body === "object" ? req.body : {};

  try {
    // Level 4: idempotency
    if (key) {
      const hash = crypto.createHash("sha256").update(JSON.stringify(raw)).digest("hex");
      try {
        await idem.insertOne({ key, hash, done: false });
      } catch (e) {
        if (e.code !== 11000) throw e;
        let rec = await idem.findOne({ key });
        for (let i = 0; i < 50 && rec && !rec.done && rec.hash === hash; i++) {
          await sleep(100);
          rec = await idem.findOne({ key });
        }
        if (!rec) return res.status(409).json({ error: "please retry" });
        if (rec.hash !== hash) {
          return res.status(422).json({ error: "Idempotency-Key was used with a different body" });
        }
        if (rec.done) return res.status(rec.status).json(rec.body); // replay
        return res.status(409).json({ error: "request still in progress" });
      }
    }

    const result = await createBooking(raw);

    if (key) {
      if (result.status === 429) await idem.deleteOne({ key }); // allow a later retry
      else await idem.updateOne({ key }, { $set: { done: true, status: result.status, body: result.body } });
    }
    if (result.retryAfter) res.set("Retry-After", String(result.retryAfter));
    res.status(result.status).json(result.body);
  } catch (err) {
    if (key) await idem.deleteOne({ key, done: false }).catch(() => {});
    throw err;
  }
});

// ---------- Level 4: list a person's bookings (cursor pagination) ----------
app.get("/bookings", async (req, res) => {
  const email = String(req.query.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email is required" });

  let limit = 10;
  if (req.query.limit !== undefined) {
    if (!/^\d+$/.test(req.query.limit)) return res.status(400).json({ error: "limit must be 1 to 50" });
    limit = Number(req.query.limit);
    if (limit < 1 || limit > 50) return res.status(400).json({ error: "limit must be 1 to 50" });
  }

  const filter = { email };
  if (req.query.cursor) {
    const [ms, id] = Buffer.from(String(req.query.cursor), "base64url").toString().split("|");
    if (!ms || !id || isNaN(ms)) return res.status(400).json({ error: "invalid cursor" });
    filter.$or = [
      { created_at: { $gt: new Date(Number(ms)) } },
      { created_at: new Date(Number(ms)), id: { $gt: id } },
    ];
  }

  const rows = await bookings.find(filter).sort({ created_at: 1, id: 1 }).limit(limit + 1).toArray();
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const next_cursor = rows.length > limit
    ? Buffer.from(`${last.created_at.getTime()}|${last.id}`).toString("base64url")
    : null;
  res.json({ bookings: page.map(fmt), next_cursor });
});

// ---------- Level 1: one booking ----------
app.get("/bookings/:id", async (req, res) => {
  const b = await bookings.findOne({ id: req.params.id });
  if (!b) return res.status(404).json({ error: "booking not found" });
  res.json(fmt(b));
});

// ---------- Level 3: cancel ----------
app.delete("/bookings/:id", async (req, res) => {
  const b = await bookings.findOneAndUpdate(
    { id: req.params.id },
    { $set: { status: "cancelled" } },
    { returnDocument: "after" }
  );
  if (!b) return res.status(404).json({ error: "booking not found" });
  res.json(fmt(b));
});

// ---------- fallbacks ----------
app.use((req, res) => res.status(404).json({ error: "not found" }));
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status && err.status < 500 ? err.status : 500;
  res.status(status).json({ error: status === 500 ? "server error" : "bad request" });
});

// ---------- start ----------
(async () => {
  await client.connect();
  const db = client.db("clinic");
  slots = db.collection("slots");
  bookings = db.collection("bookings");
  idem = db.collection("idempotency");
  attempts = db.collection("attempts");

  await bookings.createIndex({ slot_id: 1 }, { unique: true, partialFilterExpression: { status: "confirmed" } });
  await bookings.createIndex({ email: 1, created_at: 1, id: 1 });
  await idem.createIndex({ key: 1 }, { unique: true });
  await attempts.createIndex({ email: 1, at: 1 });
  await attempts.createIndex({ at: 1 }, { expireAfterSeconds: 120 });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Running on port ${PORT}`));
})();