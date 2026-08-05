import React, { useEffect, useState, useCallback, useRef } from "react";
import api from "../services/api.web";

const CATEGORIES = [
	{ key: "", label: "All" },
	{ key: "food", label: "Food & drink" },
	{ key: "accommodation", label: "Accommodation" },
	{ key: "activity", label: "Activities" },
	{ key: "transport", label: "Transport" },
];

// Starter destinations shown before the traveller has any history of their own
const SUGGESTED = ["Canggu", "Ubud", "Seminyak", "Saranda", "Ksamil", "Lisbon"];

const RECENT_KEY = "drift_recent_destinations";

function PhotoUrl(ref: string): string {
	if (!ref) return "";
	if (ref.startsWith("http")) {
		const match = ref.match(/photo_reference=([^&]+)/);
		if (match) return `/api/v1/photos?ref=${match[1]}`;
		return ref;
	}
	return `/api/v1/photos?ref=${ref}`;
}

function ScoreBadge({
	score,
	personalized,
}: {
	score: number;
	personalized: boolean;
}) {
	if (!personalized || score === 0) return null;
	const color = score >= 70 ? "#C9A84C" : score >= 40 ? "#F57F17" : "#888";
	return (
		<span style={{ ...styles.scoreBadge, background: color }}>
			{score}% match
		</span>
	);
}

// A lone "1 saved" reads worse than no count at all -- people anchor on
// the smallness specifically. Only show real social proof once it's
// actually substantial; a low/zero count renders nothing rather than a
// hollow-looking number.
const SOCIAL_PROOF_MIN = 5;

function CommunityRow({
	community,
}: {
	community?: { saves: number; books: number };
}) {
	if (!community) return null;
	if (community.saves + community.books < SOCIAL_PROOF_MIN) return null;
	const parts = [];
	if (community.saves > 0) parts.push(`${community.saves} people saved this`);
	if (community.books > 0) parts.push(`${community.books} booked`);
	return (
		<div style={styles.communityRow} aria-label={parts.join(", ")}>
			{community.saves > 0 && (
				<span aria-hidden="true">♥ {community.saves} saved</span>
			)}
			{community.books > 0 && (
				<span aria-hidden="true">✓ {community.books} booked</span>
			)}
		</div>
	);
}

// Same card frame across every category, but this one line adapts to
// show what's actually meaningful per category -- primary tag (from
// Google's own classification, e.g. "italian restaurant" for food,
// "hotel" for accommodation) plus price level where Drift actually has
// it. Deliberately does NOT invent fields the data doesn't have (Google
// Places opening_hours/duration/mode are not populated today) -- this is
// the honest version of the adaptive-metadata-row design, not the full
// vision, which would need real data for those fields first.
function CardMetaRow({ item }: { item: any }) {
	const primaryTag = item.tags?.[0]?.replace(/_/g, " ");
	const priceLevel =
		item.price_level > 0 ? "$".repeat(Math.min(item.price_level, 4)) : null;
	if (!primaryTag && !priceLevel) return null;
	return (
		<p style={styles.cardMeta}>
			{primaryTag}
			{primaryTag && priceLevel ? " · " : ""}
			{priceLevel}
		</p>
	);
}

function ResultCard({ item, personalized, onSave, saved, onView }: any) {
	const photo = item.photos?.[0] ? PhotoUrl(item.photos[0]) : null;
	const score = Math.round((item.score / 100) * 100);

	return (
		<div
			style={styles.card}
			onClick={() => onView(item)}
			role="button"
			tabIndex={0}
			aria-label={`View details for ${item.name}`}
			onKeyDown={(e: React.KeyboardEvent) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onView(item);
				}
			}}
		>
			<div style={styles.cardPhoto}>
				{photo ? (
					<img
						src={photo}
						alt={item.name}
						style={styles.cardImg}
						onError={(e: any) => {
							e.target.style.display = "none";
						}}
					/>
				) : (
					<div style={styles.cardNoPhoto}>
						{item.category?.[0]?.toUpperCase()}
					</div>
				)}
				<ScoreBadge score={score} personalized={personalized} />
				<button
					style={{ ...styles.saveBtn, color: saved ? "#E53935" : "#fff" }}
					onClick={(e) => {
						e.stopPropagation();
						onSave(item);
					}}
					aria-label={saved ? `Unsave ${item.name}` : `Save ${item.name}`}
					aria-pressed={saved}
				>
					<span aria-hidden="true">{saved ? "♥" : "♡"}</span>
				</button>
			</div>
			<div style={styles.cardBody}>
				<div style={styles.cardTopRow}>
					<span style={styles.cardCategory}>{item.category}</span>
					{item.is_verified && (
						<span style={styles.verifiedBadge}>✓ Verified</span>
					)}
					{item.trust_tier === "elite" && (
						<span style={styles.eliteBadge}>◆ Elite</span>
					)}
					{item.trust_tier === "trusted" && (
						<span style={styles.trustedBadge}>★ Trusted</span>
					)}
					{item.is_claimed && !item.is_verified && (
						<span style={styles.claimedBadge}>Claimed</span>
					)}
					{/* No negative "Unclaimed" label: unclaimed is the majority of
					    the catalog and often just as good -- absence of a badge
					    reads as neutral, a warning label would not. */}
				</div>
				<h3 style={styles.cardName}>{item.name}</h3>
				<p style={styles.cardRegion}>{item.region}</p>
				<CardMetaRow item={item} />
				{item.rating > 0 && (
					<div
						style={styles.cardRating}
						aria-label={`${parseFloat(item.rating).toFixed(1)} out of 5 stars, ${item.review_count?.toLocaleString() || 0} reviews`}
					>
						<span style={styles.stars} aria-hidden="true">★</span>
						<span style={styles.ratingNum} aria-hidden="true">
							{parseFloat(item.rating).toFixed(1)}
						</span>
						<span style={styles.reviewCount} aria-hidden="true">
							({item.review_count?.toLocaleString()})
						</span>
					</div>
				)}
				<CommunityRow community={item.community} />
				{item.description && (
					<p style={styles.cardDesc}>
						{item.description.slice(0, 100)}
						{item.description.length > 100 ? "..." : ""}
					</p>
				)}
				{item.tags?.length > 1 && (
					<div style={styles.tagRow}>
						{item.tags.slice(1, 4).map((t: string) => (
							<span key={t} style={styles.tag}>
								{t.replace(/_/g, " ")}
							</span>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function DetailPanel({ item, onClose, onBook }: any) {
	const photos = item.photos || [];

	return (
		<div style={styles.detail}>
			<button style={styles.detailClose} onClick={onClose}>
				✕ Close
			</button>
			{photos[0] && (
				<img
					src={PhotoUrl(photos[0])}
					alt={item.name}
					style={styles.detailPhoto}
					onError={(e: any) => {
						e.target.style.display = "none";
					}}
				/>
			)}
			<div style={styles.detailBody}>
				<div style={styles.detailTopRow}>
					<span style={styles.cardCategory}>{item.category}</span>
					{item.is_verified && (
						<span style={styles.verifiedBadge}>✓ Verified</span>
					)}
				</div>
				<h2 style={styles.detailName}>{item.name}</h2>
				<p style={styles.detailRegion}>
					{item.region}
					{item.address ? ` · ${item.address}` : ""}
				</p>
				{item.rating > 0 && (
					<div style={styles.cardRating}>
						<span style={styles.stars}>★</span>
						<span style={styles.ratingNum}>
							{parseFloat(item.rating).toFixed(1)}
						</span>
						<span style={styles.reviewCount}>
							({item.review_count?.toLocaleString()} reviews)
						</span>
					</div>
				)}
				<CommunityRow community={item.community} />
				{item.description && (
					<p style={styles.detailDesc}>{item.description}</p>
				)}
				{item.tags?.length > 0 && (
					<div style={{ ...styles.tagRow, marginBottom: 16 }}>
						{item.tags.map((t: string) => (
							<span key={t} style={styles.tag}>
								{t.replace(/_/g, " ")}
							</span>
						))}
					</div>
				)}
				<div style={styles.detailLinks}>
					{item.website && (
						<a
							href={item.website}
							target="_blank"
							rel="noopener noreferrer"
							style={styles.detailLink}
						>
							Website
						</a>
					)}
					{item.phone && <span style={styles.detailPhone}>{item.phone}</span>}
				</div>
				{item.type === "operator" && (
					<button style={styles.bookBtn} onClick={() => onBook(item)}>
						Request booking
					</button>
				)}
			</div>
		</div>
	);
}

function loadRecent(): string[] {
	try {
		const raw = localStorage.getItem(RECENT_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.slice(0, 6) : [];
	} catch {
		return [];
	}
}

export default function ExploreScreen({
	onSelectOperator,
	detail,
	onClearDetail,
}: any) {
	const [results, setResults] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	// Visually-hidden aria-live announcement so screen-reader users learn
	// when async results/load-more finish, without moving focus.
	const [announcement, setAnnouncement] = useState("");
	const [personalized, setPersonalized] = useState(false);
	const [category, setCategory] = useState("");
	const [region, setRegion] = useState("");
	const [subArea, setSubArea] = useState("");
	const [subregions, setSubregions] = useState<
		{ name: string; slug: string; count: number }[]
	>([]);
	// Category-sectioned homepage rows (Top Food / Top Stays / ...), shown
	// only in the default "All categories, no local filter" view -- once a
	// category is picked or the user types a local filter, today's single
	// flat grid takes over unchanged.
	const [sections, setSections] = useState<Record<string, any[]>>({});
	const [sectionsLoading, setSectionsLoading] = useState(false);
	const [destInput, setDestInput] = useState("");
	const [recent, setRecent] = useState<string[]>(loadRecent);
	const [search, setSearch] = useState("");
	const [saves, setSaves] = useState<Set<string>>(new Set());
	const [selected, setSelected] = useState<any>(null);
	const [activeTrips, setActiveTrips] = useState<any[]>([]);
	// Set after warming a new destination so the next fetch bypasses the rec cache
	const needsRefresh = useRef(false);
	const regionRef = useRef(region);
	useEffect(() => {
		regionRef.current = region;
	}, [region]);

	// Sub-areas worth offering for this destination — gated by the backend
	// (only well-covered neighborhoods come back), so an empty/short list
	// here just means this destination doesn't have meaningful sub-areas
	// yet, not that the fetch failed.
	useEffect(() => {
		setSubArea("");
		if (!region) {
			setSubregions([]);
			return;
		}
		api
			.get("/search/subregions", { params: { region } })
			.then((r: any) => setSubregions(r.data.subregions || []))
			.catch(() => setSubregions([]));
	}, [region]);

	const RESULTS_PAGE_SIZE = 20;

	const fetchResults = useCallback(async () => {
		setLoading(true);
		try {
			const params: any = { limit: RESULTS_PAGE_SIZE };
			if (category) params.category = category;
			if (region) params.region = region;
			if (subArea) params.sub_area = subArea;
			if (needsRefresh.current) {
				params.refresh = "true";
				needsRefresh.current = false;
			}

			const res = await api.get("/recommendations", { params });
			const items = res.data.results || [];
			setResults(items);
			setPersonalized(res.data.personalized || false);
			setHasMore(!!res.data.hasMore);
			const catLabel = CATEGORIES.find((c) => c.key === category)?.label;
			setAnnouncement(
				`${items.length} result${items.length === 1 ? "" : "s"}` +
					(catLabel && category ? ` for ${catLabel}` : "") +
					(region ? ` in ${region}` : ""),
			);
		} catch {
			try {
				const res = await api.get("/operators", {
					params: { category, region },
				});
				setResults(
					res.data.map((o: any) => ({ ...o, type: "operator", score: 0 })),
				);
				setHasMore(false);
			} catch {}
		} finally {
			setLoading(false);
		}
	}, [category, region, subArea]);

	useEffect(() => {
		fetchResults();
	}, [fetchResults]);

	// "Load more" within a single category (e.g. scroll through more Food
	// or Accommodation options to save) -- offset is simply how many
	// results are already loaded, since the backend caches the full
	// scored candidate pool and just slices it per page.
	const loadMore = async () => {
		if (loadingMore || !hasMore) return;
		setLoadingMore(true);
		try {
			const params: any = {
				limit: RESULTS_PAGE_SIZE,
				offset: results.length,
			};
			if (category) params.category = category;
			if (region) params.region = region;
			if (subArea) params.sub_area = subArea;

			const res = await api.get("/recommendations", { params });
			const newItems = res.data.results || [];
			setResults((prev) => [...prev, ...newItems]);
			setHasMore(!!res.data.hasMore);
			setAnnouncement(
				`${newItems.length} more result${newItems.length === 1 ? "" : "s"} loaded, ${results.length + newItems.length} total`,
			);
		} catch {
			setHasMore(false);
		} finally {
			setLoadingMore(false);
		}
	};

	// Sectioned homepage rows -- only fetched (and only shown) when there's
	// no category filter and no local text filter active. A handful of
	// small per-category requests, not a rewrite of the main fetch path.
	const SECTION_CATEGORIES = ["food", "accommodation", "activity", "transport"];
	useEffect(() => {
		if (category || search) return;
		let cancelled = false;
		setSectionsLoading(true);
		Promise.all(
			SECTION_CATEGORIES.map((cat) => {
				const params: any = { category: cat, limit: 8 };
				if (region) params.region = region;
				if (subArea) params.sub_area = subArea;
				return api
					.get("/recommendations", { params })
					.then((res: any) => [cat, res.data.results || []])
					.catch(() => [cat, []]);
			}),
		).then((entries) => {
			if (cancelled) return;
			setSections(Object.fromEntries(entries));
			setSectionsLoading(false);
		});
		return () => {
			cancelled = true;
		};
	}, [category, search, region, subArea]);

	// Point the screen at any destination on earth: warm the catalog (backend
	// geocodes and fans out to live sources if it's new), learn the canonical
	// name, then let the recommendations fetch rank what came back.
	const exploreDestination = async (dest: string) => {
		const trimmed = dest.trim();
		if (!trimmed) return;
		setLoading(true);
		setSelected(null);
		let canonical = trimmed;
		try {
			const warm = await api.get("/search", {
				params: { q: "", region: trimmed, limit: 1 },
				timeout: 20000, // live multi-source fan-out can take a few seconds
			});
			if (warm.data?.geo?.name) canonical = warm.data.geo.name;
		} catch {
			// warming is best-effort; the catalog may already cover it
		}
		needsRefresh.current = true;
		localStorage.setItem("drift_region", canonical);
		setRecent((prev) => {
			const next = [
				canonical,
				...prev.filter((r) => r.toLowerCase() !== canonical.toLowerCase()),
			].slice(0, 6);
			localStorage.setItem(RECENT_KEY, JSON.stringify(next));
			return next;
		});
		if (regionRef.current === canonical) fetchResults();
		else setRegion(canonical);
	};

	const clearDestination = () => {
		setRegion("");
		localStorage.removeItem("drift_region");
	};

	// Restore saved destination and load active trips
	useEffect(() => {
		const saved = localStorage.getItem("drift_region");
		if (saved) setRegion(saved);

		api
			.get("/safety/trips")
			.then((r: any) => {
				const active = (r.data || []).filter((t: any) =>
					["active", "planned"].includes(t.safety_status),
				);
				setActiveTrips(active);
				// No saved destination: point at the active trip's destination
				if (!saved && active.length > 0 && active[0].destination) {
					exploreDestination(active[0].destination);
				}
			})
			.catch(() => {});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleSave = async (item: any) => {
		try {
			const res = await api.post("/recommendations/save", {
				entity_type: item.type,
				entity_id: item.id,
			});
			setSaves((prev) => {
				const next = new Set(prev);
				if (res.data.saved) next.add(item.id);
				else next.delete(item.id);
				return next;
			});
		} catch {}
	};

	const handleView = async (item: any) => {
		setSelected(item);
		try {
			await api.post("/recommendations/interact", {
				entity_type: item.type,
				entity_id: item.id,
				interaction_type: "view",
				region: item.region,
				category: item.category,
				tags: item.tags,
			});
		} catch {}
	};

	const filtered = search
		? results.filter(
				(r) =>
					r.name?.toLowerCase().includes(search.toLowerCase()) ||
					r.region?.toLowerCase().includes(search.toLowerCase()) ||
					r.tags?.some((t: string) => t.includes(search.toLowerCase())),
			)
		: results;

	// Quick-pick pills: recents first, then suggestions they haven't tried
	const quickPicks = [
		...recent,
		...SUGGESTED.filter(
			(s) => !recent.some((r) => r.toLowerCase() === s.toLowerCase()),
		),
	].slice(0, 8);

	if (selected) {
		return (
			<div style={styles.container}>
				<DetailPanel
					item={selected}
					onClose={() => setSelected(null)}
					onBook={(item: any) => {
						onSelectOperator(item);
						setSelected(null);
					}}
				/>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			<div style={styles.header}>
				{/* Destination search — anywhere on earth */}
				<form
					style={styles.destForm}
					onSubmit={(e) => {
						e.preventDefault();
						exploreDestination(destInput);
						setDestInput("");
					}}
				>
					<input
						style={styles.destInput}
						placeholder="Where to? Try any city, island or town..."
						value={destInput}
						onChange={(e) => setDestInput(e.target.value)}
					/>
					<button type="submit" style={styles.destGo}>
						Explore
					</button>
				</form>

				<div style={styles.destinationSection}>
					<div style={styles.destinationHeader}>
						<span style={styles.destinationTitle}>
							{region ? `Exploring ${region}` : "For you"}
						</span>
						{region && (
							<button style={styles.clearDest} onClick={clearDestination}>
								Clear
							</button>
						)}
					</div>

					{/* Active trips first */}
					{activeTrips.length > 0 && (
						<div style={styles.tripPills}>
							{activeTrips.map((t: any) => (
								<button
									key={t.id}
									style={{ ...styles.destPill, ...styles.tripPill }}
									onClick={() => exploreDestination(t.destination)}
								>
									✈ {t.destination}
								</button>
							))}
						</div>
					)}

					{/* Recent + suggested destinations — only on the unscoped "For
					    you" landing view. Once a specific city is being explored,
					    this used to show unrelated global suggestions (e.g.
					    "Milan" mixed with hardcoded "Canggu, Ubud..."); the
					    sub-area chips below already cover "what else to explore"
					    once a destination is picked. */}
					{!region && (
						<div style={styles.regionPills}>
							{quickPicks.map((r) => (
								<button
									key={r}
									style={styles.destPill}
									onClick={() => exploreDestination(r)}
								>
									{r}
								</button>
							))}
						</div>
					)}
				</div>

				{/* Filter within results */}
				<div style={styles.searchRow}>
					<input
						style={styles.searchInput}
						placeholder="Filter these results..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
				</div>

				{/* Category filters -- a toggle-button group, not tabs: these
				    compose with sub-area filters rather than switching panels. */}
				<div style={styles.filterRow} role="group" aria-label="Filter by category">
					<div style={styles.filterScroll}>
						{CATEGORIES.map((c) => (
							<button
								key={c.key}
								style={{
									...styles.filterChip,
									...(category === c.key ? styles.filterChipActive : {}),
								}}
								aria-pressed={category === c.key}
								onClick={() => setCategory(c.key)}
							>
								{c.label}
							</button>
						))}
					</div>
				</div>

				{/* Sub-area (neighborhood/suburb) filters — only shown when the
				    destination actually has more than one worth offering. A
				    single-town destination looks identical to today. */}
				{subregions.length >= 2 && (
					<div style={styles.filterRow} role="group" aria-label="Filter by sub-area">
						<div style={styles.filterScroll}>
							<button
								style={{
									...styles.filterChip,
									...(subArea === "" ? styles.filterChipActive : {}),
								}}
								aria-pressed={subArea === ""}
								onClick={() => setSubArea("")}
							>
								All {region}
							</button>
							{subregions.map((s) => (
								<button
									key={s.slug}
									style={{
										...styles.filterChip,
										...(subArea === s.slug ? styles.filterChipActive : {}),
									}}
									aria-pressed={subArea === s.slug}
									onClick={() => setSubArea(subArea === s.slug ? "" : s.slug)}
								>
									{s.name}
								</button>
							))}
						</div>
					</div>
				)}

				{personalized && (
					<p style={styles.personalizedNote}>✦ Ranked by your preferences</p>
				)}
			</div>

			{/* Visually hidden -- announces async result/load-more updates to
			    screen readers without moving focus (a sibling of the results
			    list, not inside it, so it's not re-announced on every re-render). */}
			<div aria-live="polite" style={styles.srOnly}>
				{announcement}
			</div>

			{category || search ? (
				loading ? (
					<div style={styles.loading}>
						{region
							? `Finding the best of ${region} for you...`
							: "Finding places for you..."}
					</div>
				) : filtered.length === 0 ? (
					<div style={styles.empty}>
						{region
							? `Nothing found in ${region} yet. Try a different category, or search another destination.`
							: "Nothing found. Search a destination above to start exploring."}
					</div>
				) : (
					<>
						<div style={styles.grid}>
							{filtered.map((item) => (
								<ResultCard
									key={`${item.type}-${item.id}`}
									item={item}
									personalized={personalized}
									onSave={handleSave}
									saved={saves.has(item.id)}
									onView={handleView}
								/>
							))}
						</div>
						{/* Load more within this category -- a real visible button
						    (not scroll-triggered-only) so it works for keyboard/
						    screen-reader users too, per the agreed design. Only
						    shown for a single-category view: the backend caches
						    the full scored pool per category, not per mixed page. */}
						{category && hasMore && !search && (
							<button
								style={styles.loadMoreBtn}
								onClick={loadMore}
								disabled={loadingMore}
							>
								{loadingMore ? "Loading more..." : "Load more"}
							</button>
						)}
					</>
				)
			) : sectionsLoading ? (
				<div style={styles.loading}>
					{region
						? `Finding the best of ${region} for you...`
						: "Finding places for you..."}
				</div>
			) : SECTION_CATEGORIES.every((c) => (sections[c] || []).length === 0) ? (
				<div style={styles.empty}>
					{region
						? `Nothing found in ${region} yet. Try a different category, or search another destination.`
						: "Nothing found. Search a destination above to start exploring."}
				</div>
			) : (
				<div style={styles.sectionsContainer}>
					{SECTION_CATEGORIES.map((cat) => {
						const items = sections[cat] || [];
						if (items.length === 0) return null;
						const label = CATEGORIES.find((c) => c.key === cat)?.label || cat;
						return (
							<div key={cat} style={styles.sectionBlock}>
								<div style={styles.sectionHeader}>
									<h3 style={styles.sectionTitle}>{label}</h3>
									<button
										style={styles.seeAllBtn}
										onClick={() => setCategory(cat)}
									>
										See all →
									</button>
								</div>
								<div style={styles.sectionScroll}>
									{items.map((item) => (
										<div
											key={`${item.type}-${item.id}`}
											style={styles.sectionCard}
										>
											<ResultCard
												item={item}
												personalized={personalized}
												onSave={handleSave}
												saved={saves.has(item.id)}
												onView={handleView}
											/>
										</div>
									))}
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	container: { height: "100%", overflow: "auto", background: "#f8f7f4" },
	header: {
		background: "#fff",
		borderBottom: "1px solid #F0EDE8",
		padding: "16px 20px",
		position: "sticky",
		top: 0,
		zIndex: 10,
	},

	// Destination search
	destForm: { display: "flex", gap: 8, marginBottom: 14 },
	destInput: {
		flex: 1,
		padding: "11px 16px",
		borderRadius: 12,
		border: "1.5px solid #E8E4DE",
		fontSize: 15,
		background: "#fff",
		outline: "none",
		boxSizing: "border-box" as const,
	},
	destGo: {
		padding: "11px 22px",
		borderRadius: 12,
		border: "none",
		background: "#C9A84C",
		color: "#fff",
		fontSize: 15,
		fontWeight: 600,
		cursor: "pointer",
		whiteSpace: "nowrap" as const,
	},

	// Destination section
	destinationSection: { marginBottom: 12 },
	destinationHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		marginBottom: 8,
	},
	destinationTitle: { fontSize: 13, fontWeight: 600, color: "#1A1A1A" },
	clearDest: {
		fontSize: 12,
		color: "#C9A84C",
		background: "none",
		border: "none",
		cursor: "pointer",
		fontWeight: 500,
	},
	tripPills: {
		display: "flex",
		gap: 6,
		marginBottom: 6,
		flexWrap: "wrap" as const,
	},
	tripPill: { borderColor: "#C9A84C !important" as any },
	regionPills: { display: "flex", gap: 6, flexWrap: "wrap" as const },
	destPill: {
		padding: "5px 12px",
		borderRadius: 20,
		border: "1.5px solid #E8E4DE",
		background: "#fff",
		fontSize: 12,
		cursor: "pointer",
		color: "#666",
		fontWeight: 500,
		whiteSpace: "nowrap" as const,
	},
	destPillActive: {
		borderColor: "#C9A84C",
		background: "#FBF5E6",
		color: "#A8893A",
		fontWeight: 700,
	},

	searchRow: { marginBottom: 10 },
	searchInput: {
		width: "100%",
		padding: "10px 14px",
		borderRadius: 10,
		border: "1px solid #E8E4DE",
		fontSize: 14,
		background: "#f8f7f4",
		boxSizing: "border-box" as const,
		outline: "none",
	},
	filterRow: { display: "flex", gap: 8, alignItems: "center" },
	filterScroll: {
		display: "flex",
		gap: 6,
		overflowX: "auto" as const,
		flex: 1,
	},
	filterChip: {
		padding: "6px 14px",
		borderRadius: 20,
		border: "1.5px solid #E8E4DE",
		background: "#fff",
		fontSize: 13,
		cursor: "pointer",
		whiteSpace: "nowrap" as const,
		color: "#555",
	},
	filterChipActive: {
		borderColor: "#C9A84C",
		background: "#FBF5E6",
		color: "#C9A84C",
		fontWeight: 500,
	},
	personalizedNote: {
		fontSize: 12,
		color: "#C9A84C",
		marginTop: 8,
		fontWeight: 500,
	},
	loading: { padding: 60, textAlign: "center" as const, color: "#999" },
	empty: {
		padding: 60,
		textAlign: "center" as const,
		color: "#999",
		maxWidth: 400,
		margin: "0 auto",
	},
	grid: {
		display: "grid",
		gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
		gap: 16,
		padding: 20,
	},

	sectionsContainer: {
		padding: "20px 0",
	},
	sectionBlock: {
		marginBottom: 28,
	},
	sectionHeader: {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		padding: "0 20px",
		marginBottom: 12,
	},
	sectionTitle: {
		fontSize: 18,
		fontWeight: 700,
		margin: 0,
		color: "#1a1a1a",
	},
	seeAllBtn: {
		background: "none",
		border: "none",
		color: "#0a7d55",
		fontWeight: 600,
		fontSize: 14,
		cursor: "pointer",
		padding: 0,
	},
	loadMoreBtn: {
		display: "block",
		margin: "24px auto",
		padding: "12px 28px",
		borderRadius: 12,
		border: "1px solid #C9A84C",
		background: "#fff",
		color: "#C9A84C",
		fontSize: 15,
		fontWeight: 600,
		cursor: "pointer",
	},
	sectionScroll: {
		display: "flex",
		gap: 16,
		overflowX: "auto" as const,
		padding: "0 20px 4px",
	},
	sectionCard: {
		flex: "0 0 260px",
		width: 260,
	},

	card: {
		background: "#fff",
		borderRadius: 14,
		overflow: "hidden",
		cursor: "pointer",
		boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
		transition: "transform 0.15s",
	},
	cardPhoto: {
		position: "relative" as const,
		height: 180,
		background: "#f0f0f0",
	},
	cardImg: { width: "100%", height: "100%", objectFit: "cover" as const },
	cardNoPhoto: {
		width: "100%",
		height: "100%",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 48,
		color: "#ccc",
	},
	scoreBadge: {
		position: "absolute" as const,
		top: 10,
		left: 10,
		color: "#fff",
		fontSize: 11,
		fontWeight: 600,
		padding: "3px 8px",
		borderRadius: 6,
	},
	saveBtn: {
		position: "absolute" as const,
		top: 8,
		right: 10,
		background: "none",
		border: "none",
		fontSize: 22,
		cursor: "pointer",
		textShadow: "0 1px 3px rgba(0,0,0,0.3)",
	},
	cardBody: { padding: "12px 14px 14px" },
	cardTopRow: {
		display: "flex",
		alignItems: "center",
		gap: 6,
		marginBottom: 4,
		flexWrap: "wrap" as const,
	},
	cardCategory: {
		fontSize: 11,
		color: "#999",
		textTransform: "capitalize" as const,
	},
	verifiedBadge: {
		fontSize: 10,
		color: "#C9A84C",
		background: "#FBF5E6",
		padding: "1px 6px",
		borderRadius: 4,
		fontWeight: 600,
	},
	claimedBadge: {
		fontSize: 10,
		color: "#F57F17",
		background: "#FFF8E1",
		padding: "1px 6px",
		borderRadius: 4,
	},
	eliteBadge: {
		fontSize: 10,
		color: "#A8893A",
		background: "#FBF5E6",
		padding: "1px 6px",
		borderRadius: 4,
		fontWeight: 700,
	},
	trustedBadge: {
		fontSize: 10,
		color: "#10B981",
		background: "#ECFDF5",
		padding: "1px 6px",
		borderRadius: 4,
		fontWeight: 600,
	},
	unclaimedBadge: {
		fontSize: 10,
		color: "#9B9590",
		background: "#F5F3EF",
		padding: "1px 6px",
		borderRadius: 4,
		fontWeight: 500,
	},
	cardName: {
		fontSize: 15,
		fontWeight: 600,
		color: "#1a1a1a",
		marginBottom: 2,
	},
	cardRegion: { fontSize: 12, color: "#999", marginBottom: 6 },
	cardMeta: {
		fontSize: 13,
		color: "#555",
		fontWeight: 600,
		margin: "0 0 6px",
		textTransform: "capitalize" as const,
	},
	srOnly: {
		position: "absolute" as const,
		width: 1,
		height: 1,
		padding: 0,
		margin: -1,
		overflow: "hidden" as const,
		clip: "rect(0, 0, 0, 0)",
		whiteSpace: "nowrap" as const,
		border: 0,
	},
	cardRating: {
		display: "flex",
		alignItems: "center",
		gap: 4,
		marginBottom: 6,
	},
	stars: { color: "#F9A825", fontSize: 14 },
	ratingNum: { fontSize: 13, fontWeight: 600, color: "#1a1a1a" },
	reviewCount: { fontSize: 12, color: "#999" },
	communityRow: {
		display: "flex",
		gap: 8,
		fontSize: 12,
		color: "#A8893A",
		fontWeight: 600,
		marginBottom: 6,
	},
	cardDesc: { fontSize: 13, color: "#666", lineHeight: 1.5, marginBottom: 8 },
	tagRow: { display: "flex", flexWrap: "wrap" as const, gap: 4 },
	tag: {
		fontSize: 11,
		color: "#888",
		background: "#f5f5f5",
		padding: "2px 7px",
		borderRadius: 4,
	},

	detail: { maxWidth: 700, margin: "0 auto", padding: 20 },
	detailClose: {
		background: "none",
		border: "1px solid #E8E4DE",
		borderRadius: 8,
		padding: "8px 16px",
		cursor: "pointer",
		fontSize: 13,
		color: "#666",
		marginBottom: 16,
	},
	detailPhoto: {
		width: "100%",
		height: 280,
		objectFit: "cover" as const,
		borderRadius: 14,
		marginBottom: 16,
	},
	detailBody: { background: "#fff", borderRadius: 14, padding: 24 },
	detailTopRow: {
		display: "flex",
		alignItems: "center",
		gap: 8,
		marginBottom: 8,
	},
	detailName: {
		fontSize: 24,
		fontWeight: 700,
		color: "#1a1a1a",
		marginBottom: 4,
	},
	detailRegion: { fontSize: 14, color: "#888", marginBottom: 10 },
	detailDesc: {
		fontSize: 15,
		color: "#555",
		lineHeight: 1.7,
		marginBottom: 16,
	},
	detailLinks: {
		display: "flex",
		gap: 16,
		alignItems: "center",
		marginBottom: 20,
	},
	detailLink: { color: "#C9A84C", fontSize: 14, fontWeight: 500 },
	detailPhone: { color: "#555", fontSize: 14 },
	bookBtn: {
		width: "100%",
		padding: "14px 0",
		background: "#C9A84C",
		color: "#fff",
		border: "none",
		borderRadius: 12,
		fontSize: 16,
		fontWeight: 600,
		cursor: "pointer",
	},
};
