
---

## 10. Debugging Log & Lessons Learned

### Issue 1: Schema Mismatch (member_trips vs trips)
**Problem:** Endpoints written for member_trips, but trip_checkins references trips table
**Root Cause:** Two trip tables existed with different schemas; endpoints not validated against actual DB
**Fix:** Use member_trips for now; consolidate to single trips table later
**Lesson:** Always validate endpoint code against actual DB schema BEFORE deployment

### Issue 2: Missing Columns (checkin_interval_hours, safety_status)
**Problem:** Endpoints tried to INSERT into columns that didn't exist
**Root Cause:** Schema migration incomplete; endpoint specs written before schema finalized
**Fix:** ALTER TABLE member_trips to add missing columns
**Lesson:** Schema must be 100% complete before endpoint code is written

### Issue 3: Wrong Column References (traveler_id vs user_id)
**Problem:** Endpoint JOIN used mt.traveler_id but member_trips has user_id
**Root Cause:** Endpoint copied from old code; not validated against member_trips schema
**Fix:** Updated to use user_id
**Lesson:** Always trace foreign keys - never assume column names

### Issue 4: Missing NOT NULL Column (scheduled_return)
**Problem:** trip_checkins.scheduled_return is required but endpoint didn't provide it
**Root Cause:** Endpoint spec not fully read before implementation
**Fix:** Fetch next_checkin_due from member_trips and pass as scheduled_return
**Lesson:** Read error messages - NOT NULL violations tell you what's missing

---

## 11. Going Forward

### Before Writing Any Endpoint Code:
1. [ ] Read the spec for this endpoint
2. [ ] Check the database schema for all tables involved
3. [ ] Verify all column names and types
4. [ ] Check for NOT NULL constraints
5. [ ] Trace all foreign keys
6. [ ] Write SELECT query first to verify table/columns exist
7. [ ] Build INSERT/UPDATE queries
8. [ ] Test locally before Docker
9. [ ] Check logs for actual errors

### Code Review Checklist:
- [ ] Column names match schema exactly
- [ ] All NOT NULL columns provided
- [ ] Foreign keys are correct
- [ ] Error handling includes console.error(err)
- [ ] Response payload matches spec
- [ ] Test case from spec passes

