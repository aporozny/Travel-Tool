/**
 * location_history rows get an expires_at 7 days after they are written, but
 * nothing deleted them. These tests pin the purge job: it deletes only through
 * expires_at, works in batches, never throws, and survives a database that has
 * not had migration 035 applied.
 */
const mockQuery = jest.fn();
jest.mock("../src/utils/db", () => ({ pool: { query: (...args: unknown[]) => mockQuery(...args) } }));

import { purgeExpiredLocationHistory } from "../src/services/locationRetention";

describe("purgeExpiredLocationHistory", () => {
	let logSpy: jest.SpyInstance;
	let warnSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		mockQuery.mockReset();
		logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
		errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it("deletes only rows past expires_at, never by created_at", async () => {
		mockQuery.mockResolvedValueOnce({ rowCount: 3 });
		const n = await purgeExpiredLocationHistory();
		expect(n).toBe(3);
		expect(mockQuery).toHaveBeenCalledTimes(1);
		const sql = String(mockQuery.mock.calls[0][0]);
		expect(sql).toMatch(/DELETE FROM location_history/);
		expect(sql).toMatch(/expires_at < NOW\(\)/);
		expect(sql).not.toMatch(/created_at/);
		expect(mockQuery.mock.calls[0][1]).toEqual([5000]);
	});

	it("keeps deleting while batches come back full, then stops", async () => {
		mockQuery
			.mockResolvedValueOnce({ rowCount: 5000 })
			.mockResolvedValueOnce({ rowCount: 5000 })
			.mockResolvedValueOnce({ rowCount: 120 });
		const n = await purgeExpiredLocationHistory();
		expect(n).toBe(10120);
		expect(mockQuery).toHaveBeenCalledTimes(3);
	});

	it("does nothing and logs nothing when there is nothing to delete", async () => {
		mockQuery.mockResolvedValueOnce({ rowCount: 0 });
		expect(await purgeExpiredLocationHistory()).toBe(0);
		expect(logSpy).not.toHaveBeenCalled();
	});

	it("caps one run at 100 batches", async () => {
		mockQuery.mockResolvedValue({ rowCount: 5000 });
		const n = await purgeExpiredLocationHistory();
		expect(mockQuery).toHaveBeenCalledTimes(100);
		expect(n).toBe(500000);
	});

	it("skips quietly with a clear warning when migration 035 was not applied", async () => {
		mockQuery.mockRejectedValueOnce(Object.assign(new Error("column \"expires_at\" does not exist"), { code: "42703" }));
		await expect(purgeExpiredLocationHistory()).resolves.toBe(0);
		expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("035_location_history_retention.sql"));
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("never throws on any other database error", async () => {
		mockQuery.mockRejectedValueOnce(new Error("connection refused"));
		await expect(purgeExpiredLocationHistory()).resolves.toBe(0);
		expect(errorSpy).toHaveBeenCalled();
	});

	it("can run again after a failed run", async () => {
		mockQuery.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ rowCount: 2 });
		await purgeExpiredLocationHistory();
		expect(await purgeExpiredLocationHistory()).toBe(2);
	});
});
