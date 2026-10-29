<script lang="ts">
  import { page } from "$app/state";
  import BlockView from "../../../../../BlockView.svelte";
  import { app } from "../../../../../store.svelte";
</script>

{#key page.params.blockId}
  <BlockView session={app.session!} blockId={page.params.blockId!} />
{/key}
