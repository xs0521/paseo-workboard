import { useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, Modal } from "@getpaseo/plugin/client/react-native";
import {
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
} from "@getpaseo/plugin/client/ui";
import {
  defaultGroup,
  defaultWorkspaceGroup,
  GROUP_COLORS,
  groupColorKey,
  groupConfig,
  groupMembers,
  groupsSchema,
  hasProjectGroups,
  isDraftGroup,
  labelKey,
  nextGroupColor,
  orderedGroups,
  STAGES,
  withGroupConfig,
  withGroupMembership,
  type Board,
  type Group,
  type GroupColor,
  type Settings,
  type StageKind,
} from "../shared/model";
import {
  boardNow,
  cardsInGroupScope,
  groupDeleteReason,
  groupTasks,
  mappingPreview,
} from "./board-utils";
import { groupColor, groupColorValue } from "./colors";
import { groupTitle, strings } from "./strings";
import { ConfirmationModal } from "./ConfirmationModal";

type Props = {
  board: Board;
  groups: Group[];
  projectId?: string | null;
  onChange(groups: Group[]): Promise<boolean>;
  disabled: boolean;
  saving: boolean;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
};

export function GroupSettings({
  board,
  groups: defaultGroups,
  onChange: save,
  onReset,
  onSaveSettings,
  disabled,
  saving,
  t,
  theme,
}: Omit<Props, "onChange"> & {
  onChange(groups: Group[], projectId: string | null): Promise<boolean>;
  onReset(projectId: string): Promise<boolean>;
  onSaveSettings?(settings: Settings): Promise<boolean>;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const projectId = board.projects.some((project) => project.id === selected)
    ? selected
    : null;
  const custom = hasProjectGroups(board.settings, projectId);
  const scope = projectId
    ? groupConfig(board.settings, projectId)
    : { groups: defaultGroups, groupOrder: board.settings.groupOrder };
  const groups = scope.groups;
  const cards = cardsInGroupScope(board.cards, board.settings, projectId);
  const onChange = (next: Group[]) => save(next, projectId);
  const [editing, setEditing] = useState<{
    group: Group;
    groups: Group[];
    onChange: Props["onChange"];
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    group: Group;
    groups: Group[];
    onChange: Props["onChange"];
  } | null>(null);
  return (
    <SettingsSection
      title={t.groups}
      trailing={
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() =>
            setEditing({ group: newGroup(groups), groups, onChange })
          }
          style={styles.button}
        >
          <Icon
            name="Plus"
            size={16}
            color={
              disabled ? theme.colors.foregroundMuted : theme.colors.foreground
            }
          />
          <Text style={[styles.text, { color: theme.colors.foreground }]}>
            {t.addGroup}
          </Text>
        </Pressable>
      }
    >
      <Text style={[styles.hint, { color: theme.colors.foregroundMuted }]}>
        {t.groupsHint}
      </Text>
      {board.projects.length > 0 && (
        <SettingsCard>
          <SettingsSelect
            label={t.groupScope}
            value={projectId ?? ""}
            options={[
              { value: "", label: t.defaultGroups },
              ...board.projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
            onValueChange={(value) => setSelected(value || null)}
            disabled={disabled}
            testID="workboard-group-scope"
          />
          {projectId && (
            <SettingsRow
              label={custom ? t.projectGroupsCustom : t.projectGroupsInherited}
              testID="workboard-group-scope-state"
            >
              {custom && (
                <Pressable
                  accessibilityRole="button"
                  disabled={disabled}
                  onPress={() => setResetting(true)}
                  style={styles.button}
                  testID="workboard-reset-project-groups"
                >
                  <Text
                    style={[styles.text, { color: theme.colors.foreground }]}
                  >
                    {t.resetProjectGroups}
                  </Text>
                </Pressable>
              )}
            </SettingsRow>
          )}
        </SettingsCard>
      )}
      <SettingsCard>
        {orderedGroups(scope).map((group) => {
          const title = groupTitle(group, t);
          const original =
            groupConfig(board.settings, projectId).groups.find(
              (item) => item.id === group.id,
            ) ?? group;
          const count = groupTasks(cards, original).length;
          const reason = groupDeleteReason(
            cards,
            groups,
            original,
            projectId ? undefined : board.settings,
            !!projectId,
          );
          const cannotDelete = disabled || reason !== null;
          return (
            <SettingsRow
              key={group.id}
              label={title}
              hint={[
                [
                  t.stages[group.kind],
                  group.label,
                  t.groupTasks.replace("{count}", String(count)),
                  group.id ===
                  defaultGroup(groups, board.settings.defaultDraftGroup)
                    ? t.defaultGroup
                    : "",
                  group.id ===
                  defaultWorkspaceGroup(
                    groups,
                    board.settings.defaultStartGroup,
                  )
                    ? t.defaultWorkspaceGroup
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · "),
                reason ? t[reason] : "",
              ]
                .filter(Boolean)
                .join("\n")}
              testID={`workboard-group-${group.id}`}
            >
              <View style={styles.actions}>
                <View
                  accessibilityLabel={`${t.groupColor}: ${t.groupColors[groupColorKey(group)]}`}
                  style={[
                    styles.groupDot,
                    { backgroundColor: groupColor(group, theme) },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.editGroup}: ${title}`}
                  disabled={disabled}
                  onPress={() => setEditing({ group, groups, onChange })}
                  style={styles.button}
                >
                  <Icon
                    name="Pencil"
                    size={16}
                    color={theme.colors.foregroundMuted}
                  />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t.deleteGroup}: ${title}${reason ? ` · ${t[reason]}` : ""}`}
                  disabled={cannotDelete}
                  onPress={() => setDeleting({ group, groups, onChange })}
                  style={styles.button}
                >
                  <Icon
                    name="Trash2"
                    size={16}
                    color={
                      cannotDelete
                        ? theme.colors.foregroundMuted
                        : theme.colors.statusDanger
                    }
                  />
                </Pressable>
              </View>
            </SettingsRow>
          );
        })}
      </SettingsCard>
      {deleting && (
        <ConfirmationModal
          title={t.deleteGroup}
          description={t.deleteGroupConfirm.replace(
            "{name}",
            groupTitle(deleting.group, t),
          )}
          confirmLabel={t.deleteGroup}
          disabled={
            disabled ||
            groupDeleteReason(
              cards,
              groups,
              deleting.group,
              projectId ? undefined : board.settings,
              !!projectId,
            ) !== null
          }
          t={t}
          theme={theme}
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            deleting.onChange(
              deleting.groups.filter((item) => item.id !== deleting.group.id),
            )
          }
        />
      )}
      {resetting && projectId && (
        <ConfirmationModal
          title={t.resetProjectGroups}
          description={t.resetProjectGroupsConfirm}
          confirmLabel={t.resetProjectGroups}
          disabled={disabled}
          t={t}
          theme={theme}
          onClose={() => setResetting(false)}
          onConfirm={() => onReset(projectId)}
        />
      )}
      {editing && (
        <GroupEditor
          board={board}
          projectId={projectId}
          groups={editing.groups}
          group={editing.group}
          disabled={disabled || saving}
          saving={saving}
          t={t}
          theme={theme}
          onClose={() => setEditing(null)}
          onChange={editing.onChange}
          onSaveSettings={onSaveSettings}
        />
      )}
    </SettingsSection>
  );
}

export function newGroup(groups: readonly Group[]): Group {
  return {
    id: `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: "",
    kind: "todo",
    label: "",
    color: nextGroupColor(groups),
  };
}

export function GroupEditor({
  board,
  projectId = null,
  settings = board.settings,
  groups,
  group,
  onChange,
  onSaveSettings,
  onClose,
  ...props
}: Props & {
  group: Group;
  settings?: Settings;
  onClose(): void;
  onSaveSettings?(settings: Settings): Promise<boolean>;
}) {
  const { t, theme, disabled } = props;
  const projects = board.projects.map((project) => project.id);
  const [members, setMembers] = useState<ReadonlySet<string | null>>(() =>
    groupMembers(settings, group.id, projectId, projects),
  );
  const picker = !!onSaveSettings && projects.length > 0;
  const scopeOptions: { scope: string | null; label: string }[] = [
    { scope: null, label: t.defaultGroups },
    ...board.projects.map((project) => ({
      scope: project.id,
      label: project.name,
    })),
  ];
  const membership = (candidate: Group) =>
    withGroupMembership(settings, candidate, projectId, members, projects);
  const groupsIn = (scope: string | null) =>
    scope === projectId ? groups : groupConfig(settings, scope).groups;
  const withGroup = (scope: string | null, candidate: Group) =>
    groupsIn(scope).some((item) => item.id === candidate.id)
      ? groupsIn(scope).map((item) =>
          item.id === candidate.id ? candidate : item,
        )
      : [...groupsIn(scope), candidate];
  const invalid = (
    scope: string | null,
    next: Group[],
    candidate: Group,
    cards: readonly Board["cards"][number][],
  ) => {
    if (!next.some((item) => item.kind === "todo")) return t.groupNeedsTodo;
    if (!next.some((item) => item.kind === "inbox")) return t.groupNeedsInbox;
    if (!next.some((item) => item.kind === "canceled"))
      return t.groupNeedsCanceled;
    if (new Set(next.map((item) => labelKey(item.label))).size !== next.length)
      return t.groupLabelDuplicate;
    if (
      cards.some(
        (card) =>
          !card.workspaceId &&
          !card.archived &&
          card.stage === candidate.id &&
          !isDraftGroup(candidate.id, next),
      )
    )
      return t.groupNotEmpty;
    return groupsSchema.safeParse(next).success ? null : t.groupInvalid;
  };
  const membershipError = (candidate: Group, next: Settings) => {
    if (!members.size) return t.groupScopeRequired;
    for (const { scope, label } of scopeOptions) {
      const before = groupConfig(settings, scope).groups;
      const after = groupConfig(next, scope).groups;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      const cards = cardsInGroupScope(board.cards, next, scope);
      const removed = before.find(
        (item) => !after.some((kept) => kept.id === item.id),
      );
      const reason = removed
        ? groupDeleteReason(
            cards,
            before,
            removed,
            scope ? undefined : board.settings,
            !!scope,
          )
        : null;
      const error = reason
        ? t[reason]
        : invalid(scope, after, candidate, cards);
      if (error) return `${label}: ${error}`;
    }
    return null;
  };
  const apply = async (candidate: Group): Promise<string | null> => {
    let saved: boolean;
    if (picker) {
      const next = membership(candidate);
      const error = membershipError(candidate, next);
      if (error) return error;
      saved = await onSaveSettings!(next);
    } else {
      const next = withGroup(projectId, candidate);
      const error = invalid(
        projectId,
        next,
        candidate,
        cardsInGroupScope(board.cards, board.settings, projectId),
      );
      if (error) return error;
      saved = await onChange(groupsSchema.parse(next));
    }
    if (!saved) return t.groupSaveFailed;
    onClose();
    return null;
  };
  const toggle = (scope: string | null) =>
    setMembers((current) => {
      const next = new Set(current);
      const checked = !next.delete(scope);
      if (checked) next.add(scope);
      // Projects on the defaults follow them unless unchecked afterwards.
      if (scope === null)
        for (const project of projects)
          if (!hasProjectGroups(settings, project))
            if (checked) next.add(project);
            else next.delete(project);
      return next;
    });
  return (
    <GroupForm
      {...props}
      group={group}
      onClose={onClose}
      onSave={apply}
      preview={(candidate) =>
        mappingPreview(
          board.cards,
          picker
            ? membership(candidate)
            : withGroupConfig(board.settings, projectId, {
                groups: withGroup(projectId, candidate),
              }),
          boardNow(board),
        )
      }
      autoArchive={
        board.settings.archiveDoneEnabled ||
        board.settings.archiveCanceledEnabled
      }
      scopePicker={
        picker ? (
          <View style={styles.colorField} testID="workboard-group-apply-to">
            <Text style={[styles.text, { color: theme.colors.foreground }]}>
              {t.groupApplyTo}
            </Text>
            <Text
              style={[styles.hint, { color: theme.colors.foregroundMuted }]}
            >
              {t.groupApplyToHint}
            </Text>
            {scopeOptions.map((option) => {
              const checked = members.has(option.scope);
              return (
                <Pressable
                  key={option.scope ?? ""}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${t.groupApplyTo}: ${option.label}`}
                  accessibilityState={{ checked, disabled }}
                  aria-checked={checked}
                  disabled={disabled}
                  onPress={() => toggle(option.scope)}
                  style={[styles.scopeRow, disabled && { opacity: 0.5 }]}
                >
                  <View
                    style={[
                      styles.scopeBox,
                      {
                        borderColor: checked
                          ? theme.colors.accent
                          : theme.colors.border,
                        backgroundColor: checked
                          ? theme.colors.accent
                          : "transparent",
                      },
                    ]}
                  >
                    {checked && (
                      <Icon
                        name="Check"
                        size={14}
                        color={theme.colors.accentForeground}
                      />
                    )}
                  </View>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.text,
                      styles.scopeName,
                      { color: theme.colors.foreground },
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null
      }
    />
  );
}

function GroupForm({
  group,
  disabled,
  saving,
  t,
  theme,
  onClose,
  onSave,
  preview,
  autoArchive,
  scopePicker,
}: Pick<Props, "disabled" | "saving" | "t" | "theme"> & {
  group: Group;
  onClose(): void;
  onSave(group: Group): Promise<string | null>;
  preview(group: Group): ReturnType<typeof mappingPreview>;
  autoArchive: boolean;
  scopePicker?: ReactNode;
}) {
  const initialName = groupTitle(group, t);
  const [name, setName] = useState(initialName);
  const [label, setLabel] = useState(group.label);
  const [kind, setKind] = useState(group.kind);
  const [color, setColor] = useState<GroupColor>(() => groupColorKey(group));
  const [error, setError] = useState<string | null>(null);
  const candidate = {
    ...group,
    color,
    kind,
    name: group.name === null && name === initialName ? null : name.trim(),
    label:
      label.trim() || `task:${name.trim().replace(/\s+/g, "-").toLowerCase()}`,
  };
  const impact = preview(candidate);
  return (
    <Modal
      open
      title={group.label ? t.editGroup : t.addGroup}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Modal.Content>
        <SettingsCard>
          <SettingsInput
            label={t.groupName}
            initialValue={initialName}
            onChangeText={setName}
            disabled={disabled}
          />
          <View style={styles.colorField}>
            <Text style={[styles.text, { color: theme.colors.foreground }]}>
              {t.groupColor}
            </Text>
            <Text
              style={[styles.hint, { color: theme.colors.foregroundMuted }]}
            >
              {t.groupColorHint}
            </Text>
            <View style={styles.colorPreview}>
              <View
                style={[
                  styles.colorDot,
                  { backgroundColor: groupColorValue(color, theme) },
                ]}
              />
              <Text style={[styles.text, { color: theme.colors.foreground }]}>
                {t.groupColors[color]}
              </Text>
            </View>
            <View style={styles.colorChoices} accessibilityRole="radiogroup">
              {GROUP_COLORS.map((value) => {
                const selected = value === color;
                const tone = groupColorValue(value, theme);
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={`${t.groupColor}: ${t.groupColors[value]}`}
                    accessibilityState={{ checked: selected }}
                    aria-checked={selected}
                    disabled={disabled}
                    onPress={() => setColor(value)}
                    style={[
                      styles.colorChoice,
                      {
                        borderColor: selected ? tone : theme.colors.border,
                        backgroundColor: selected
                          ? theme.colors.surface2
                          : "transparent",
                        opacity: disabled ? 0.5 : 1,
                      },
                    ]}
                  >
                    <View
                      style={[styles.colorDot, { backgroundColor: tone }]}
                    />
                    {selected && (
                      <View style={styles.colorCheck}>
                        <Icon name="Check" size={14} color={tone} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <SettingsSelect<StageKind>
            label={t.groupType}
            hint={t.groupTypeHints[kind]}
            value={kind}
            options={STAGES.map((value) => ({ value, label: t.stages[value] }))}
            onValueChange={setKind}
            disabled={disabled}
          />
          <SettingsInput
            label={t.groupLabel}
            initialValue={group.label}
            placeholder={t.groupLabelPlaceholder}
            onChangeText={setLabel}
            disabled={disabled}
          />
          {scopePicker}
        </SettingsCard>
        {(impact.affected > 0 || (autoArchive && impact.due > 0)) && (
          <Text style={[styles.hint, { color: theme.colors.statusWarning }]}>
            {t.mappingPreview.replace("{count}", String(impact.affected))}
            {autoArchive &&
              `\n${t.duePreview.replace("{count}", String(impact.due))}`}
          </Text>
        )}
        {error && (
          <Text
            accessibilityRole="alert"
            style={[styles.hint, { color: theme.colors.statusDanger }]}
          >
            {error}
          </Text>
        )}
        <View style={[styles.actions, styles.formActions]}>
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={onClose}
            style={styles.button}
          >
            <Text
              style={[styles.text, { color: theme.colors.foregroundMuted }]}
            >
              {t.cancel}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={disabled || !name.trim()}
            onPress={async () => setError(await onSave(candidate))}
            style={[
              styles.button,
              {
                backgroundColor: theme.colors.accent,
                opacity: disabled || !name.trim() ? 0.5 : 1,
              },
            ]}
          >
            <Text
              style={[styles.text, { color: theme.colors.accentForeground }]}
            >
              {t.save}
            </Text>
          </Pressable>
        </View>
      </Modal.Content>
    </Modal>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 36,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  text: { fontSize: 14, lineHeight: 20 },
  hint: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  formActions: { justifyContent: "flex-end", marginTop: 12, gap: 8 },
  groupDot: { width: 10, height: 10, borderRadius: 5 },
  colorField: { gap: 6, paddingVertical: 10, paddingHorizontal: 16 },
  colorPreview: { flexDirection: "row", alignItems: "center", gap: 6 },
  colorChoices: { flexDirection: "row", flexWrap: "wrap", width: 224, gap: 6 },
  colorChoice: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  scopeRow: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  scopeBox: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  scopeName: { flex: 1 },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  colorCheck: { position: "absolute", right: 3, bottom: 3 },
});
