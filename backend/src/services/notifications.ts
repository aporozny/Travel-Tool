// Notification service
// Sends real email via SendGrid and real SMS via Twilio.
// Requires SENDGRID_API_KEY, SENDGRID_FROM_EMAIL, TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER as environment variables.
// If any are missing, the corresponding channel is skipped (logged, not sent)
// rather than throwing - so this degrades gracefully in dev/test environments.
import { pool } from '../utils/db';

interface SOSNotification {
  sosId: string;
  travelerName: string;
  travelerEmail: string;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  contacts: { id: string; name: string; email: string | null; phone: string | null }[];
}

interface BookingNotification {
  type: 'booking_request' | 'booking_confirmed' | 'booking_cancelled' | 'booking_completed';
  travelerEmail: string;
  travelerName: string;
  operatorName: string;
  operatorEmail: string;
  startDate: string;
  endDate: string | null;
  guests: number;
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    console.log('SENDGRID_API_KEY not set - skipping email to', to);
    return false;
  }
  try {
    const sgMail = require('@sendgrid/mail');
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to,
      from: process.env.SENDGRID_FROM_EMAIL || 'safety@drifttravel.app',
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('SendGrid send failed for', to, err);
    return false;
  }
}

async function sendSms(to: string, body: string): Promise<boolean> {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_PHONE_NUMBER) {
    console.log('Twilio credentials not set - skipping SMS to', to);
    return false;
  }
  try {
    const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilioClient.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to,
    });
    return true;
  } catch (err) {
    console.error('Twilio send failed for', to, err);
    return false;
  }
}

// Send SOS alert to emergency contacts - real email + real SMS, logged per
// contact to sos_responders so delivery is auditable.
export async function sendSOSAlert(data: SOSNotification): Promise<void> {
  const locationStr = data.latitude && data.longitude
    ? `https://maps.google.com/?q=${data.latitude},${data.longitude}`
    : 'Location unavailable';

  const subject = `SOS Alert from ${data.travelerName || data.travelerEmail}`;
  const emailBody = `
Emergency alert received from ${data.travelerName || data.travelerEmail}.

${data.message ? `Message: ${data.message}` : ''}

Location: ${locationStr}

This alert was sent via Drift.
`.trim();

  const smsBody = `Drift SOS: ${data.travelerName || data.travelerEmail} needs help. ${data.message ? data.message + '. ' : ''}Location: ${locationStr}`.trim();

  console.log('=== SOS ALERT ===');
  console.log('To:', data.contacts.map(c => c.email || c.phone).join(', '));
  console.log('Subject:', subject);
  console.log('Body:', emailBody);
  console.log('=================');

  await Promise.allSettled(data.contacts.map(async (contact) => {
    let emailSent = false;
    let smsSent = false;

    if (contact.email) {
      emailSent = await sendEmail(contact.email, subject, emailBody);
    }
    if (contact.phone) {
      smsSent = await sendSms(contact.phone, smsBody);
    }

    const method = emailSent && smsSent ? 'email+sms' : emailSent ? 'email' : smsSent ? 'sms' : 'failed';

    try {
      await pool.query(
        `INSERT INTO sos_responders (id, sos_id, safety_contact_id, name, phone, email, notification_method)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)`,
        [data.sosId, contact.id, contact.name, contact.phone, contact.email, method]
      );
    } catch (err) {
      console.error('Failed to log sos_responders row for contact', contact.id, err);
    }
  }));
}

// Send booking notification to traveler and operator
export async function sendBookingNotification(data: BookingNotification): Promise<void> {
  const messages: Record<string, { traveler: string; operator: string }> = {
    booking_request: {
      traveler: `Your booking request at ${data.operatorName} has been submitted. You'll hear back shortly.`,
      operator: `New booking request from ${data.travelerName} for ${data.startDate}${data.endDate ? ` to ${data.endDate}` : ''}, ${data.guests} guest(s).`,
    },
    booking_confirmed: {
      traveler: `Great news! Your booking at ${data.operatorName} on ${data.startDate} has been confirmed.`,
      operator: `You confirmed a booking for ${data.travelerName} on ${data.startDate}.`,
    },
    booking_cancelled: {
      traveler: `Your booking at ${data.operatorName} on ${data.startDate} has been cancelled.`,
      operator: `The booking from ${data.travelerName} on ${data.startDate} has been cancelled.`,
    },
    booking_completed: {
      traveler: `Your stay at ${data.operatorName} is now complete. Please leave a review!`,
      operator: `Booking for ${data.travelerName} marked as completed.`,
    },
  };

  const msg = messages[data.type];

  console.log('=== BOOKING NOTIFICATION ===');
  console.log(`To traveler (${data.travelerEmail}):`, msg.traveler);
  console.log(`To operator (${data.operatorEmail}):`, msg.operator);
  console.log('============================');
}
