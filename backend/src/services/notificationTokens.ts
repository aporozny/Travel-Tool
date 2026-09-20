import crypto from "crypto";

// Signed one-click unsubscribe links. The link carries the user id and an
// HMAC of it, so it can be verified without a database lookup or a stored
// token, and cannot be forged for another user. No expiry on purpose: an
// unsubscribe link in an old email must keep working (Spam Act 2003 requires
// the facility to work for 30 days after sending, and people click old mail).

function secret(): string {
	const value = process.env.UNSUBSCRIBE_SECRET || process.env.JWT_SECRET;
	if (!value) throw new Error("UNSUBSCRIBE_SECRET or JWT_SECRET not configured -- unsubscribe links cannot be signed");
	return value;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

function mac(userId: string): string {
	return b64url(crypto.createHmac("sha256", secret()).update(`unsubscribe:${userId}`).digest()).slice(0, 32);
}

export function signUnsubscribeToken(userId: string): string {
	return `${b64url(Buffer.from(userId, "utf8"))}.${mac(userId)}`;
}

// Returns the user id if the token is genuine, otherwise null.
export function verifyUnsubscribeToken(token: unknown): string | null {
	if (typeof token !== "string" || token.length > 200) return null;
	const [encoded, given] = token.split(".");
	if (!encoded || !given) return null;
	let userId: string;
	try {
		userId = Buffer.from(encoded, "base64url").toString("utf8");
	} catch {
		return null;
	}
	if (!/^[0-9a-f-]{36}$/i.test(userId)) return null;
	const expected = mac(userId);
	const a = Buffer.from(given);
	const b = Buffer.from(expected);
	return a.length === b.length && crypto.timingSafeEqual(a, b) ? userId : null;
}
