import {
  cardsForStage,
  groupConfig,
  hasProjectGroups,
  orderedGroups,
  type Settings,
  type Card,
  type CardOrderByStage,
  type Group,
  type Board,
} from "../shared/model";

export function sortPriorityCards(cards: readonly Card[]): Card[] {
  const rank = { p0: 0, p1: 1, p2: 2, p3: 3 };
  return [...cards].sort(
    (a, b) => rank[a.priority ?? "p2"] - rank[b.priority ?? "p2"],
  );
}

export type TaskSection = {
  id: string;
  projectId: string | null;
  title: string;
  cards: Card[];
  total: number;
};

/** Group by project identity, never its editable display name. Sorting leaves stored order intact. */
export function taskSections(input: {
  cards: Card[];
  fullCards: Card[];
  groups: Group[];
  groupsFor?(projectId: string | null): readonly Group[];
  cardOrderByStage: CardOrderByStage;
  projects: Board["projects"];
  unassigned: string;
}): TaskSection[] {
  const sections = new Map<string, TaskSection>();
  const key = (card: Card) =>
    card.projectId === null ? "project:none" : `project:id:${card.projectId}`;
  const projectNames = new Map(
    input.projects.map((project) => [project.id, project.name]),
  );
  const counts = new Map<string, number>();
  const groupsOf = (projectId: string | null) =>
    input.groupsFor?.(projectId) ?? input.groups;
  for (const card of input.fullCards) {
    if (
      !groupsOf(card.projectId).some((group) => group.id === card.stage) ||
      card.archived?.status === "archived" ||
      card.archived?.status === "external"
    )
      continue;
    counts.set(key(card), (counts.get(key(card)) ?? 0) + 1);
  }
  const ordered = [
    ...new Set(input.cards.map((card) => card.projectId)),
  ].flatMap((projectId) => {
    const cards = input.cards.filter((card) => card.projectId === projectId);
    return groupsOf(projectId).flatMap((group) =>
      cardsForStage(cards, group.id, input.cardOrderByStage),
    );
  });
  for (const card of ordered) {
    const id = key(card);
    if (!sections.has(id))
      sections.set(id, {
        id,
        projectId: card.projectId,
        title:
          (card.projectId !== null
            ? projectNames.get(card.projectId)
            : undefined) ||
          card.projectName ||
          input.unassigned,
        cards: [],
        total: counts.get(id) ?? 0,
      });
    sections.get(id)!.cards.push(card);
  }
  const values = [...sections.values()];
  values.sort(
    (a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id),
  );
  return values;
}

/** The distinct group lists behind a project selection; projects on the defaults share null. */
export function visibleGroupScopes(
  settings: Pick<Settings, "groups" | "groupOrder" | "projectGroups">,
  projectIds: readonly string[],
): (string | null)[] {
  const ids = projectIds.length
    ? projectIds.map((id) => (id === "none" ? null : id))
    : [null, ...Object.keys(settings.projectGroups)];
  return [
    ...new Set(ids.map((id) => (hasProjectGroups(settings, id) ? id : null))),
  ].sort((a, b) => (a === null ? -1 : b === null ? 1 : 0));
}

/**
 * Display-only columns for several projects: groups sharing an ID share a column, titled by the
 * first scope that holds it, with the defaults first. Stored groups are not changed.
 */
export function mergedGroups(
  settings: Pick<Settings, "groups" | "groupOrder" | "projectGroups">,
  scopes: readonly (string | null)[],
): { groups: Group[]; owner: Map<string, string | null> } {
  const groups: Group[] = [];
  const owner = new Map<string, string | null>();
  for (const scope of scopes)
    for (const group of orderedGroups(groupConfig(settings, scope)))
      if (!owner.has(group.id)) {
        owner.set(group.id, scope);
        groups.push(group);
      }
  return { groups, owner };
}
