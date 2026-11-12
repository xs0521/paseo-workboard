import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cardSchema, newTask, type Board, type Card } from "../shared/model";
import { visibleCards } from "../client/board-utils";
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  matchesDateRange,
  parseFilters,
  singleProject,
  type BoardFilters,
} from "../client/filters";

const card = (id: string, overrides: Partial<Card> = {}): Card =>
  cardSchema.parse({
    ...newTask(id, `Task ${id}`, "2026-01-01T00:00:00Z"),
    stage: "todo",
    labels: [],
    managedLabels: [],
    changeRequest: null,
    changeRequestUnavailable: false,
    activity: "idle",
    dueAt: null,
    agents: [],
    ...overrides,
  });
const request: NonNullable<Card["changeRequest"]> = {
  forge: "gitlab",
  number: 1,
  url: "https://example.com/mr/1",
  title: "Fix",
  state: "open",
  checksStatus: "failure",
  reviewDecision: "changes_requested",
};
const cards = [
  card("draft"),
  card("running", {
    workspaceId: "w1",
    projectId: "p1",
    activity: "running",
    changeRequest: request,
  }),
  card("waiting", {
    workspaceId: "w2",
    projectId: "p1",
    activity: "waiting",
    changeRequest: { ...request, state: "draft" },
  }),
  card("merged", { changeRequest: { ...request, state: "merged" } }),
  card("unavailable", {
    changeRequest: request,
    changeRequestUnavailable: true,
  }),
  card("missing-unavailable", { changeRequestUnavailable: true }),
  card("unknown", { changeRequest: { ...request, state: "unknown" } }),
];
const board = { cards } as Board;

describe("remembered board filters", () => {
  it("restores only supported values and recovers from corrupt storage", () => {
    expect(parseFilters(null)).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("not json")).toEqual(DEFAULT_FILTERS);
    expect(parseFilters("[]")).toEqual(DEFAULT_FILTERS);
    expect(
      parseFilters(
        JSON.stringify({
          projectId: "p1",
          search: "test",
          attentionOnly: true,
          activity: "running",
          changeRequest: "merged",
        }),
      ),
    ).toEqual({
      projectIds: ["p1"],
      search: "test",
      attentionOnly: true,
      activity: "running",
      changeRequest: "merged",
      dateRange: "any",
    });
    expect(
      parseFilters(JSON.stringify({ activity: "removed", search: "keep" })),
    ).toEqual({ ...DEFAULT_FILTERS, search: "keep" });
  });
  it("restores several projects and converts a saved single project", () => {
    expect(
      parseFilters(JSON.stringify({ projectIds: ["p1", "none", "p1"] }))
        .projectIds,
    ).toEqual(["p1", "none"]);
    expect(
      parseFilters(JSON.stringify({ projectId: "all" })).projectIds,
    ).toEqual([]);
    expect(
      parseFilters(JSON.stringify({ projectIds: "p1" })).projectIds,
    ).toEqual([]);
    expect(singleProject(["p1"])).toBe("p1");
    expect(singleProject(["none"])).toBeNull();
    expect(singleProject(["p1", "p2"])).toBeNull();
  });
  it("shows tasks from every selected project", () => {
    const many = [
      card("a", { projectId: "a" }),
      card("b", { projectId: "b" }),
      card("c", { projectId: "c" }),
      card("loose"),
    ];
    const ids = (selected: string[]) =>
      visibleCards({ cards: many } as Board, selected, "", false).map(
        (item) => item.id,
      );
    expect(ids(["a", "c"])).toEqual(["a", "c"]);
    expect(ids(["b", "none"])).toEqual(["b", "loose"]);
    expect(ids([])).toEqual(["a", "b", "c", "loose"]);
  });
  it("counts actual conditions without treating whitespace as a filter", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: "  " })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        projectIds: ["none"],
        activity: "idle",
        changeRequest: "none",
        attentionOnly: true,
        search: " x ",
      }),
    ).toBe(5);
  });
});

describe("combined board filters", () => {
  it("intersects agent, request, project, search, and attention filters", () => {
    expect(
      visibleCards(board, "p1", "RUNNING", true, {
        activity: "running",
        changeRequest: "open",
        dateRange: "any",
      }).map((card) => card.id),
    ).toEqual(["running"]);
    expect(
      visibleCards(board, "p1", "", false, {
        activity: "waiting",
        changeRequest: "open",
        dateRange: "any",
      }),
    ).toEqual([]);
    expect(
      visibleCards(board, "all", "", false, {
        activity: "waiting",
        changeRequest: "draft",
        dateRange: "any",
      }).map((card) => card.id),
    ).toEqual(["waiting"]);
  });
  it("distinguishes no request, unknown state, and unavailable stale data", () => {
    const ids = (changeRequest: "none" | "unknown" | "unavailable") =>
      visibleCards(board, "all", "", false, {
        ...DEFAULT_FILTERS,
        changeRequest,
      }).map((card) => card.id);
    expect(ids("none")).toEqual(["draft"]);
    expect(ids("unknown")).toEqual(["unknown"]);
    expect(ids("unavailable")).toEqual(["unavailable", "missing-unavailable"]);
  });
  it("limits CI and review action filters to current open or draft requests", () => {
    for (const changeRequest of [
      "checks-failed",
      "changes-requested",
    ] as const) {
      expect(
        visibleCards(board, "all", "", false, {
          ...DEFAULT_FILTERS,
          changeRequest,
        }).map((card) => card.id),
      ).toEqual(["running", "waiting"]);
    }
  });
});

describe("date range filters", () => {
  // Wednesday 2026-10-14, local noon. This week starts Monday 2026-10-12.
  const now = new Date(2026, 9, 14, 12, 0, 0).getTime();
  const at = (month: number, day: number, hour = 9) =>
    new Date(2026, month - 1, day, hour, 0, 0).toISOString();
  const board = {
    cards: [
      card("no-date"),
      card("today", { lastConversationAt: at(10, 14, 8) }),
      card("yesterday", { lastConversationAt: at(10, 13, 8) }),
      card("three-days-ago", { lastConversationAt: at(10, 12, 8) }),
      card("four-days-ago", { lastConversationAt: at(10, 10, 8) }),
      card("last-month", { lastConversationAt: at(9, 28, 8) }),
      card("future", { lastConversationAt: at(10, 15, 8) }),
    ],
  } as Board;
  const ids = (range: BoardFilters["dateRange"]) =>
    visibleCards(
      board,
      "all",
      "",
      false,
      { ...DEFAULT_FILTERS, dateRange: range },
      now,
    ).map((item) => item.id);
  it("windows run from local midnight: today, three days, Monday-based week, calendar month", () => {
    expect(ids("today")).toEqual(["today", "future"]);
    expect(ids("3days")).toEqual([
      "today",
      "yesterday",
      "three-days-ago",
      "future",
    ]);
    expect(ids("week")).toEqual([
      "today",
      "yesterday",
      "three-days-ago",
      "future",
    ]);
    expect(ids("month")).toEqual([
      "today",
      "yesterday",
      "three-days-ago",
      "four-days-ago",
      "future",
    ]);
    expect(ids("any")).toHaveLength(7);
  });
  it("counts an active range as one condition and restores it from storage", () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, dateRange: "week" })).toBe(
      1,
    );
    expect(parseFilters(JSON.stringify({ dateRange: "week" }))).toEqual({
      ...DEFAULT_FILTERS,
      dateRange: "week",
    });
    expect(parseFilters(JSON.stringify({ dateRange: "hourly" }))).toEqual(
      DEFAULT_FILTERS,
    );
  });
});

describe("date range windows across daylight saving changes", () => {
  const originalTz = process.env.TZ;
  const dated = (id: string, utc: number) =>
    card(id, { lastConversationAt: new Date(utc).toISOString() });
  beforeAll(() => {
    // Windows run through real DST transitions, so the boundary math must use
    // calendar days; a fixed 48-hour subtraction is off by an hour here.
    process.env.TZ = "America/New_York";
  });
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });
  it("keeps calendar-day boundaries across the spring-forward gap", () => {
    // DST starts Sunday 2026-03-08 (23-hour day), so 48 hours before Monday
    // midnight reaches Mar 6 23:00 and would wrongly include Mar 6 cards.
    const now = Date.UTC(2026, 2, 9, 16, 0); // Monday 2026-03-09 noon EDT
    expect(
      matchesDateRange(
        dated("boundary", Date.UTC(2026, 2, 7, 5, 0)),
        "3days",
        now,
      ),
    ).toBe(true); // Mar 7 00:00 EST
    expect(
      matchesDateRange(
        dated("just-inside", Date.UTC(2026, 2, 7, 5, 30)),
        "3days",
        now,
      ),
    ).toBe(true); // Mar 7 00:30 EST
    expect(
      matchesDateRange(
        dated("wrongly-included", Date.UTC(2026, 2, 7, 4, 30)),
        "3days",
        now,
      ),
    ).toBe(false); // Mar 6 23:30 EST
  });
  it("keeps calendar-day boundaries across the fall-back repeat", () => {
    // DST ends Sunday 2026-11-01 (25-hour day), so 48 hours before Monday
    // midnight reaches Oct 31 01:00 and would wrongly exclude Oct 31 cards.
    const now = Date.UTC(2026, 10, 2, 17, 0); // Monday 2026-11-02 noon EST
    expect(
      matchesDateRange(
        dated("boundary", Date.UTC(2026, 9, 31, 4, 0)),
        "3days",
        now,
      ),
    ).toBe(true); // Oct 31 00:00 EDT
    expect(
      matchesDateRange(
        dated("wrongly-excluded", Date.UTC(2026, 9, 31, 4, 30)),
        "3days",
        now,
      ),
    ).toBe(true); // Oct 31 00:30 EDT
    expect(
      matchesDateRange(
        dated("outside", Date.UTC(2026, 9, 31, 3, 30)),
        "3days",
        now,
      ),
    ).toBe(false); // Oct 30 23:30 EDT
  });
});
