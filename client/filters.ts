import { z } from "zod";
import type { Card } from "../shared/model";

export const ACTIVITY_FILTERS = [
  "all",
  "idle",
  "running",
  "waiting",
  "attention",
  "error",
] as const;
export const REQUEST_FILTERS = [
  "all",
  "none",
  "open",
  "draft",
  "merged",
  "closed",
  "unknown",
  "checks-failed",
  "changes-requested",
  "unavailable",
] as const;
export const DATE_RANGES = ["any", "today", "3days", "week", "month"] as const;
const projectIds = z.array(z.string().min(1)).catch([]);
const filterSchema = z
  .object({
    // Empty selects every project; "none" selects tasks without a project.
    projectIds: projectIds.optional(),
    // A single selection saved before several projects could be chosen.
    projectId: z.string().min(1).optional().catch(undefined),
    search: z.string().catch(""),
    attentionOnly: z.boolean().catch(false),
    activity: z.enum(ACTIVITY_FILTERS).catch("all"),
    changeRequest: z.enum(REQUEST_FILTERS).catch("all"),
    dateRange: z.enum(DATE_RANGES).catch("any"),
  })
  .transform(({ projectId, projectIds: ids, ...filters }) => ({
    projectIds: [
      ...new Set(ids ?? (projectId && projectId !== "all" ? [projectId] : [])),
    ],
    ...filters,
  }));
export type BoardFilters = z.infer<typeof filterSchema>;
export const DEFAULT_FILTERS: BoardFilters = filterSchema.parse({});
export function parseFilters(raw: string | null): BoardFilters {
  try {
    return filterSchema.parse(JSON.parse(raw ?? "{}"));
  } catch {
    return DEFAULT_FILTERS;
  }
}
/** The one selected project for new tasks and group edits, or null for none or several. */
export function singleProject(projectIds: readonly string[]): string | null {
  return projectIds.length === 1 && projectIds[0] !== "none"
    ? projectIds[0]
    : null;
}
export function activeFilterCount(filters: BoardFilters): number {
  return [
    filters.projectIds.length > 0,
    !!filters.search.trim(),
    filters.attentionOnly,
    filters.activity !== "all",
    filters.changeRequest !== "all",
    filters.dateRange !== "any",
  ].filter(Boolean).length;
}

/**
 * A card's displayed date is its last conversation time; cards without one cannot match a
 * range. Windows start at local midnight — today covers today, 3 days covers today and the
 * two before it, week is Monday-based, month is the calendar month. Boundaries move with
 * calendar-day arithmetic (setDate), so daylight-saving shifts never skew them by an hour.
 */
export function matchesDateRange(
  card: Card,
  range: BoardFilters["dateRange"],
  now: number,
): boolean {
  if (range === "any") return true;
  const time = card.lastConversationAt
    ? Date.parse(card.lastConversationAt)
    : NaN;
  if (!Number.isFinite(time)) return false;
  if (time > now) return true;
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const date = new Date(midnight);
  if (range === "today") return time >= midnight.getTime();
  if (range === "3days") {
    date.setDate(date.getDate() - 2);
    return time >= date.getTime();
  }
  if (range === "week") {
    date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    return time >= date.getTime();
  }
  date.setDate(1);
  return time >= date.getTime();
}

export function matchesRequest(
  card: Card,
  filter: BoardFilters["changeRequest"],
): boolean {
  if (filter === "all") return true;
  if (filter === "unavailable") return card.changeRequestUnavailable;
  if (card.changeRequestUnavailable) return false;
  const request = card.changeRequest;
  if (filter === "none") return request === null;
  if (!request) return false;
  if (filter === "checks-failed" || filter === "changes-requested") {
    return (
      (request.state === "open" || request.state === "draft") &&
      (filter === "checks-failed"
        ? request.checksStatus === "failure"
        : request.reviewDecision === "changes_requested")
    );
  }
  return request.state === filter;
}
