<script lang="ts">
  import Icon from "./Icon.svelte";
  import { formatSessionDate } from "./logic/format";
  import { navigate, paths } from "./router.svelte";
  import type { SessionSummary } from "./types";

  // One past session in a list (start page, history): date, title, size; opens its overview.
  let { session }: { session: SessionSummary } = $props();
</script>

<a
  class="card row"
  href={paths.session(session.id)}
  onclick={(e) => {
    e.preventDefault();
    navigate(paths.session(session.id));
  }}
>
  <span class="body">
    <span class="label">{formatSessionDate(session.started_at)}</span>
    <span class="name">{session.title ?? "Training"}</span>
  </span>
  <span class="muted count">{session.block_count} Üb. · {session.set_count} Sätze</span>
  <Icon name="chevron" size={20} />
</a>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 64px;
    padding: 10px 10px 10px 14px;
    color: var(--ink);
  }
  .row :global(svg) {
    color: var(--muted);
    flex: none;
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .name {
    font: 800 20px/1 var(--display);
    text-transform: uppercase;
    overflow-wrap: anywhere;
  }
  .count {
    font-size: 14px;
    white-space: nowrap;
  }
</style>
