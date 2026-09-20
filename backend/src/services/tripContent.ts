import { formatLocal, type PresentedRequirement } from "./tripSchedule";

// What each trip message says. Pure: takes plain data, returns subject, text,
// html and a short in-app version. Nothing here reads the database or the
// clock, so every message can be checked in a unit test.
//
// Rules the wording follows:
// - Times are the local time on the clock at that airport, as stored. Nothing
//   is shifted into another timezone.
// - Entry rules only appear if a person has checked them recently (see
//   presentRequirement); otherwise the traveller is pointed at the official
//   source. No gate or terminal is ever stated: there is no live data yet.
// - Service messages only. No offers and no marketing.
// - No passport numbers, ever.

export interface SegmentRow {
	id: string;
	order_id: string;
	source: string;
	kind: "flight" | "hotel";
	leg_index: number;
	carrier: string | null;
	flight_numbers: string[] | null;
	origin_iata: string | null;
	dest_iata: string | null;
	origin_city: string | null;
	dest_city: string | null;
	dest_country: string | null;
	dep_local: string;
	arr_local: string | null;
	place_name: string | null;
	address: string | null;
	reference: string | null;
	is_test: boolean;
}

export type MessageType = "confirmation" | "ticketed" | "pre_7d" | "pre_72h" | "pre_24h" | "pre_3h" | "hotel_checkin";

export interface RenderInput {
	type: MessageType;
	segment: SegmentRow; // the leg or stay this message is about
	legs: SegmentRow[]; // every leg or stay on the same booking, in order
	orderStatus: string; // held | ticketed | confirmed | ...
	supplierReference: string | null;
	requirements: PresentedRequirement[];
	manageUrl: string;
	unsubscribeUrl: string;
	supportEmail: string;
}

export interface Rendered {
	subject: string;
	text: string;
	html: string;
	inApp: { title: string; body: string };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const dayTime = (local: string | null) => formatLocal(local, "ccc d LLL, HH:mm");

function place(city: string | null, iata: string | null): string {
	return city && iata ? `${city} (${iata})` : iata ?? city ?? "your destination";
}

function legLine(l: SegmentRow, label?: string): string {
	if (l.kind === "hotel") {
		return `${l.place_name ?? "Your stay"}: check-in ${formatLocal(l.dep_local, "ccc d LLL")}, check-out ${formatLocal(l.arr_local, "ccc d LLL")}`;
	}
	const sameDay = (l.dep_local ?? "").slice(0, 10) === (l.arr_local ?? "").slice(0, 10);
	const arrives = sameDay ? formatLocal(l.arr_local, "HH:mm") : dayTime(l.arr_local);
	const flights = (l.flight_numbers ?? []).length ? ` · ${(l.flight_numbers ?? []).join(", ")}` : "";
	return `${label ? `${label}: ` : ""}${dayTime(l.dep_local)} → ${arrives} · ${l.origin_iata} → ${l.dest_iata}${flights}`;
}

function legLabels(legs: SegmentRow[]): (string | undefined)[] {
	return legs.map((_, i) => (legs.length > 1 ? (i === 0 ? "Outbound" : i === legs.length - 1 ? "Return" : `Leg ${i + 1}`) : undefined));
}

function heading(input: RenderInput): { subject: string; title: string } {
	const s = input.segment;
	const test = s.is_test ? "[TEST] " : "";
	const to = place(s.dest_city, s.dest_iata);
	switch (input.type) {
		case "confirmation": {
			const first = input.legs[0];
			const route = first.kind === "hotel" ? first.place_name ?? "your stay" : input.legs.length > 1 ? `${first.origin_iata} ⇄ ${first.dest_iata}` : `${first.origin_iata} → ${first.dest_iata}`;
			return { subject: `${test}Your booking: ${route}`, title: input.orderStatus === "held" ? "Your seats are reserved" : "Your booking is confirmed" };
		}
		case "ticketed": {
			const first = input.legs[0];
			const what = first.kind === "hotel" ? "stay is confirmed" : "tickets are issued";
			return { subject: `${test}Your ${what}`, title: first.kind === "hotel" ? "Your stay is confirmed" : "Your tickets are issued" };
		}
		case "pre_7d":
			return { subject: `${test}One week to go: your ${to} entry checklist`, title: `One week until you fly to ${to}` };
		case "pre_72h":
			return { subject: `${test}3 days to go: getting ready for ${to}`, title: `Three days until you fly to ${to}` };
		case "pre_24h":
			return { subject: `${test}Tomorrow: your flight to ${to}`, title: "Your flight is tomorrow" };
		case "pre_3h":
			return { subject: `${test}Time to head to the airport`, title: `Your flight to ${to} leaves in about 3 hours` };
		case "hotel_checkin":
			return { subject: `${test}Check-in today: ${s.place_name ?? "your stay"}`, title: "Check-in day" };
	}
}

function bodyLines(input: RenderInput): string[] {
	const s = input.segment;
	const lines: string[] = [];
	const test = s.is_test ? ["This is a TEST booking made in Drift's sandbox. Nothing here is real."] : [];

	switch (input.type) {
		case "confirmation": {
			lines.push(
				input.orderStatus === "held"
					? "Your seats are held, but the ticket has not been issued yet. We'll email you again when it is."
					: "Thanks for booking with Drift."
			);
			const labels = legLabels(input.legs);
			input.legs.forEach((l, i) => lines.push(legLine(l, labels[i])));
			if (s.reference) lines.push(`Booking reference: ${s.reference}`);
			if (input.supplierReference) lines.push(`${s.kind === "flight" ? "Airline reference" : "Confirmation number"}: ${input.supplierReference}`);
			lines.push("We'll send you an entry checklist a week before you go, and reminders as the trip gets closer.");
			break;
		}
		case "ticketed": {
			lines.push(s.kind === "hotel" ? "Your stay is confirmed." : "Good news: your tickets have been issued.");
			const labels = legLabels(input.legs);
			input.legs.forEach((l, i) => lines.push(legLine(l, labels[i])));
			if (s.reference) lines.push(`Booking reference: ${s.reference}`);
			if (input.supplierReference) lines.push(`${s.kind === "flight" ? "Airline reference" : "Confirmation number"}: ${input.supplierReference}`);
			break;
		}
		case "pre_7d":
		case "pre_72h": {
			lines.push(legLine(s));
			if (input.requirements.length === 0) {
				lines.push("Check your passport's expiry date and the entry rules for your destination on the official government site: https://www.smartraveller.gov.au");
			}
			for (const r of input.requirements) lines.push(`${r.title}: ${r.text} (${r.sourceUrl})`);
			if (input.requirements.length > 0) lines.push("Rules change. Always confirm on the official site linked above before you travel.");
			break;
		}
		case "pre_24h":
			lines.push(legLine(s));
			lines.push(`Many airlines open online check-in about 24 hours before departure${s.carrier ? `. Check ${s.carrier}'s app or website` : ". Check your airline's app or website"}.`);
			lines.push("Have your passport and booking reference to hand.");
			break;
		case "pre_3h":
			lines.push(legLine(s));
			lines.push("Gates are normally shown on the airport's departure board close to departure. Check the board when you arrive, and your airline's app for any change.");
			break;
		case "hotel_checkin":
			lines.push(legLine(s));
			if (s.address) lines.push(`Address: ${s.address}`);
			if (s.reference) lines.push(`Booking reference: ${s.reference}`);
			if (input.supplierReference) lines.push(`Confirmation number: ${input.supplierReference}`);
			break;
	}
	return [...test, ...lines];
}

export function renderMessage(input: RenderInput): Rendered {
	const { subject, title } = heading(input);
	const lines = bodyLines(input);

	const footerText = [
		"",
		"You're getting this because you booked with Drift.",
		`Manage your trips: ${input.manageUrl}`,
		`Stop trip reminders: ${input.unsubscribeUrl}`,
		`Questions: ${input.supportEmail}`,
	].join("\n");
	const text = `${title}\n\n${lines.join("\n\n")}\n${footerText}`;

	const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" style="color:#A8893A">$1</a>');
	const html = `<!doctype html><html><body style="margin:0;background:#f8f7f4;font-family:Arial,Helvetica,sans-serif;color:#1A1A1A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#C9A84C;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold">&#9672; Drift</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>
${lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:0 0 12px">${linkify(l)}</p>`).join("\n")}
<p style="margin:20px 0 0"><a href="${esc(input.manageUrl)}" style="background:#C9A84C;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:bold">View my trip</a></p>
</td></tr>
<tr><td style="padding:16px 24px;background:#f8f7f4;font-size:12px;color:#9B9590;line-height:1.5">
You're getting this because you booked with Drift.<br>
<a href="${esc(input.unsubscribeUrl)}" style="color:#9B9590">Stop trip reminders</a> &middot; Questions: ${esc(input.supportEmail)}
</td></tr></table></td></tr></table></body></html>`;

	// In-app: shorter, no links in the text (the card links to the trip).
	const first = lines.find((l) => !l.startsWith("This is a TEST")) ?? "";
	// The entry checklist names its items in-app; the email carries the wording and links.
	const checklist = (input.type === "pre_7d" || input.type === "pre_72h") && input.requirements.length > 0
		? `Check before you fly: ${input.requirements.map((r) => r.title.toLowerCase()).join(", ")}. Confirm each on the official site.`
		: first;
	const inApp = { title: `${testPrefix(input.segment)}${title}`, body: checklist };
	return { subject, text, html, inApp };
}

// "[TEST] " prefix for in-app titles of sandbox bookings.
function testPrefix(seg: SegmentRow): string {
	return seg.is_test ? "[TEST] " : "";
}
