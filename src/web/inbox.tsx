import { goalList } from "./state.ts";

/** The picked goal at a glance: what it is, where it stands, what comes next. */
export function Briefer({ id }: { id: string }) {
  const goal = goalList.value.find((each) => each.id === id);
  if (goal === undefined) return null;
  return (
    <section class="card brief">
      <header>
        <b>{goal.title}</b> · {goal.status}
      </header>
      <div class="body">
        <div>now: {goal.workstream}</div>
        <div>next: {goal.next}</div>
        {goal.workers.length > 0 ? (
          <div class="help">workers: {goal.workers.join(", ")}</div>
        ) : null}
        {goal.vault === undefined ? null : <div class="help">vault: {goal.vault}</div>}
      </div>
    </section>
  );
}
