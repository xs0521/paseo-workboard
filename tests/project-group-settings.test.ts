import { describe, expect, it } from "vitest";
import { migrateData } from "../shared/migrations";
import {
  DATA_SCHEMA_VERSION,
  DEFAULT_GROUPS,
  dataSchema,
  groupConfig,
  mapStage,
  settingsSchema,
  withGroupConfig,
  groupMembers,
  withGroupMembership,
  withoutProjectGroups,
  type Group,
  type Settings,
} from "../shared/model";
import { cardsInGroupScope, groupDeleteReason } from "../client/board-utils";
import {
  mergedGroups,
  taskSections,
  visibleGroupScopes,
} from "../client/project-groups";
import { fixture, workspace } from "./fixtures";

const qa: Group = {
  id: "qa",
  name: "QA",
  kind: "review",
  label: "task:qa",
};
const withQa = (settings: Settings, projectId: string) =>
  withGroupConfig(settings, projectId, {
    groups: [...groupConfig(settings, projectId).groups, qa],
  });
const inProject = (id: string, projectId: string, labels: string[] = []) => ({
  ...workspace(id, id, labels),
  projectId,
  projectDisplayName: projectId,
});
async function started(...workspaces: ReturnType<typeof inProject>[]) {
  const test = fixture();
  test.inventory.workspaces.push(...workspaces);
  await test.board.start();
  const save = (settings: Settings) => {
    const board = test.board.snapshot();
    return test.board.mutate({
      action: "settings",
      revision: board.revision,
      expectedSettings: board.settings,
      settings,
    });
  };
  const card = (workspaceId: string) =>
    test.board.snapshot().cards.find((c) => c.workspaceId === workspaceId)!;
  return { ...test, save, card };
}

describe("group configuration", () => {
  const settings = settingsSchema.parse({});

  it("inherits the defaults until a project is customized", () => {
    expect(groupConfig(settings, "a").groups).toEqual(DEFAULT_GROUPS);
    const custom = withQa(settings, "a");
    expect(custom.groups).toEqual(DEFAULT_GROUPS);
    expect(groupConfig(custom, "a").groups).toContainEqual(qa);
    expect(groupConfig(custom, "b").groups).toEqual(DEFAULT_GROUPS);
    expect(groupConfig(withoutProjectGroups(custom, "a"), "a").groups).toEqual(
      DEFAULT_GROUPS,
    );
  });

  it("changes the defaults for an unassigned scope", () => {
    const next = withGroupConfig(settings, null, { groupOrder: ["todo"] });
    expect(next.groupOrder).toEqual(["todo"]);
    expect(next.projectGroups).toEqual({});
  });

  it("does not treat inherited object properties as project groups", () => {
    expect(groupConfig(settings, "constructor").groups).toEqual(DEFAULT_GROUPS);
  });

  it("maps a stage by identity, then by type", () => {
    const renamed = DEFAULT_GROUPS.map((group) =>
      group.id === "review" ? { ...group, id: "checks" } : group,
    );
    expect(mapStage("todo", DEFAULT_GROUPS, renamed)).toBe("todo");
    expect(mapStage("review", DEFAULT_GROUPS, renamed)).toBe("checks");
    const retyped = DEFAULT_GROUPS.map((group) =>
      group.id === "review" ? { ...group, kind: "done" as const } : group,
    );
    expect(mapStage("review", DEFAULT_GROUPS, retyped)).toBeUndefined();
  });

  it("keeps tasks and defaults when upgrading stored data", () => {
    const stored = dataSchema.parse({});
    const migrated = migrateData({ ...stored, schemaVersion: 13 }, 13);
    expect(migrated.schemaVersion).toBe(DATA_SCHEMA_VERSION);
    expect(migrated.settings.groups).toEqual(stored.settings.groups);
    expect(migrated.settings.projectGroups).toEqual({});
  });
});

describe("project-specific groups on the server", () => {
  it("resolves the same label through each workspace's project", async () => {
    const test = await started(
      inProject("a1", "a", ["task:qa"]),
      inProject("b1", "b", ["task:qa"]),
    );
    await test.save(withQa(test.board.snapshot().settings, "a"));
    expect(test.card("a1").stage).toBe("qa");
    expect(test.card("a1").managedLabels).toEqual(["task:qa"]);
    expect(test.card("b1").stage).toBe("inbox");
    expect(test.card("b1").managedLabels).toEqual([]);
  });

  it("moves a task only within its own project's groups", async () => {
    const test = await started(inProject("a1", "a"), inProject("b1", "b"));
    await test.save(withQa(test.board.snapshot().settings, "a"));
    await test.board.mutate({
      action: "stage",
      taskId: test.card("a1").id,
      stage: "qa",
      expectedLabels: [],
    });
    expect(test.card("a1").stage).toBe("qa");
    await expect(
      test.board.mutate({
        action: "stage",
        taskId: test.card("b1").id,
        stage: "qa",
        expectedLabels: [],
      }),
    ).rejects.toThrow("Group no longer exists");
  });

  it("copies inherited groups when a project is reordered first", async () => {
    const test = await started(inProject("a1", "a"));
    const order = DEFAULT_GROUPS.map((group) => group.id);
    await test.board.mutate({
      action: "reorder-groups",
      projectId: "a",
      expectedGroupOrder: order,
      groupOrder: [...order].reverse(),
    });
    const { settings } = test.board.snapshot();
    expect(settings.groupOrder).toEqual([]);
    expect(groupConfig(settings, "a").groupOrder).toEqual([...order].reverse());
  });

  it("adds a default group after reordering while projects inherit", async () => {
    const test = await started(inProject("a1", "a"));
    const order = DEFAULT_GROUPS.map((group) => group.id);
    await test.board.mutate({
      action: "reorder-groups",
      expectedGroupOrder: order,
      groupOrder: [...order].reverse(),
    });
    const { settings } = test.board.snapshot();
    await test.save({ ...settings, groups: [...settings.groups, qa] });
    expect(test.board.snapshot().settings.groupOrder).toEqual([
      ...[...order].reverse(),
      "qa",
    ]);
  });

  it("shows and changes where a group lives, keeping copies separate", async () => {
    const test = await started(
      inProject("a1", "a", ["task:qa"]),
      inProject("b1", "b", ["task:qa"]),
      inProject("c1", "c", ["task:qa"]),
    );
    const projects = ["a", "b", "c"];
    const start = test.board.snapshot().settings;
    const shared = withGroupMembership(
      start,
      qa,
      null,
      new Set(["a", "b"]),
      projects,
    );
    expect(shared.groups).toEqual(DEFAULT_GROUPS);
    await test.save(shared);
    expect(test.card("a1").stage).toBe("qa");
    expect(test.card("b1").stage).toBe("qa");
    expect(test.card("c1").stage).toBe("inbox");
    const saved = test.board.snapshot().settings;
    expect(groupMembers(saved, "qa", "a", projects)).toEqual(
      new Set(["a", "b"]),
    );
    const renamed = { ...qa, name: "Checks" };
    await test.save(
      withGroupMembership(saved, renamed, "a", new Set(["a", "b"]), projects),
    );
    const edited = test.board.snapshot().settings;
    expect(groupConfig(edited, "a").groups).toContainEqual(renamed);
    expect(groupConfig(edited, "b").groups).toContainEqual(qa);
    await test.board.mutate({
      action: "stage",
      taskId: test.card("b1").id,
      stage: "review",
      expectedLabels: ["task:qa"],
    });
    await test.save(
      withGroupMembership(
        test.board.snapshot().settings,
        renamed,
        "a",
        new Set(["a"]),
        projects,
      ),
    );
    expect(
      groupMembers(test.board.snapshot().settings, "qa", "a", projects),
    ).toEqual(new Set(["a"]));
  });

  it("refuses to remove a group from a project that still uses it", async () => {
    const test = await started(inProject("a1", "a", ["task:qa"]));
    await test.save(withQa(test.board.snapshot().settings, "a"));
    await expect(
      test.save(
        withGroupMembership(
          test.board.snapshot().settings,
          qa,
          null,
          new Set(),
          ["a"],
        ),
      ),
    ).rejects.toThrow("group-tasks-in-use");
  });

  it("gives an inheriting project a copy only when it differs", () => {
    const settings = settingsSchema.parse({});
    const review = DEFAULT_GROUPS.find((group) => group.id === "review")!;
    const projects = ["a", "b"];
    const without = withGroupMembership(
      settings,
      review,
      null,
      new Set([null, "b"]),
      projects,
    );
    expect(Object.keys(without.projectGroups)).toEqual(["a"]);
    expect(groupMembers(without, "review", null, projects)).toEqual(
      new Set([null, "b"]),
    );
    const moved = withGroupMembership(
      settings,
      review,
      null,
      new Set(["b"]),
      projects,
    );
    expect(groupMembers(moved, "review", null, projects)).toEqual(
      new Set(["b"]),
    );
    expect(Object.keys(moved.projectGroups)).toEqual(["b"]);
  });

  it("starts a new group where it was opened", () => {
    const settings = withQa(settingsSchema.parse({}), "a");
    expect(groupMembers(settings, "new", "b", ["a", "b"])).toEqual(
      new Set(["b"]),
    );
    expect(groupMembers(settings, "new", null, ["a", "b"])).toEqual(
      new Set([null, "b"]),
    );
  });

  it("copies an edit made in an inheriting project", () => {
    const settings = settingsSchema.parse({});
    const review = {
      ...DEFAULT_GROUPS.find((group) => group.id === "review")!,
      name: "Checks",
    };
    const next = withGroupMembership(
      settings,
      review,
      "a",
      new Set([null, "a", "b"]),
      ["a", "b"],
    );
    expect(next.groups).toEqual(DEFAULT_GROUPS);
    expect(Object.keys(next.projectGroups)).toEqual(["a"]);
    expect(groupConfig(next, "a").groups).toContainEqual(review);
  });

  it("keeps a default group removable while a project holds its own copy", async () => {
    const test = await started(inProject("a1", "a", ["task:review"]));
    const { settings } = test.board.snapshot();
    const custom = withGroupConfig(settings, "a", { groups: settings.groups });
    await test.save(custom);
    await test.save({
      ...custom,
      groups: custom.groups.filter((group) => group.id !== "review"),
    });
    expect(test.card("a1").stage).toBe("review");
  });

  it("protects a group that still holds a project's workspace", async () => {
    const test = await started(inProject("a1", "a", ["task:review"]));
    const { settings } = test.board.snapshot();
    await expect(
      test.save(
        withGroupConfig(settings, "a", {
          groups: settings.groups.filter((group) => group.id !== "review"),
        }),
      ),
    ).rejects.toThrow("group-tasks-in-use");
  });

  it("refuses to reset a project while its own group holds tasks", async () => {
    const test = await started(inProject("a1", "a", ["task:qa"]));
    const custom = withQa(test.board.snapshot().settings, "a");
    await test.save(custom);
    await expect(test.save(withoutProjectGroups(custom, "a"))).rejects.toThrow(
      "group-tasks-in-use",
    );
    await test.board.mutate({
      action: "stage",
      taskId: test.card("a1").id,
      stage: "review",
      expectedLabels: ["task:qa"],
    });
    await test.save(withoutProjectGroups(custom, "a"));
    expect(test.board.snapshot().settings.projectGroups).toEqual({});
    expect(test.card("a1").stage).toBe("review");
  });

  it("retains a saved card order while another project uses the stage", async () => {
    const test = await started(inProject("a1", "a"), inProject("b1", "b"));
    let settings = withQa(withQa(test.board.snapshot().settings, "a"), "b");
    await test.save(settings);
    await test.store.update((data) => {
      data.cardOrderByStage.qa = ["kept"];
    });
    settings = test.board.snapshot().settings;
    settings = withGroupConfig(settings, "a", {
      groups: DEFAULT_GROUPS,
    });
    await test.save(settings);
    expect(test.board.snapshot().cardOrderByStage.qa).toEqual(["kept"]);
    await test.save(withGroupConfig(settings, "b", { groups: DEFAULT_GROUPS }));
    expect(test.board.snapshot().cardOrderByStage.qa).toBeUndefined();
  });

  it("maps a draft to the new project's groups when it moves", async () => {
    const test = await started(inProject("a1", "a"));
    const { settings } = test.board.snapshot();
    await test.save(
      withGroupConfig(settings, "a", {
        groups: [
          ...settings.groups.filter((group) => group.id !== "todo"),
          {
            ...settings.groups.find((group) => group.id === "todo")!,
            id: "next",
          },
        ],
      }),
    );
    await test.board.mutate({
      action: "create",
      title: "Draft",
      description: "",
      projectId: null,
    });
    const draft = test.board
      .snapshot()
      .cards.find((card) => card.title === "Draft")!;
    await test.board.mutate({
      action: "edit",
      taskId: draft.id,
      updatedAt: draft.updatedAt,
      title: "Draft",
      description: "",
      projectId: "a",
    });
    const moved = test.board.snapshot().cards.find((c) => c.id === draft.id)!;
    expect(moved.stage).toBe("next");
    expect(moved.draftStage).toBe("next");
  });

  it("starts a draft in the group of the workspace's project", async () => {
    const test = await started(inProject("a1", "a"));
    const { settings } = test.board.snapshot();
    await test.save(
      withGroupConfig(settings, "a", {
        groups: [
          ...settings.groups.filter((group) => group.id !== "in-progress"),
          {
            ...settings.groups.find((group) => group.id === "in-progress")!,
            id: "doing",
          },
        ],
      }),
    );
    await test.board.mutate({
      action: "create",
      title: "Draft",
      description: "",
      projectId: null,
    });
    const draft = test.board
      .snapshot()
      .cards.find((card) => card.title === "Draft")!;
    await test.board.mutate({
      action: "start",
      taskId: draft.id,
      stage: "in-progress",
      target: { kind: "existing", workspaceId: "a1" },
    });
    expect(test.card("a1").stage).toBe("doing");
  });
});

describe("merged columns", () => {
  const settings = withQa(
    withGroupConfig(settingsSchema.parse({}), "b", {
      groups: DEFAULT_GROUPS.filter((group) => group.id !== "review"),
    }),
    "a",
  );

  it("collapses projects on the defaults into one scope", () => {
    expect(visibleGroupScopes(settings, [])).toEqual([null, "b", "a"]);
    expect(visibleGroupScopes(settings, ["c", "none"])).toEqual([null]);
    expect(visibleGroupScopes(settings, ["a", "c"])).toEqual([null, "a"]);
    expect(visibleGroupScopes(settings, ["a"])).toEqual(["a"]);
  });

  it("shows each group ID once, owned by the first scope holding it", () => {
    const { groups, owner } = mergedGroups(settings, ["b", "a"]);
    expect(groups.map((group) => group.id)).toEqual([
      ...DEFAULT_GROUPS.filter((group) => group.id !== "review").map(
        (group) => group.id,
      ),
      "review",
      "qa",
    ]);
    expect(owner.get("todo")).toBe("b");
    expect(owner.get("review")).toBe("a");
    expect(owner.get("qa")).toBe("a");
  });

  it("leaves stored groups unchanged", () => {
    const before = structuredClone(settings);
    mergedGroups(settings, [null, "a", "b"]);
    expect(settings).toEqual(before);
  });
});

describe("project sections", () => {
  it("orders each project by its own groups and counts its own stages", async () => {
    const test = await started(
      inProject("a1", "a", ["task:qa"]),
      inProject("b1", "b", ["task:todo"]),
    );
    await test.save(withQa(test.board.snapshot().settings, "a"));
    const board = test.board.snapshot();
    const sections = taskSections({
      cards: board.cards,
      fullCards: board.cards,
      groups: board.settings.groups,
      groupsFor: (projectId) => groupConfig(board.settings, projectId).groups,
      cardOrderByStage: {},
      projects: [],
      unassigned: "None",
    });
    expect(sections.map((s) => [s.projectId, s.cards.length, s.total])).toEqual(
      [
        ["a", 1, 1],
        ["b", 1, 1],
      ],
    );
  });

  it("limits delete rules to the edited scope", async () => {
    const test = await started(
      inProject("a1", "a", ["task:review"]),
      inProject("b1", "b"),
    );
    const custom = withGroupConfig(test.board.snapshot().settings, "b", {});
    await test.save(custom);
    const board = test.board.snapshot();
    const review = board.settings.groups.find((g) => g.id === "review")!;
    const projectB = cardsInGroupScope(board.cards, board.settings, "b");
    expect(projectB.map((card) => card.workspaceId)).toEqual(["b1"]);
    expect(
      groupDeleteReason(projectB, DEFAULT_GROUPS, review, undefined, true),
    ).toBeNull();
    expect(
      groupDeleteReason(
        cardsInGroupScope(board.cards, board.settings, null),
        DEFAULT_GROUPS,
        review,
        board.settings,
      ),
    ).toBe("groupDeleteNotEmpty");
  });
});
