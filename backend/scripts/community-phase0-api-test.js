// Phase 0 of the traveller-blog plan: photo metadata stripping, block enforcement
// on community reads, and per-member rate limits. Uses throwaway users (created and
// deleted here), touches nothing else, and removes everything it makes. Run inside
// the backend container:
//   docker cp community-phase0-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/community-phase0-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const sharp = require("/app/node_modules/sharp");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("/app/dist/utils/db");
const B = "http://localhost:5000/api/v1";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "/app/uploads";
const REGION = "P0TestRegion" + Date.now();

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: "traveler" }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function call(method, p, token, body) {
  const r = await fetch(B + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
}
const upload = (t, buf, mime) => call("POST", "/community/upload", t, { data: buf.toString("base64"), mimeType: mime });
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

(async () => {
  const stamp = Date.now();
  const made = [];
  for (let i = 0; i < 6; i++) {
    const r = await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'traveler') RETURNING id, email", [`p0test-${stamp}-${i}@drifttest.com`]);
    made.push(r.rows[0]);
  }
  const [A, Bu, C, RP, RC, RU] = made;
  const [tA, tB, tC, tRP, tRC, tRU] = made.map(tok);
  const filesBefore = fs.readdirSync(UPLOAD_DIR).length;
  const madeFiles = [];

  try {
    // --- 1. Photo metadata is stripped --------------------------------------
    const noise = crypto.randomBytes(40 * 20 * 3);
    const src = await sharp(noise, { raw: { width: 40, height: 20, channels: 3 } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "33/1 51/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "151/1 12/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const srcMeta = await sharp(src).metadata();
    ok("precondition: the test JPEG really carries EXIF with GPS", !!srcMeta.exif && src.includes(Buffer.from("GPS")) || src.includes(Buffer.from("Exif")), JSON.stringify(srcMeta).slice(0, 200));
    ok("precondition: the test JPEG is marked rotated (orientation 6)", srcMeta.orientation === 6, String(srcMeta.orientation));

    let r = await upload(tA, src, "image/jpeg");
    ok("a JPEG with GPS EXIF is accepted", r.s === 201 && /\.jpg$/.test(r.d?.url || ""), JSON.stringify(r));
    if (r.d?.url) {
      madeFiles.push(r.d.url);
      const file = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(r.d.url)));
      const m = await sharp(file).metadata();
      ok("stored file has no EXIF block", !m.exif, "exif length " + m.exif?.length);
      ok("stored file has no XMP / ICC / IPTC", !m.xmp && !m.iptc, JSON.stringify({ xmp: !!m.xmp, iptc: !!m.iptc }));
      ok("stored bytes contain no 'Exif' or GPS marker", !file.includes(Buffer.from("Exif")) && !file.includes(Buffer.from("GPSLatitude")) && !file.includes(Buffer.from("secret-owner")));
      ok("rotation was applied to the pixels (40x20 became 20x40) and the flag cleared", m.width === 20 && m.height === 40 && (m.orientation === undefined || m.orientation === 1), `${m.width}x${m.height} o=${m.orientation}`);
    }
    r = await upload(tA, await sharp(noise, { raw: { width: 40, height: 20, channels: 3 } }).webp().withExif({ IFD0: { Copyright: "secret-owner" } }).toBuffer(), "image/webp");
    ok("a WebP with EXIF is accepted", r.s === 201, JSON.stringify(r));
    if (r.d?.url) {
      madeFiles.push(r.d.url);
      const file = fs.readFileSync(path.join(UPLOAD_DIR, path.basename(r.d.url)));
      ok("stored WebP has no EXIF", !(await sharp(file).metadata()).exif && !file.includes(Buffer.from("secret-owner")));
    }
    r = await upload(tA, TINY_PNG, "image/png");
    ok("a plain PNG still works", r.s === 201, JSON.stringify(r));
    if (r.d?.url) madeFiles.push(r.d.url);

    r = await upload(tA, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("not really a jpeg at all")]), "image/jpeg");
    ok("bytes that only start like a JPEG are refused (cannot be decoded)", r.s === 400, JSON.stringify(r));
    r = await upload(tA, Buffer.concat([TINY_PNG.subarray(0, 8), Buffer.alloc(2000)]), "image/png");
    ok("a fake PNG header with junk after it is refused", r.s === 400, JSON.stringify(r));
    r = await upload(tA, Buffer.from("....ftypheic....."), "image/heic");
    ok("HEIC is refused with a clear message (cannot be safely stripped)", r.s === 400 && /JPEG, PNG or WebP/.test(r.d?.message || ""), JSON.stringify(r));

    // --- 2. Blocks are enforced on reads ------------------------------------
    const post = async (t, body) => (await call("POST", "/community/posts", t, { body, region: REGION })).d?.postId;
    const pA = await post(tA, "P0 test post by A");
    const pB = await post(tB, "P0 test post by B");
    const pC = await post(tC, "P0 test post by C");
    ok("test posts were created", !!pA && !!pB && !!pC, JSON.stringify({ pA, pB, pC }));
    const idsIn = (d) => (Array.isArray(d) ? d : d?.posts ?? []).map((p) => p.id);

    r = await call("GET", `/community/discover?region=${REGION}&limit=50`, tB);
    ok("before a block: B sees A's post in discover", idsIn(r.d).includes(pA), JSON.stringify(r).slice(0, 200));
    r = await call("GET", `/community/posts/${pA}`, tB);
    ok("before a block: B can open A's post", r.s === 200, JSON.stringify(r).slice(0, 120));
    // one comment each on C's post, before any block
    const cA = (await call("POST", `/community/posts/${pC}/comments`, tA, { body: "comment by A" })).d?.id;
    const cB = (await call("POST", `/community/posts/${pC}/comments`, tB, { body: "comment by B" })).d?.id;
    const cC = (await call("POST", `/community/posts/${pC}/comments`, tC, { body: "comment by C" })).d?.id;
    ok("three comments were placed on C's post", !!cA && !!cB && !!cC);

    r = await call("POST", `/members/${Bu.id}/block`, tA);
    ok("A blocks B through the real API", r.s === 204, JSON.stringify(r));

    r = await call("GET", `/community/discover?region=${REGION}&limit=50`, tB);
    ok("B no longer sees A's post in discover", !idsIn(r.d).includes(pA) && idsIn(r.d).includes(pB) && idsIn(r.d).includes(pC), JSON.stringify(idsIn(r.d)));
    r = await call("GET", `/community/discover?region=${REGION}&limit=50`, tA);
    ok("A no longer sees B's post in discover (blocks hide both ways)", !idsIn(r.d).includes(pB) && idsIn(r.d).includes(pA) && idsIn(r.d).includes(pC), JSON.stringify(idsIn(r.d)));
    r = await call("GET", `/community/discover?region=${REGION}&limit=50`, null);
    ok("a signed-out visitor still sees everyone (no viewer, no block)", idsIn(r.d).includes(pA) && idsIn(r.d).includes(pB), JSON.stringify(idsIn(r.d)));
    r = await call("GET", `/community/feed?region=${REGION}&limit=50`, tB);
    ok("B's feed no longer contains A's post", r.s === 200 && !idsIn(r.d).includes(pA), JSON.stringify(idsIn(r.d)));
    r = await call("GET", `/community/feed?region=${REGION}&limit=50`, tC);
    ok("an unrelated member's feed still has both", idsIn(r.d).includes(pA) && idsIn(r.d).includes(pB), JSON.stringify(idsIn(r.d)));

    r = await call("GET", `/community/posts/${pA}`, tB);
    ok("B opening A's post by id is now a 404", r.s === 404, JSON.stringify(r).slice(0, 120));
    r = await call("GET", `/community/posts/${pB}`, tA);
    ok("A opening B's post by id is a 404 too", r.s === 404, JSON.stringify(r).slice(0, 120));
    r = await call("GET", `/community/posts/${pA}`, tC);
    ok("an unrelated member can still open A's post", r.s === 200, JSON.stringify(r).slice(0, 120));
    r = await call("GET", `/community/posts?memberId=${A.id}`, tB);
    ok("B viewing A's profile posts gets none", r.s === 200 && Array.isArray(r.d) && r.d.length === 0, JSON.stringify(r).slice(0, 160));
    r = await call("GET", `/community/posts?memberId=${A.id}`, tC);
    ok("an unrelated member viewing A's profile posts sees them", r.s === 200 && r.d.length >= 1, JSON.stringify(r).slice(0, 160));

    r = await call("POST", `/community/posts/${pA}/react`, tB, { reaction: "like" });
    ok("B cannot react to A's post", r.s === 404, JSON.stringify(r));
    r = await call("POST", `/community/posts/${pA}/comments`, tB, { body: "should not land" });
    ok("B cannot comment on A's post", r.s === 404, JSON.stringify(r));

    r = await call("GET", `/community/posts/${pC}/comments`, tA);
    const texts = (r.d || []).map((c) => c.body);
    ok("on C's post, A sees A and C but not B's comment", texts.includes("comment by A") && texts.includes("comment by C") && !texts.includes("comment by B"), JSON.stringify(texts));
    r = await call("GET", `/community/posts/${pC}/comments`, tB);
    const textsB = (r.d || []).map((c) => c.body);
    ok("on C's post, B sees B and C but not A's comment", textsB.includes("comment by B") && textsB.includes("comment by C") && !textsB.includes("comment by A"), JSON.stringify(textsB));
    r = await call("GET", `/community/posts/${pC}/comments`, tC);
    ok("C sees all three comments", (r.d || []).length === 3, JSON.stringify((r.d || []).map((c) => c.body)));

    r = await call("DELETE", `/members/${Bu.id}/block`, tA);
    ok("A unblocks B", r.s === 204, JSON.stringify(r));
    r = await call("GET", `/community/posts/${pA}`, tB);
    ok("after unblocking, B can open A's post again", r.s === 200, JSON.stringify(r).slice(0, 120));

    // --- 3. Rate limits (per member, not per network) ------------------------
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await call("POST", "/community/posts", tRP, { body: `rate test ${i}`, region: REGION })).s);
    ok("post limit: the first 10 posts in an hour go through", statuses.slice(0, 10).every((s) => s === 201), JSON.stringify(statuses));
    ok("post limit: the 11th is refused with 429", statuses[10] === 429, JSON.stringify(statuses));
    r = await call("POST", "/community/posts", tRP, { body: "again", region: REGION });
    ok("the refusal carries a readable message", r.s === 429 && /posting very quickly/i.test(r.d?.message || ""), JSON.stringify(r));
    r = await call("POST", "/community/posts", tRC, { body: "a different member is unaffected", region: REGION });
    ok("post limit is per member: another member can still post", r.s === 201, JSON.stringify(r));

    const cs = [];
    for (let i = 0; i < 31; i++) cs.push((await call("POST", `/community/posts/${pC}/comments`, tRC, { body: `c${i}` })).s);
    ok("comment limit: the first 30 in an hour go through", cs.slice(0, 30).every((s) => s === 201), JSON.stringify(cs));
    ok("comment limit: the 31st is refused with 429", cs[30] === 429, JSON.stringify(cs));

    const us = [];
    for (let i = 0; i < 21; i++) {
      const u = await upload(tRU, TINY_PNG, "image/png");
      us.push(u.s);
      if (u.d?.url) madeFiles.push(u.d.url);
    }
    ok("upload limit: the first 20 in an hour go through", us.slice(0, 20).every((s) => s === 201), JSON.stringify(us));
    ok("upload limit: the 21st is refused with 429", us[20] === 429, JSON.stringify(us));
  } finally {
    // --- cleanup ---------------------------------------------------------------
    const ids = made.map((u) => u.id);
    const posts = (await pool.query("SELECT id FROM community_posts WHERE author_id = ANY($1::uuid[])", [ids])).rows.map((x) => x.id);
    await pool.query("DELETE FROM post_media WHERE post_id = ANY($1::uuid[])", [posts]);
    await pool.query("DELETE FROM community_posts WHERE id = ANY($1::uuid[])", [posts]); // comments/reactions cascade
    await pool.query("DELETE FROM post_comments WHERE user_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM post_reactions WHERE user_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM user_blocks WHERE blocker_id = ANY($1::uuid[]) OR blocked_id = ANY($1::uuid[])", [ids]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [ids]);
    for (const u of madeFiles) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(u))); } catch {} }
    const left = {
      users: (await pool.query("SELECT count(*)::int n FROM users WHERE email LIKE $1", [`p0test-${stamp}-%`])).rows[0].n,
      posts: (await pool.query("SELECT count(*)::int n FROM community_posts WHERE region = $1", [REGION])).rows[0].n,
      files: fs.readdirSync(UPLOAD_DIR).length - filesBefore,
    };
    ok("cleanup: no test users, posts or files left behind", left.users === 0 && left.posts === 0 && left.files === 0, JSON.stringify(left));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
