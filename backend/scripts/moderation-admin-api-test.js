// Admin review, reporting/auto-hold, and author appeal for the moderation pipeline (migration
// 048/049, backend/src/routes/moderationAdmin.ts + community.ts's report/appeal routes). Uses the
// seeded admin (sarah.chen@drifttest.com) plus throwaway travellers, and the real live pipeline
// (Claude) to actually get content held. Cleans up everything. Run inside the backend container:
//   docker cp moderation-admin-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/moderation-admin-api-test.js
const jwt = require("/app/node_modules/jsonwebtoken");
const { pool } = require("/app/dist/utils/db");
const B = "http://localhost:5000/api/v1";

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };
const tok = (u) => jwt.sign({ id: u.id, email: u.email, role: u.role || "traveler" }, process.env.JWT_SECRET, { expiresIn: "10m" });
async function call(method, p, token, body) {
  const r = await fetch(B + p, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let d = null; try { d = await r.json(); } catch {}
  return { s: r.status, d };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForStatus(table, id, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = (await pool.query(`SELECT moderation_status FROM ${table} WHERE id = $1`, [id])).rows[0];
    if (row && row.moderation_status !== "pending") return row.moderation_status;
    await sleep(400);
  }
  return "pending";
}

(async () => {
  const stamp = Date.now();
  const REGION = "ModAdminTest" + stamp;
  const admin = (await pool.query("SELECT id, email, role FROM users WHERE email = 'sarah.chen@drifttest.com'")).rows[0];
  if (!admin) { console.log("Need the seeded admin account sarah.chen@drifttest.com"); process.exit(1); }
  const tAdmin = tok(admin);

  const madeUsers = [];
  const madePosts = [];
  const mkUser = async (label) => {
    const u = (await pool.query("INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'traveler') RETURNING id, email", [`${label}-${stamp}@drifttest.com`])).rows[0];
    await pool.query("INSERT INTO travelers (user_id, first_name, display_name) VALUES ($1, $2, $2)", [u.id, label]);
    madeUsers.push(u.id);
    return u;
  };

  try {
    const author = await mkUser("modadmin-author");
    const traveler = await mkUser("modadmin-traveler");
    const tAuthor = tok(author), tTraveler = tok(traveler);

    // --- 0. Non-admin cannot use the admin routes ------------------------------------------------
    let r = await call("GET", "/admin/moderation/queue", tTraveler);
    ok("a non-admin gets 403 on the moderation queue", r.s === 403, JSON.stringify(r));
    r = await call("POST", "/admin/moderation/post/00000000-0000-0000-0000-000000000000/decide", tTraveler, { verdict: "allow", note: "x" });
    ok("a non-admin gets 403 on decide", r.s === 403, JSON.stringify(r));

    // --- 1. A held post shows up in the admin queue with the pipeline's own reasoning -------------
    r = await call("POST", "/community/posts", tAuthor, { body: "call me on +62 812 3456 7890 for a discount", region: REGION });
    const heldId = r.d?.postId;
    madePosts.push(heldId);
    ok("a post that will be held is created", r.s === 201 && heldId, JSON.stringify(r));
    let status = await waitForStatus("community_posts", heldId, 5000);
    ok("it is held by the rule check", status === "held", status);

    r = await call("GET", "/admin/moderation/queue", tAdmin);
    ok("admin can list the queue", r.s === 200 && Array.isArray(r.d?.items), JSON.stringify(r).slice(0, 150));
    let item = r.d.items.find((i) => i.id === heldId);
    ok("the held post appears in the queue", !!item, JSON.stringify(r.d.items.map((i) => i.id)));
    ok("its categories include phone_number", item?.latestDecision?.categories?.includes("phone_number"), JSON.stringify(item?.latestDecision));
    ok("it carries a reviewer question", typeof item?.latestDecision?.reviewerQuestion === "string" && item.latestDecision.reviewerQuestion.length > 0, JSON.stringify(item?.latestDecision));
    ok("its author name is populated", item?.authorName === "modadmin-author", JSON.stringify(item));

    // --- 2. Deciding requires a note ------------------------------------------------------------
    r = await call("POST", `/admin/moderation/post/${heldId}/decide`, tAdmin, { verdict: "allow" });
    ok("deciding without a note is a 400", r.s === 400, JSON.stringify(r));

    // --- 3. Admin allows it -----------------------------------------------------------------------
    r = await call("POST", `/admin/moderation/post/${heldId}/decide`, tAdmin, { verdict: "allow", note: "false positive, just a real phone tip" });
    ok("admin can allow a held post", r.s === 200 && r.d?.status === "allowed", JSON.stringify(r));
    r = await pool.query("SELECT moderation_status FROM community_posts WHERE id = $1", [heldId]);
    ok("the post's own status is now allowed", r.rows[0]?.moderation_status === "allowed", JSON.stringify(r.rows));
    r = await pool.query("SELECT stage, verdict, reviewer_id FROM moderation_decisions WHERE post_id = $1 ORDER BY created_at DESC LIMIT 1", [heldId]);
    ok("a human_review decision row was written with the admin as reviewer", r.rows[0]?.stage === "human_review" && r.rows[0]?.reviewer_id === admin.id, JSON.stringify(r.rows));
    r = await call("GET", `/community/discover?region=${REGION}&limit=50`, tTraveler);
    const idsIn = (d) => (Array.isArray(d) ? d : d?.posts ?? []).map((p) => p.id);
    ok("the now-allowed post is visible to another member", idsIn(r.d).includes(heldId), JSON.stringify(idsIn(r.d)));

    // --- 4. Admin blocks a different held post -----------------------------------------------------
    r = await call("POST", "/community/posts", tAuthor, { body: "special deal, wire the deposit to my agent first, guaranteed refund", region: REGION });
    const blockCandidateId = r.d?.postId;
    madePosts.push(blockCandidateId);
    await waitForStatus("community_posts", blockCandidateId);
    r = await call("POST", `/admin/moderation/post/${blockCandidateId}/decide`, tAdmin, { verdict: "block", note: "looks like a scam attempt" });
    ok("admin can block a post", r.s === 200 && r.d?.status === "blocked", JSON.stringify(r));
    r = await pool.query("SELECT categories FROM moderation_decisions WHERE post_id = $1 ORDER BY created_at DESC LIMIT 1", [blockCandidateId]);
    ok("a blocked human_review decision still satisfies the categories-required rule (non-empty)", (r.rows[0]?.categories || []).length > 0, JSON.stringify(r.rows));

    // --- 5. Decide on something that doesn't exist is a clean 404 ----------------------------------
    r = await call("POST", "/admin/moderation/post/00000000-0000-0000-0000-000000000000/decide", tAdmin, { verdict: "allow", note: "x" });
    ok("deciding on a made-up id is a 404", r.s === 404, JSON.stringify(r));

    // --- 6. Reporting: three distinct reporters auto-hold an otherwise-clean post -------------------
    r = await call("POST", "/community/posts", tAuthor, { body: "Loved this quiet beach, barely anyone there.", region: REGION });
    const reportTargetId = r.d?.postId;
    madePosts.push(reportTargetId);
    status = await waitForStatus("community_posts", reportTargetId);
    ok("the report-target post starts out allowed (nothing automated flags it)", status === "allowed", status);

    const reporters = await Promise.all([mkUser("modadmin-r1"), mkUser("modadmin-r2"), mkUser("modadmin-r3")]);
    const tReporters = reporters.map(tok);

    r = await call("POST", `/community/posts/${reportTargetId}/report`, tReporters[0], { category: "other", description: "this seems off to me for some reason" });
    ok("first report is accepted", r.s === 201, JSON.stringify(r));
    r = await call("POST", `/community/posts/${reportTargetId}/report`, tReporters[0], { category: "other", description: "reporting again" });
    ok("the same reporter reporting twice is refused (409)", r.s === 409, JSON.stringify(r));
    r = await call("GET", `/community/posts/${reportTargetId}`, tTraveler);
    ok("still allowed after just one report", r.s === 200, JSON.stringify(r).slice(0, 120));

    r = await call("POST", `/community/posts/${reportTargetId}/report`, tReporters[1], { category: "harassment", description: "this made me uncomfortable honestly" });
    ok("second (distinct) report is accepted", r.s === 201, JSON.stringify(r));
    r = await call("POST", `/community/posts/${reportTargetId}/report`, tReporters[2], { category: "scam", description: "pretty sure this is not a real place" });
    ok("third (distinct) report is accepted", r.s === 201, JSON.stringify(r));

    status = await waitForStatus("community_posts", reportTargetId, 5000);
    ok("the post is auto-held after 3 distinct reporters", status === "held", status);
    r = await pool.query("SELECT stage, verdict, categories FROM moderation_decisions WHERE post_id = $1 ORDER BY created_at DESC LIMIT 1", [reportTargetId]);
    ok("the auto-hold decision row is stage='member_reports'", r.rows[0]?.stage === "member_reports", JSON.stringify(r.rows));

    r = await call("GET", "/admin/moderation/queue", tAdmin);
    item = r.d.items.find((i) => i.id === reportTargetId);
    ok("the member-reported post appears in the admin queue with the right reporter count", item?.reporterCount === 3, JSON.stringify(item));

    // A 4th report on an already-held post should not double-queue or error.
    const reporter4 = await mkUser("modadmin-r4");
    r = await call("POST", `/community/posts/${reportTargetId}/report`, tok(reporter4), { category: "other", description: "adding my own report too, for good measure" });
    ok("a 4th report on an already-held post is still accepted", r.s === 201, JSON.stringify(r));
    r = await pool.query("SELECT count(*)::int n FROM moderation_decisions WHERE post_id = $1 AND stage = 'member_reports'", [reportTargetId]);
    ok("only one member_reports decision row exists (no double-queue)", r.rows[0].n === 1, JSON.stringify(r.rows));

    // --- 7. Appeal ------------------------------------------------------------------------------
    r = await call("POST", `/community/posts/${blockCandidateId}/appeal`, tTraveler, { note: "not mine, should fail" });
    ok("a non-author cannot appeal someone else's blocked post", r.s === 404, JSON.stringify(r));
    r = await call("POST", `/community/posts/${blockCandidateId}/appeal`, tAuthor, { note: "" });
    ok("an empty appeal note is a 400", r.s === 400, JSON.stringify(r));
    r = await call("POST", `/community/posts/${heldId}/appeal`, tAuthor, { note: "should fail, already allowed" });
    ok("appealing an already-allowed post is refused", r.s === 400, JSON.stringify(r));
    r = await call("POST", `/community/posts/${blockCandidateId}/appeal`, tAuthor, { note: "this was a genuine offer, please take another look" });
    ok("the real author can appeal their own blocked post", r.s === 201, JSON.stringify(r));
    r = await call("POST", `/community/posts/${blockCandidateId}/appeal`, tAuthor, { note: "asking again" });
    ok("appealing twice in a row is refused", r.s === 409, JSON.stringify(r));
    r = await pool.query("SELECT stage, verdict, categories FROM moderation_decisions WHERE post_id = $1 ORDER BY created_at DESC LIMIT 1", [blockCandidateId]);
    ok("the appeal decision row keeps the same verdict (blocked) rather than inventing a new status", r.rows[0]?.stage === "appeal_requested" && r.rows[0]?.verdict === "blocked", JSON.stringify(r.rows));
    r = await call("GET", "/admin/moderation/queue", tAdmin);
    item = r.d.items.find((i) => i.id === blockCandidateId);
    ok("the appealed post is back in the admin queue", !!item, JSON.stringify(r.d.items.map((i) => i.id)));

    // Admin re-decides the appealed post -- allow it this time.
    r = await call("POST", `/admin/moderation/post/${blockCandidateId}/decide`, tAdmin, { verdict: "allow", note: "on appeal, this reads as a genuine offer" });
    ok("admin can decide an appealed post", r.s === 200 && r.d?.status === "allowed", JSON.stringify(r));
  } finally {
    // --- cleanup -----------------------------------------------------------------------------------
    await pool.query("DELETE FROM safety_reports WHERE reported_post_id = ANY($1::uuid[])", [madePosts]);
    await pool.query("DELETE FROM moderation_decisions WHERE post_id = ANY($1::uuid[])", [madePosts]);
    await pool.query("DELETE FROM community_posts WHERE id = ANY($1::uuid[])", [madePosts]);
    await pool.query("DELETE FROM travelers WHERE user_id = ANY($1::uuid[])", [madeUsers]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [madeUsers]);
    const left = {
      users: (await pool.query("SELECT count(*)::int n FROM users WHERE email LIKE $1", [`%-${stamp}@drifttest.com`])).rows[0]?.n ?? 0,
      posts: (await pool.query("SELECT count(*)::int n FROM community_posts WHERE region = $1", [REGION])).rows[0].n,
    };
    ok("cleanup: no test users or posts left behind", left.users === 0 && left.posts === 0, JSON.stringify(left));
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  await pool.end();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
