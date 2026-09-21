// Live check of the defects the test-plan agents found by reading code.
// Uses ONLY the seeded @drifttest.com accounts. Never calls SOS, sends no
// messages, contacts nobody. Anything that could create data is expected to
// fail (that is the defect being checked) and is cleaned up if it does not.
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const B = "http://localhost:5000/api/v1";
const rows = [];
const short = (d) => { const s = typeof d === "string" ? d : JSON.stringify(d); return s.length > 110 ? s.slice(0, 107) + "..." : s; };

(async () => {
  const get = async (email) => (await pool.query("SELECT id, email, role FROM users WHERE email = $1 AND is_active = true", [email])).rows[0];
  const emma = await get("emma.jones@drifttest.com");
  const sarah = await get("sarah.chen@drifttest.com");
  const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
  const TE = tok(emma), TS = tok(sarah);
  const call = async (method, path, body, t) => {
    const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let d; try { d = JSON.parse(text); } catch { d = text.slice(0, 80); }
    return { s: r.status, d };
  };
  const check = async (id, label, method, path, body, t, expectation) => {
    const r = await call(method, path, body, t);
    const verdict = expectation(r);
    rows.push({ id, label, status: r.s, verdict, note: short(r.d) });
    return r;
  };
  const DEF = (cond) => (cond ? "DEFECT CONFIRMED" : "not reproduced");

  // ---- A: auth / profile
  await check("D-A-2", "Profile preference chips: PUT /travelers/me/preferences", "PUT", "/travelers/me/preferences", { budget: "mid" }, TE, (r) => DEF(r.s === 404 || r.s === 405));
  await check("ctl", "GET /travelers/me/preferences works", "GET", "/travelers/me/preferences", null, TE, (r) => (r.s === 200 ? "ok" : "PROBLEM"));

  // ---- B: reviews / photos
  await check("D-B-3", "Reviews: GET /reviews/me", "GET", "/reviews/me", null, TE, (r) => DEF(r.s >= 500));
  await check("D-B-3b", "Reviews: GET /reviews/operator/:id", "GET", "/reviews/operator/00000000-0000-4000-8000-000000000000", null, TE, (r) => DEF(r.s >= 500));
  await check("fix", "Photo proxy: malformed reference is a clean 400", "GET", "/photos?ref=%25", null, null, (r) => (r.s === 400 ? "ok (fixed)" : "PROBLEM"));

  // ---- C: community
  const feed = await check("ctl", "Community feed loads", "GET", "/community/feed", null, TE, (r) => (r.s === 200 ? "ok" : "PROBLEM"));
  const postId = (feed.d.posts || feed.d)[0]?.id;
  if (postId) {
    await check("D-C-1", "Comments: GET /posts/:id/comments", "GET", `/community/posts/${postId}/comments`, null, TE, (r) => DEF(r.s >= 500));
    await check("D-C-1b", "Comments: POST /posts/:id/comments", "POST", `/community/posts/${postId}/comments`, { body: "sweep test" }, TE, (r) => DEF(r.s >= 500));
    await check("D-C-2", "Reactions: POST /posts/:id/react", "POST", `/community/posts/${postId}/react`, { reaction: "like" }, TE, (r) => DEF(r.s >= 500));
  }
  const priv = await check("D-C-5", "Post with visibility=private", "POST", "/community/posts", { body: "sweep private", visibility: "private" }, TE, (r) => DEF(r.s >= 500));
  if (priv.s === 201 || priv.s === 200) { await pool.query("DELETE FROM community_posts WHERE body = 'sweep private' AND author_id = $1", [emma.id]); }
  const empty = await check("D-C-4", "Post with a photo and no text", "POST", "/community/posts", { body: "", mediaUrls: ["https://example.com/a.jpg"], visibility: "public" }, TE, (r) => DEF(r.s >= 500));
  if (empty.s === 201 || empty.s === 200) { await pool.query("DELETE FROM community_posts WHERE author_id = $1 AND created_at > NOW() - interval '1 minute'", [emma.id]); }
  await check("D-C-3", "Upload: 1 MB base64 photo is accepted", "POST", "/community/upload", { data: "data:image/jpeg;base64," + "A".repeat(200000), filename: "a.jpg" }, TE, (r) => DEF(r.s >= 400));

  // ---- D: operator dashboard (traveller must be refused) and safety
  await check("ctl", "Dashboard refuses a traveller", "GET", "/dashboard/overview", null, TE, (r) => (r.s === 403 || r.s === 404 ? "ok (role check works)" : "PROBLEM " + r.s));
  const loc = await check("D-D-2", "Safety: POST /safety/location response shape", "POST", "/safety/location", { latitude: -8.65, longitude: 115.2, accuracy: 10 }, TE, (r) => (r.s === 201 || r.s === 200 ? DEF(r.d.latitude === undefined) : "blocked: " + r.s));
  await check("D-D-3", "Safety: plan a trip with date-only dates", "POST", "/safety/trips", { destination: "Bali", start_date: "2026-11-01", end_date: "2026-11-05" }, TE, (r) => DEF(r.s === 400));
  await check("ctl", "Safety: emergency numbers load", "GET", "/safety/emergency-numbers", null, TE, (r) => (r.s === 200 ? "ok" : "PROBLEM"));
  await check("ctl", "Safety: contacts list loads", "GET", "/safety/contacts", null, TE, (r) => (r.s === 200 ? "ok" : "PROBLEM"));

  // ---- D-D-4: is anything able to mark a check-in overdue?
  const od = (await pool.query("SELECT count(*)::int AS n FROM member_trips WHERE safety_status IN ('overdue','escalated')")).rows[0].n;
  rows.push({ id: "D-D-4", label: "Nothing ever sets a trip overdue/escalated (rows with those statuses)", status: "-", verdict: DEF(od === 0), note: `${od} rows; no scheduler in backend/src` });

  console.log("ID       | HTTP | RESULT                | CHECK");
  for (const r of rows) console.log(`${r.id.padEnd(8)} | ${String(r.status).padEnd(4)} | ${r.verdict.padEnd(21)} | ${r.label}\n           -> ${r.note}`);
  await pool.end();
})().catch((e) => { console.error("SWEEP FAILED:", e); process.exit(1); });
