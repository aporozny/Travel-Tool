// Notification service
// Currently logs to console - wire up SendGrid or Twilio when ready
// To enable email: npm install @sendgrid/mail
// To enable SMS: npm install twilio

interface SOSNotification {
  travelerName: string;
  travelerEmail: string;
  latitude: number | null;
  longitude: number | null;
  message: string | null;
  contacts: { name: string; email: string | null; phone: string | null }[];
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

// Send SOS alert to emergency contacts
export async function sendSOSAlert(data: SOSNotification): Promise<void> {
  const locationStr = data.latitude && data.longitude
    ? `https://maps.google.com/?q=${data.latitude},${data.longitude}`
    : 'Location unavailable';

  const subject = `🚨 SOS Alert from ${data.travelerName || data.travelerEmail}`;
  const body = `
Emergency alert received from ${data.travelerName || data.travelerEmail}.

${data.message ? `Message: ${data.message}` : ''}

Location: ${locationStr}

This alert was sent via Travel Tool.
`.trim();

  // Log for now - replace with actual email/SMS sending
  console.log('=== SOS ALERT ===');
  console.log('To:', data.contacts.map(c => c.email || c.phone).join(', '));
  console.log('Subject:', subject);
  console.log('Body:', body);
  console.log('=================');

  // When you have SendGrid set up, uncomment and configure:
  // const sgMail = require('@sendgrid/mail');
  // sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  // await Promise.all(data.contacts
  //   .filter(c => c.email)
  //   .map(c => sgMail.send({
  //     to: c.email,
  //     from: 'alerts@travel-tool.com',
  //     subject,
  //     text: body,
  //   }))
  // );

  // When you have Twilio set up, uncomment and configure:
  // const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  // await Promise.all(data.contacts
  //   .filter(c => c.phone)
  //   .map(c => twilio.messages.create({
  //     body: `SOS from ${data.travelerName}: ${locationStr}`,
  //     from: process.env.TWILIO_FROM,
  //     to: c.phone,
  //   }))
  // );
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
