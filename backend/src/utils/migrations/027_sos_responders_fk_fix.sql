-- Migration 027: sos_responders.safety_contact_id ON DELETE SET NULL
--
-- DELETE /safety/contacts/:id was failing with a foreign key violation once
-- a contact had actually been notified for an SOS (i.e. the system was
-- working correctly). The audit row in sos_responders already denormalizes
-- name/phone/email/notification_method, so it remains meaningful even if
-- the contact is later deleted - it should just lose the link, not block
-- the delete or vanish.

ALTER TABLE sos_responders DROP CONSTRAINT sos_responders_safety_contact_id_fkey;
ALTER TABLE sos_responders ADD CONSTRAINT sos_responders_safety_contact_id_fkey
  FOREIGN KEY (safety_contact_id) REFERENCES safety_contacts(id) ON DELETE SET NULL;
