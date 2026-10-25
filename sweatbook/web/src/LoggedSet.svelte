<script lang="ts">
  import { untrack } from "svelte";
  import SetRow from "./SetRow.svelte";
  import { restoreRow, rowFromValues, valuesFromRow, type RowField, type RowText } from "./logic/set-row";
  import * as storage from "./storage";
  import { deleteSet, updateSet } from "./store.svelte";
  import type { Field, SetLog } from "./types";

  // A logged set, editable in place. A change is saved at once; if that fails the typed text stays (also in
  // localStorage) and the row offers to send it again.
  let { set, blockExerciseId, fields, index, label }: { set: SetLog; blockExerciseId: string; fields: Field[]; index: number; label: string } =
    $props();

  type Edit = RowText & { is_max: boolean; note: string };
  // The row is keyed by the set id, so its text starts from the set (or an unsent edit) once and then follows typing.
  const initial = untrack(() => set);
  const key = `row:edit:${initial.id}`;
  const stored = storage.load<Edit>(key);
  let text = $state<RowText>(restoreRow(stored, rowFromValues(initial)));
  let isMax = $state(stored?.is_max ?? initial.is_max);
  let note = $state(stored?.note ?? initial.note ?? "");
  let invalid = $state<RowField | null>(null);
  let unsaved = $state(stored !== null);

  const keepEdit = () => storage.save(key, { ...$state.snapshot(text), is_max: isMax, note });

  async function send() {
    const parsed = valuesFromRow(text, fields);
    invalid = parsed.ok ? null : parsed.field;
    if (!parsed.ok) return;
    keepEdit();
    const ok = await updateSet(blockExerciseId, set.id, { ...parsed.values, is_max: isMax, note: note.trim() || null });
    unsaved = !ok;
    if (ok) storage.remove(key);
  }

  async function removeSet() {
    if (await deleteSet(blockExerciseId, set.id)) storage.remove(key);
  }
</script>

<SetRow {fields} index={String(index)} {label} bind:text bind:isMax bind:note {invalid} {unsaved} onchange={send} oninput={keepEdit} ondelete={removeSet} />
