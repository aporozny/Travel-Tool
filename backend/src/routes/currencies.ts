import { Router, Request, Response } from "express";
import { SUPPORTED_CURRENCIES, DEFAULT_CURRENCY, getRateTable } from "../services/fx";

export const currenciesRouter = Router();

// GET /api/v1/currencies
// The currencies a traveller can pick, plus today's indicative rates so the
// web app can convert instantly when the selection changes (no re-search).
// Public data, no auth: it is the ECB's published reference rates.
//
// rates are per 1 EUR (so EUR is 1), restricted to the offered currencies.
// `available: false` means no rate has ever been fetched -- the client must
// then show every price in its own currency rather than guess.
currenciesRouter.get("/", async (_req: Request, res: Response) => {
	try {
		const table = await getRateTable();
		const rates: Record<string, number> = {};
		if (table) {
			for (const c of SUPPORTED_CURRENCIES) rates[c.code] = table.rates[c.code];
		}
		res.set("Cache-Control", "public, max-age=900");
		return res.json({
			currencies: SUPPORTED_CURRENCIES,
			default: DEFAULT_CURRENCY,
			available: !!table,
			rateDate: table?.date ?? null,
			base: "EUR",
			rates,
		});
	} catch (err) {
		console.error("GET /currencies failed:", err);
		return res.status(500).json({ message: "Internal server error" });
	}
});
