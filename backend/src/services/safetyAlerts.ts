// Wording for missed-check-in alerts. Pure functions: no database, no clock,
// no sending, so every message can be read and unit tested.
//
// Tone: a missed check-in is usually a flat battery or no signal, not an
// emergency. Contacts are told plainly what happened and what to do, and are
// never told the traveller is in danger, because nobody knows that yet.

export interface OverdueContext {
	travellerName: string;
	destination: string;
	dueAt: Date;
	overdueMinutes: number;
	lastCheckinAt: Date | null;
	// Only ever set when the traveller allows this contact to see their location.
	lastLocation: { lat: number; lng: number; at: Date } | null;
}

const mapLink = (l: { lat: number; lng: number }) => `https://maps.google.com/?q=${l.lat},${l.lng}`;

// Times are given in UTC because the reader may be in any timezone; the
// traveller's own timezone is not known here.
const utc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

const hoursMinutes = (mins: number) => (mins >= 120 ? `${Math.round(mins / 60)} hours` : `${Math.max(1, Math.round(mins))} minutes`);

// To Drift's own safety reviewer (the owner). Contains everything needed to
// decide whether to act.
export function reviewerOverdueMessage(ctx: OverdueContext, contactCount: number, contactsWillBeNotified: boolean): { subject: string; body: string } {
	const lines = [
		`${ctx.travellerName} has missed a safety check-in.`,
		`Trip: ${ctx.destination}`,
		`Check-in was due: ${utc(ctx.dueAt)} (${hoursMinutes(ctx.overdueMinutes)} ago)`,
		`Last check-in: ${ctx.lastCheckinAt ? utc(ctx.lastCheckinAt) : "none yet on this trip"}`,
		ctx.lastLocation ? `Last known location (${utc(ctx.lastLocation.at)}): ${mapLink(ctx.lastLocation)}` : "Last known location: none shared",
		contactCount === 0
			? "Emergency contacts: none set for this traveller."
			: contactsWillBeNotified
				? `Emergency contacts (${contactCount}) will be messaged automatically if this is still unresolved.`
				: `Emergency contacts (${contactCount}) are NOT messaged automatically (automatic contact messaging is switched off): contact them yourself if needed.`,
		"This is often a flat battery or no signal. Please review before escalating.",
	];
	return { subject: `Drift safety: missed check-in (${ctx.travellerName}, ${ctx.destination})`, body: lines.join("\n") };
}

// To one emergency contact.
export function contactOverdueMessage(ctx: OverdueContext): { subject: string; text: string; sms: string } {
	const loc = ctx.lastLocation ? `Last shared location: ${mapLink(ctx.lastLocation)}` : "";
	const text = [
		`${ctx.travellerName} was due to check in on their Drift trip to ${ctx.destination} at ${utc(ctx.dueAt)} and has not.`,
		"This may only mean a flat battery or no signal. If you can, please try to contact them.",
		"If you cannot reach them and are worried, contact the local emergency services.",
		loc,
		"You are receiving this because you are listed as an emergency contact for their trip.",
	].filter(Boolean).join("\n\n");
	const sms = `Drift: ${ctx.travellerName} missed a safety check-in for ${ctx.destination} (due ${utc(ctx.dueAt)}). May be a flat battery. Please try to contact them.${ctx.lastLocation ? ` Last location: ${mapLink(ctx.lastLocation)}` : ""}`.slice(0, 320);
	return { subject: `Drift: ${ctx.travellerName} missed a check-in`, text, sms };
}

// Sent to the same contacts if the traveller checks in after they were alerted.
export function contactAllClearMessage(travellerName: string, destination: string): { subject: string; text: string; sms: string } {
	const text = `Good news: ${travellerName} has now checked in on their Drift trip to ${destination}. No further action is needed.`;
	return { subject: `Drift: ${travellerName} has checked in`, text, sms: `Drift: ${text}`.slice(0, 200) };
}
