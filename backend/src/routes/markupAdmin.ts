import { Router, Response } from "express";
import { z } from "zod";
import { authenticate, AuthenticatedRequest } from "../middleware/authenticate";
import { listMarkupRules, createMarkupRuleSchema, createMarkupRule, setMarkupRuleActive, buildScorecard, MarkupRuleError } from "../services/markupRules";

// Admin-only: managing route-scoped markup rules, and the multi-supplier price/margin
// scorecard used to decide them. See services/markupRules.ts for the reasoning.
export const markupAdminRouter = Router();

function requireAdmin(req: AuthenticatedRequest, res: Response): boolean {
	if (req.user?.role !== "admin") {
		res.status(403).json({ message: "Admin only" });
		return false;
	}
	return true;
}

// GET /api/v1/admin/markup-rules
markupAdminRouter.get("/markup-rules", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	if (!requireAdmin(req, res)) return;
	try {
		return res.json({ rules: await listMarkupRules() });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// POST /api/v1/admin/markup-rules -- sets the active rule for a scope/route, replacing whichever
// one was active for that same key (kept, just deactivated, for history).
markupAdminRouter.post("/markup-rules", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	if (!requireAdmin(req, res)) return;
	try {
		const body = createMarkupRuleSchema.parse(req.body);
		return res.status(201).json(await createMarkupRule(body));
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: err.errors[0]?.message ?? "Validation error", errors: err.errors });
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

// PATCH /api/v1/admin/markup-rules/:id -- only ever toggles active (creating a replacement is
// how the value itself changes, so history is never silently overwritten).
markupAdminRouter.patch("/markup-rules/:id", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	if (!requireAdmin(req, res)) return;
	try {
		const { active } = z.object({ active: z.boolean() }).parse(req.body);
		return res.json(await setMarkupRuleActive(req.params.id, active));
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof MarkupRuleError) return res.status(err.status).json({ message: err.message });
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});

const scorecardSchema = z.object({
	origin: z.string().length(3).toUpperCase(),
	destination: z.string().length(3).toUpperCase(),
	departureDate: z.string().date(),
	returnDate: z.string().date().optional(),
	adults: z.coerce.number().int().min(1).max(9).default(1),
});

// GET /api/v1/admin/flights/scorecard -- runs a real search across every supplier and shows
// Drift's own cost and margin alongside it, for one route.
markupAdminRouter.get("/flights/scorecard", authenticate, async (req: AuthenticatedRequest, res: Response) => {
	if (!requireAdmin(req, res)) return;
	try {
		const params = scorecardSchema.parse(req.query);
		return res.json(await buildScorecard(params));
	} catch (err) {
		if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation error", errors: err.errors });
		if (err instanceof Error && err.message.includes("not configured")) {
			return res.status(503).json({ message: "Flight search is not yet available" });
		}
		console.error(err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
