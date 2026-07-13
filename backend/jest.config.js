module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	roots: ["<rootDir>/tests"],
	setupFiles: ["<rootDir>/tests/setup-env.ts"],
	testMatch: ["**/*.test.ts"],
	moduleFileExtensions: ["ts", "js", "json"],
	collectCoverageFrom: ["src/**/*.ts"],
	forceExit: true,
	testTimeout: 15000,
};
