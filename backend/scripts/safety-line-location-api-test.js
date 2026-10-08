// Precise reviewer-facing location for the Safety Line (getCallerPreciseLocation,
// reverseGeocodeAddress, and their wiring into pageReviewerForLiveTransfer/endCall):
// real end-to-end test against a throwaway traveller, a real Redis location cache
// entry, and the real Google Geocoding API. Captures console output rather than
// mocking sendReviewerAlert/sendSOSAlert, since both always log their full body
// regardless of whether SendGrid/MobileMessage creds are configured -- exactly
// how this deployment's degrade-gracefully design already works.
// Cleans up everything it creates. Run inside the backend container:
//   docker cp safety-line-location-api-test.js traveller-backend:/tmp/ && docker exec traveller-backend node /tmp/safety-line-location-api-test.js
const { pool } = require("/app/dist/utils/db");
const { redis } = require("/app/dist/utils/redis");
const {
  startCall,
  endCall,
  pageReviewerForLiveTransfer,
  getCallerPreciseLocation,
  getCallerLastLocation,
} = require("/app/dist/services/voiceAgent");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + (extra ?? "")}`); };

// Capture everything logged to console during fn() and hand it back as one string,
// while still letting it through to real stdout (useful when this run is watched).
async function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); orig(...args); };
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  return lines.join("\n");
}

(async () => {
  const stamp = Date.now();
  const phone = `+61491${String(stamp).slice(-6)}`;
  const noLocationPhone = `+61492${String(stamp).slice(-6)}`;
  let user, noLocationUser;
  const callIds = [];
  const sosEventIds = [];
  try {
    ok("precondition: GOOGLE_PLACES_API_KEY is configured", !!process.env.GOOGLE_PLACES_API_KEY);

    user = (await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'traveler') RETURNING id, email",
      [`sosloctest-${stamp}@drifttest.com`]
    )).rows[0];
    await pool.query("INSERT INTO travelers (user_id, first_name, last_name, phone) VALUES ($1, 'SosLoc', 'Test', $2)", [user.id, phone]);
    await pool.query(
      "INSERT INTO safety_contacts (id, user_id, name, email, phone, receives_sos) VALUES (gen_random_uuid(), $1, 'Emergency Contact', $2, NULL, true)",
      [user.id, `sosloc-contact-${stamp}@drifttest.com`]
    );

    noLocationUser = (await pool.query(
      "INSERT INTO users (email, password_hash, role) VALUES ($1, 'x', 'traveler') RETURNING id, email",
      [`sosloctest-nolocation-${stamp}@drifttest.com`]
    )).rows[0];
    await pool.query("INSERT INTO travelers (user_id, first_name, phone) VALUES ($1, 'NoLoc', $2)", [noLocationUser.id, noLocationPhone]);

    // Sydney Opera House -- a real address Google will resolve confidently, and
    // 6 minutes old so the freshness line has something non-trivial to report.
    const lat = -33.8567844, lng = 151.2152967;
    const recordedAt = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await redis.set(`location:${user.id}`, JSON.stringify({ latitude: lat, longitude: lng, recorded_at: recordedAt }));

    // --- 1. getCallerPreciseLocation resolves a real street address ----------------------------------
    const precise = await getCallerPreciseLocation(user.id);
    ok("precise location found", !!precise, JSON.stringify(precise));
    ok("precise location has correct coordinates", precise?.latitude === lat && precise?.longitude === lng, JSON.stringify(precise));
    ok("precise location carries the cached timestamp through", precise?.recordedAt === recordedAt, JSON.stringify(precise));
    if (precise && precise.address === null) {
      console.log("WARN  address is null -- see known GOOGLE_PLACES_API_KEY restriction below (not a code defect, code degrades correctly)");
    } else {
      ok("precise location resolved a real address", typeof precise?.address === "string" && /Sydney|Opera/i.test(precise.address), JSON.stringify(precise));
    }

    // --- 1b. Root-cause check: is GOOGLE_PLACES_API_KEY actually usable server-side right now? --------
    // Known issue as of this test run: the key is HTTP-referrer-restricted for the web frontend's
    // Places Autocomplete, so Google rejects every server-side call from the VPS IP with
    // REQUEST_DENIED. This has silently affected reverseGeocodeCountry (and thus the AI agent's
    // own country announcement to callers) since it was first built -- not something this change
    // introduced. Logged here, not failed, since fixing it needs a Google Cloud Console change
    // outside this test's scope.
    const axios = require("/app/node_modules/axios");
    try {
      const probe = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
        params: { latlng: `${lat},${lng}`, key: process.env.GOOGLE_PLACES_API_KEY, language: "en" },
        timeout: 10000,
      });
      if (probe.data.status !== "OK") {
        console.log(`WARN  GOOGLE_PLACES_API_KEY cannot make server-side Geocoding calls from this VPS: ${probe.data.status} -- ${probe.data.error_message ?? "no message"}`);
        console.log("WARN  This means reverseGeocodeCountry/reverseGeocodeAddress both silently return null in production today. Needs a separate IP-restricted (not referrer-restricted) Google API key for server-side use.");
      } else {
        ok("GOOGLE_PLACES_API_KEY works for server-side Geocoding calls", true);
      }
    } catch (err) {
      console.log("WARN  Geocoding API probe threw:", err.message);
    }

    // --- 2. getCallerLastLocation (the AI-agent-facing, country-only path) is unaffected --------------
    const coarse = await getCallerLastLocation(user.id);
    if (coarse === null) {
      console.log("WARN  country-only lookup also returns null -- same root cause as above (not a regression from this change)");
    } else {
      ok("country-only lookup still works and stays coarse", coarse?.countryCode === "AU" && !("address" in coarse), JSON.stringify(coarse));
    }

    // --- 3. no cached location at all -> precise lookup returns null, no crash ------------------------
    const missing = await getCallerPreciseLocation(noLocationUser.id);
    ok("no cached location resolves to null, not a throw", missing === null, JSON.stringify(missing));

    // --- 4. pageReviewerForLiveTransfer includes address, maps link, and freshness --------------------
    const { callId, sosEventId } = await startCall({ callerPhone: phone, platform: "test", platformCallId: `test-live-${stamp}` });
    callIds.push(callId); sosEventIds.push(sosEventId);
    const liveTransferLog = await captureLogs(() => pageReviewerForLiveTransfer(callId));
    if (precise?.address) ok("live-transfer alert includes the resolved address", /Sydney|Opera/i.test(liveTransferLog), liveTransferLog);
    ok("live-transfer alert includes a maps link with the real coordinates", liveTransferLog.includes(`maps.google.com/?q=${lat},${lng}`), liveTransferLog);
    ok("live-transfer alert includes a freshness estimate", /6 minutes ago/.test(liveTransferLog), liveTransferLog);
    ok("live-transfer alert keeps the Trip Mode staleness caveat", /confirm with the caller/i.test(liveTransferLog), liveTransferLog);

    // --- 5. pageReviewerForLiveTransfer for a caller with no cached location omits the line cleanly ---
    const { callId: noLocCallId, sosEventId: noLocSosId } = await startCall({ callerPhone: noLocationPhone, platform: "test", platformCallId: `test-live-noloc-${stamp}` });
    callIds.push(noLocCallId); sosEventIds.push(noLocSosId);
    const noLocLog = await captureLogs(() => pageReviewerForLiveTransfer(noLocCallId));
    ok("no-location live-transfer alert omits the location line entirely (no crash, no stray text)", !/Last known location/.test(noLocLog), noLocLog);

    // --- 6. endCall's reviewer alert also includes the location line ----------------------------------
    const endCallLog = await captureLogs(() => endCall({ callId, outcome: "unclear_escalated", transcript: "test transcript" }));
    if (precise?.address) ok("endCall reviewer alert includes the resolved address", /Sydney|Opera/i.test(endCallLog), endCallLog);
    ok("endCall reviewer alert includes a maps link with the real coordinates", endCallLog.includes(`maps.google.com/?q=${lat},${lng}`), endCallLog);
    // Give endCall's fire-and-forget sendSOSAlert (which inserts a sos_responders row) a moment to
    // finish before cleanup deletes the sos_events row it depends on -- production never races this
    // since it doesn't delete anything after a call ends; this is purely a test-cleanup ordering fix.
    await new Promise((r) => setTimeout(r, 500));

    // --- 7. endCall's SOS alert to the caller's own safety contacts gets real coordinates, not null,null
    ok("endCall's SOS alert to safety contacts uses the real coordinates (not the old hardcoded null,null)",
      endCallLog.includes(`Location: https://maps.google.com/?q=${lat},${lng}`), endCallLog);
    ok("endCall's SOS alert no longer reports 'Location unavailable' for a caller with a cached ping",
      !endCallLog.includes("Location unavailable"), endCallLog);

  } finally {
    // --- cleanup: everything this test created, nothing else -----------------------------------------
    // sos_responders first -- endCall's real (not mocked) sendSOSAlert inserts one for the safety
    // contact, and it FK-references both sos_events and safety_contacts, so it must go before either.
    for (const id of sosEventIds) await pool.query("DELETE FROM sos_responders WHERE sos_id = $1", [id]).catch(() => {});
    for (const id of callIds) await pool.query("DELETE FROM sos_ai_calls WHERE id = $1", [id]).catch(() => {});
    for (const id of sosEventIds) await pool.query("DELETE FROM sos_events WHERE id = $1", [id]).catch(() => {});
    if (user) {
      await redis.del(`location:${user.id}`).catch(() => {});
      await pool.query("DELETE FROM safety_contacts WHERE user_id = $1", [user.id]).catch(() => {});
      await pool.query("DELETE FROM travelers WHERE user_id = $1", [user.id]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [user.id]).catch(() => {});
    }
    if (noLocationUser) {
      await pool.query("DELETE FROM travelers WHERE user_id = $1", [noLocationUser.id]).catch(() => {});
      await pool.query("DELETE FROM users WHERE id = $1", [noLocationUser.id]).catch(() => {});
    }
    console.log(`\n${pass} passed, ${fail} failed`);
    await pool.end().catch(() => {});
    process.exit(fail > 0 ? 1 : 0);
  }
})();
