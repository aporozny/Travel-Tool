// API test for the fixes made after the live test-plan check (21 Sep 2026):
// profile preferences, reviews, community posts / reactions / comments / visibility,
// and photo upload. Uses only the seeded @drifttest.com traveller accounts, sends no
// email, and removes everything it creates. Run inside the backend container:
//   docker cp community-fixes-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/community-fixes-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const fs = require("fs");
const path = require("path");
const { pool } = require("/app/dist/utils/db");
const B = "http://localhost:5000/api/v1";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function call(method, p, token, body) {
  const r = await fetch(B + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
}
// A real 1x1 PNG, and a ~1 MB file that starts like a PNG (to prove big uploads get through).
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const BIG = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(1024 * 1024)]);

(async () => {
  const users = (await pool.query("SELECT id, email, role FROM users WHERE email LIKE '%@drifttest.com' AND role = 'traveler' ORDER BY email LIMIT 2")).rows;
  if (users.length < 2) { console.log("Need two seeded traveller accounts"); process.exit(1); }
  const [A, Bu] = users; const tA = tok(A), tB = tok(Bu);
  const madePosts = [], madeFiles = [];

  // --- Profile preferences -------------------------------------------------
  const originalCuisine = (await pool.query("SELECT mp.cuisine_preferences FROM member_preferences mp JOIN travelers t ON t.id = mp.traveler_id WHERE t.user_id = $1", [A.id])).rows[0]?.cuisine_preferences ?? [];
  let r = await call("PATCH", "/travelers/me/preferences", tA, { cuisine_preferences: ["thai", "street food"] });
  ok("PATCH preferences saves and returns the row", r.s === 200 && Array.isArray(r.d?.cuisine_preferences) && r.d.cuisine_preferences.includes("thai"), JSON.stringify(r));
  r = await call("GET", "/travelers/me/preferences", tA);
  ok("GET preferences shows the saved chips", r.s === 200 && r.d?.cuisine_preferences?.includes("street food"), JSON.stringify(r));

  // --- Reviews (used to be 500: no title column) ----------------------------
  r = await call("GET", "/reviews/me", tA);
  ok("GET /reviews/me returns a list", r.s === 200 && Array.isArray(r.d), JSON.stringify(r));
  const op = (await pool.query("SELECT id FROM operators LIMIT 1")).rows[0];
  r = await call("GET", `/reviews/operator/${op.id}`, null);
  ok("GET /reviews/operator/:id returns stats and reviews", r.s === 200 && r.d?.stats && Array.isArray(r.d?.reviews), JSON.stringify(r));

  // --- Photo upload ----------------------------------------------------------
  r = await call("POST", "/community/upload", tA, { data: PNG.toString("base64"), mimeType: "image/png" });
  ok("upload of a real PNG is accepted", r.s === 201 && /^\/uploads\/[0-9a-f-]+\.png$/.test(r.d?.url || ""), JSON.stringify(r));
  const url1 = r.d?.url; if (url1) madeFiles.push(url1);
  r = await call("POST", "/community/upload", tA, { data: BIG.toString("base64"), mimeType: "image/png" });
  ok("a 1 MB upload gets past the JSON size limit (was 413)", r.s === 201, JSON.stringify(r).slice(0, 200));
  if (r.d?.url) madeFiles.push(r.d.url);
  r = await call("POST", "/community/upload", tA, { data: Buffer.from("<html><script>alert(1)</script></html>").toString("base64"), mimeType: "image/png" });
  ok("HTML pretending to be a PNG is refused", r.s === 400, JSON.stringify(r));
  r = await call("POST", "/community/upload", tA, { data: PNG.toString("base64"), mimeType: "image/svg+xml" });
  ok("SVG is refused", r.s === 400, JSON.stringify(r));
  r = await call("POST", "/community/upload", null, { data: PNG.toString("base64"), mimeType: "image/png" });
  ok("upload needs a login", r.s === 401, JSON.stringify(r));
  r = await call("POST", "/travelers/me/preferences", tA, { data: "x".repeat(20000) });
  ok("other routes still keep the small 10 KB limit", r.s === 413, JSON.stringify(r).slice(0, 120));

  // --- Posts: visibility and photo-only -------------------------------------
  r = await call("POST", "/community/posts", tA, { body: "Private note from the API test", visibility: "private" });
  ok("a private post can be created (was 500)", r.s === 201 && r.d?.postId, JSON.stringify(r));
  const privateId = r.d?.postId; if (privateId) madePosts.push(privateId);
  r = await call("POST", "/community/posts", tA, { body: "Public note from the API test", visibility: "public" });
  const publicId = r.d?.postId; if (publicId) madePosts.push(publicId);
  ok("a public post can be created", r.s === 201 && publicId, JSON.stringify(r));
  r = await call("POST", "/community/posts", tA, { mediaUrls: url1 ? [url1] : [], visibility: "public" });
  ok("a photo-only post is created (no text)", r.s === 201 && r.d?.postId, JSON.stringify(r));
  if (r.d?.postId) madePosts.push(r.d.postId);
  r = await call("POST", "/community/posts", tA, { body: "x", mediaUrls: ["http://evil.example/x.png"] });
  ok("a photo URL that did not come from our upload is refused", r.s === 400, JSON.stringify(r));
  r = await call("POST", "/community/posts", tA, { visibility: "public" });
  ok("a post with no text and no photo is refused", r.s === 400, JSON.stringify(r));

  r = await call("GET", `/community/posts/${privateId}`, tA);
  ok("the author can open their private post", r.s === 200, JSON.stringify(r).slice(0, 150));
  r = await call("GET", `/community/posts/${privateId}`, tB);
  ok("another member gets 404 for a private post", r.s === 404, JSON.stringify(r).slice(0, 150));
  r = await call("GET", `/community/posts/${privateId}`, null);
  ok("a signed-out visitor gets 404 for a private post", r.s === 404, JSON.stringify(r).slice(0, 150));
  r = await call("GET", `/community/posts/${publicId}`, null);
  ok("anyone can open a public post", r.s === 200, JSON.stringify(r).slice(0, 150));
  r = await call("GET", "/community/posts/not-a-uuid", tA);
  ok("a malformed post id is a clean 404, not a 500", r.s === 404, JSON.stringify(r));

  // --- Reactions --------------------------------------------------------------
  r = await call("POST", `/community/posts/${publicId}/react`, tB, { reaction: "like" });
  ok("react: first like is added (was 500)", r.s === 200 && r.d?.action === "added", JSON.stringify(r));
  r = await call("GET", `/community/posts/${publicId}`, tB);
  ok("the viewer's own reaction is shown on the post", r.s === 200 && r.d?.my_reaction === "like" && r.d?.reaction_count === 1, JSON.stringify({ s: r.s, my: r.d?.my_reaction, n: r.d?.reaction_count }));
  r = await call("POST", `/community/posts/${publicId}/react`, tB, { reaction: "heart" });
  ok("react: a different reaction replaces the first", r.s === 200 && r.d?.action === "changed", JSON.stringify(r));
  r = await call("POST", `/community/posts/${publicId}/react`, tB, { reaction: "heart" });
  ok("react: the same reaction again removes it", r.s === 200 && r.d?.action === "removed", JSON.stringify(r));
  r = await call("GET", `/community/posts/${publicId}`, tB);
  ok("reaction count is back to 0", r.d?.reaction_count === 0 && r.d?.my_reaction == null, JSON.stringify({ n: r.d?.reaction_count, my: r.d?.my_reaction }));
  r = await call("POST", `/community/posts/${publicId}/react`, tB, { reaction: "party" });
  ok("react: an unknown reaction is a 400", r.s === 400, JSON.stringify(r));
  r = await call("POST", `/community/posts/00000000-0000-4000-8000-000000000000/react`, tB, { reaction: "like" });
  ok("react: a post that does not exist is a 404 (not 500)", r.s === 404, JSON.stringify(r));
  r = await call("POST", `/community/posts/${privateId}/react`, tB, { reaction: "like" });
  ok("react: cannot react to someone else's private post", r.s === 404, JSON.stringify(r));

  // --- Comments ---------------------------------------------------------------
  r = await call("POST", `/community/posts/${publicId}/comments`, tB, { body: "Nice one!" });
  ok("comment: can be added (was 500)", r.s === 201 && r.d?.id, JSON.stringify(r));
  const cid = r.d?.id;
  r = await call("GET", `/community/posts/${publicId}/comments`, null);
  ok("comment: appears in the list with an author", r.s === 200 && r.d?.length === 1 && r.d[0].body === "Nice one!" && r.d[0].author_id === Bu.id, JSON.stringify(r).slice(0, 200));
  r = await call("GET", `/community/posts/${publicId}`, tA);
  ok("the post's comment count went up", r.d?.comment_count === 1, JSON.stringify({ n: r.d?.comment_count }));
  r = await call("POST", `/community/posts/${privateId}/comments`, tB, { body: "Sneaky" });
  ok("comment: cannot comment on someone else's private post", r.s === 404, JSON.stringify(r));
  r = await call("GET", `/community/posts/${privateId}/comments`, tB);
  ok("comment: cannot read comments of someone else's private post", r.s === 404 || (r.s === 200 && r.d.length === 0), JSON.stringify(r));
  r = await call("POST", `/community/posts/${publicId}/comments`, tB, { body: "" });
  ok("comment: an empty comment is a 400", r.s === 400, JSON.stringify(r));
  r = await call("DELETE", `/community/posts/${publicId}/comments/${cid}`, tA);
  ok("comment: someone else cannot delete it", r.s === 404, JSON.stringify(r));
  r = await call("DELETE", `/community/posts/${publicId}/comments/${cid}`, tB);
  ok("comment: its author can delete it", r.s === 200, JSON.stringify(r));
  r = await call("GET", `/community/posts/${publicId}/comments`, null);
  ok("comment: deleted comment no longer listed", r.s === 200 && r.d.length === 0, JSON.stringify(r));

  // --- Discover shows the signed-in viewer's own reaction ----------------------
  await call("POST", `/community/posts/${publicId}/react`, tB, { reaction: "fire" });
  r = await call("GET", "/community/discover?limit=50", tB);
  const mine = (r.d || []).find((p) => p.id === publicId);
  ok("discover: signed-in viewer sees their own reaction", r.s === 200 && mine?.my_reaction === "fire", JSON.stringify({ s: r.s, found: !!mine, my: mine?.my_reaction }));

  // --- Cleanup -----------------------------------------------------------------
  if (madePosts.length) {
    await pool.query("DELETE FROM post_media WHERE post_id = ANY($1::uuid[])", [madePosts]);
    await pool.query("DELETE FROM community_posts WHERE id = ANY($1::uuid[])", [madePosts]); // reactions/comments cascade
  }
  for (const u of madeFiles) { try { fs.unlinkSync(path.join(process.env.UPLOAD_DIR || "/app/uploads", path.basename(u))); } catch {} }
  await pool.query("UPDATE member_preferences SET cuisine_preferences = $2 WHERE traveler_id = (SELECT id FROM travelers WHERE user_id = $1)", [A.id, originalCuisine]);

  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("SCRIPT ERROR", e); process.exit(2); });
