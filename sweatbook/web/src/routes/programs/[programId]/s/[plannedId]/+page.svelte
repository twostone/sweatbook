<script lang="ts">
  import { page } from "$app/state";
  import PlannedView from "../../../../../PlannedView.svelte";
</script>

{#key page.params.plannedId}
  <PlannedView programId={page.params.programId!} plannedId={page.params.plannedId!} />
{/key}
