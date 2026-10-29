<script lang="ts">
  import { page } from "$app/state";
  import ProgramView from "../../../ProgramView.svelte";
</script>

{#key page.params.programId}
  <ProgramView programId={page.params.programId!} />
{/key}
