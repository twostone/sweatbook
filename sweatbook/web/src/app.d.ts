import type { SheetState } from "./store.svelte";

declare global {
  namespace App {
    // A sheet lives in the history entry (shallow routing), so "back" closes it.
    interface PageState {
      sheet?: SheetState;
    }
  }
}

export {};
