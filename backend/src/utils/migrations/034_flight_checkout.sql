-- Migration 034: link a confirmed flight_orders row back to the Duffel
-- Payment Intent that funded it (Payment Intent -> Balance -> Order model,
-- see STAGE-PLAN-10.md / RISK-REGISTER.md R12 for why this is the model
-- Drift is building against instead of plain pre-funded Balance or
-- pass-through Card payments).

ALTER TABLE flight_orders ADD COLUMN IF NOT EXISTS payment_intent_id TEXT;

SELECT 'Migration 034 complete -- flight_orders.payment_intent_id added' AS status;
