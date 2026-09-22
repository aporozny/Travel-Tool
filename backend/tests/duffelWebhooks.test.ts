import crypto from 'crypto';
import { verifyDuffelSignature, WebhookSignatureError } from '../src/services/duffelWebhooks';

const SECRET = 'test-secret-for-jest';

function sign(timestamp: number, body: Buffer): string {
	const hmac = crypto.createHmac('sha256', SECRET).update(`${timestamp}.`).update(body).digest('hex');
	return `t=${timestamp},v1=${hmac}`;
}

describe('verifying a Duffel webhook signature', () => {
	const realSecret = process.env.DUFFEL_WEBHOOK_SECRET;
	beforeEach(() => { process.env.DUFFEL_WEBHOOK_SECRET = SECRET; });
	afterAll(() => { process.env.DUFFEL_WEBHOOK_SECRET = realSecret; });

	const body = Buffer.from(JSON.stringify({ id: 'wev_1', type: 'ping.triggered' }));

	it('accepts a signature computed the way Duffel documents (t=<ts>,v1=<hmac256 of ts.body>)', () => {
		const header = sign(Math.floor(Date.now() / 1000), body);
		expect(() => verifyDuffelSignature(body, header)).not.toThrow();
	});

	it('rejects a wrong secret', () => {
		const wrong = crypto.createHmac('sha256', 'not-the-secret').update(`${Math.floor(Date.now() / 1000)}.`).update(body).digest('hex');
		const header = `t=${Math.floor(Date.now() / 1000)},v1=${wrong}`;
		expect(() => verifyDuffelSignature(body, header)).toThrow(WebhookSignatureError);
	});

	it('rejects a body that does not match what was signed (tampering)', () => {
		const header = sign(Math.floor(Date.now() / 1000), body);
		const tampered = Buffer.from(JSON.stringify({ id: 'wev_1', type: 'order.airline_initiated_change_detected' }));
		expect(() => verifyDuffelSignature(tampered, header)).toThrow(WebhookSignatureError);
	});

	it('rejects a timestamp far outside the replay tolerance', () => {
		const header = sign(Math.floor(Date.now() / 1000) - 3600, body);
		expect(() => verifyDuffelSignature(body, header)).toThrow(WebhookSignatureError);
	});

	it('rejects a missing header', () => {
		expect(() => verifyDuffelSignature(body, undefined)).toThrow(WebhookSignatureError);
	});

	it('rejects a malformed header', () => {
		expect(() => verifyDuffelSignature(body, 'not-a-real-header')).toThrow(WebhookSignatureError);
	});

	it('fails closed when DUFFEL_WEBHOOK_SECRET is not configured', () => {
		delete process.env.DUFFEL_WEBHOOK_SECRET;
		const header = sign(Math.floor(Date.now() / 1000), body);
		expect(() => verifyDuffelSignature(body, header)).toThrow(WebhookSignatureError);
	});
});
