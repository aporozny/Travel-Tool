/**
 * The global error handler used to log only when NODE_ENV === 'development',
 * so every unexpected 500 in production was answered with a generic message
 * and left no trace anywhere. These tests pin the fix: 5xx errors are logged
 * with request context in every environment, while the client response stays
 * the same generic envelope.
 */
import express, { NextFunction, Request, Response } from "express";
import request from "supertest";
import { errorHandler, AppError } from "../src/middleware/errorHandler";

function appThatThrows(err: AppError, user?: { id: string }) {
	const app = express();
	app.get("/boom", (req: Request, _res: Response, next: NextFunction) => {
		if (user) (req as Request & { user?: { id: string } }).user = user;
		next(err);
	});
	app.use(errorHandler);
	return app;
}

describe("errorHandler", () => {
	const originalEnv = process.env.NODE_ENV;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		process.env.NODE_ENV = "production";
		errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		errorSpy.mockRestore();
		process.env.NODE_ENV = originalEnv;
	});

	it("logs an unexpected error in production with method, path and user id", async () => {
		const err = new Error("db connection reset");
		const res = await request(appThatThrows(err, { id: "user-123" })).get("/boom?email=a@b.com&token=secret");

		expect(res.status).toBe(500);
		expect(errorSpy).toHaveBeenCalledTimes(1);
		const [message, context, logged] = errorSpy.mock.calls[0];
		expect(message).toBe("Unhandled error");
		expect(context).toEqual({ method: "GET", path: "/boom", statusCode: 500, userId: "user-123" });
		expect(logged).toBe(err);
	});

	it("never logs the query string, which can carry emails or tokens", async () => {
		await request(appThatThrows(new Error("x"))).get("/boom?email=a@b.com&token=secret");

		const logged = JSON.stringify(errorSpy.mock.calls[0][1]);
		expect(logged).not.toContain("a@b.com");
		expect(logged).not.toContain("secret");
	});

	it("keeps the client response generic for an unexpected error", async () => {
		const res = await request(appThatThrows(new Error("db connection reset"))).get("/boom");

		expect(res.body).toEqual({ status: "error", statusCode: 500, message: "Internal server error" });
	});

	it("passes an operational 4xx message through without logging it as an error", async () => {
		const err: AppError = Object.assign(new Error("Trip not found"), { statusCode: 404, isOperational: true });
		const res = await request(appThatThrows(err)).get("/boom");

		expect(res.status).toBe(404);
		expect(res.body).toEqual({ status: "error", statusCode: 404, message: "Trip not found" });
		expect(errorSpy).not.toHaveBeenCalled();
	});
});
