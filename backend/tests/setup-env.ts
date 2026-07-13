// Test-only environment: tests run on the host, where the docker-compose
// services publish their ports on localhost. The in-container hostnames
// (redis://redis) do not resolve here.
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
process.env.DATABASE_URL =
	process.env.DATABASE_URL ||
	"postgresql://traveller:traveller@localhost:5432/traveller_dev";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.JWT_REFRESH_SECRET =
	process.env.JWT_REFRESH_SECRET || "test-refresh-secret";
