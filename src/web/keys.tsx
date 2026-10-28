/**
 * Message actions and contextual picker controls. Buttons keep the editor focused so a touch keyboard stays open.
 */
import type { ComponentChildren } from "preact";
import { presentation } from "../ui/state.ts";
import { run } from "./commands.ts";
import { editing, escapeLeaves, shown, view } from "./state.ts";

/** Queue delivery modes. */
export const MODE = { steer: "↯", followUp: "⇢" };

/** Preserve editor focus when a message or picker action is clicked. */
export function Key(props: {
  label: string;
  title: string;
  class?: string;
  pressed?: boolean;
  disabled?: boolean;
  onPress: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      class={props.class}
      aria-label={props.label}
      title={props.title}
      disabled={props.disabled}
      {...(props.pressed === undefined ? {} : { "aria-pressed": props.pressed })}
      // A tap must not take focus from the editor, or the keyboard closes.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onPress}
    >
      {props.children}
    </button>
  );
}

/** Only the actions needed to send, stop, or finish editing a message. */
export function ComposerActions({ send }: { send: () => void }) {
  const root = view(undefined)?.value;
  const stoppable = shown.value === undefined && root !== undefined && presentation(root).busy;
  const edit = editing.value !== undefined;
  const touch = matchMedia("(pointer: coarse)").matches;
  if (!edit && !stoppable && !touch) return null;
  return (
    <div class="composer-actions" role="group" aria-label="Message actions">
      {edit ? (
        <Key label="cancel edit" title="cancel the edit (Esc)" onPress={() => run("edit.leave")}>
          Cancel
        </Key>
      ) : stoppable ? (
        <Key
          label="stop"
          title={escapeLeaves.value ? "stop the run" : "stop the run (Esc)"}
          onPress={() => run("stop")}
        >
          Stop
        </Key>
      ) : null}
      {edit || touch ? (
        <Key
          class="send"
          label={edit ? "save" : "send"}
          title={edit ? "save the queued message (Enter)" : "send (Enter)"}
          onPress={send}
        >
          {edit ? "Save" : "Send"}
        </Key>
      ) : null}
    </div>
  );
}

/**
 * Picker confirmations keep the composer height stable. Shift+Enter takes the alternate choice.
 */
export function PickKeys(props: {
  alternate: string | undefined;
  on: boolean;
  toggle: () => void;
  choose: () => void;
}) {
  return (
    <div class="keys" role="toolbar" aria-label="keys">
      {props.alternate === undefined ? null : (
        <Key
          class="alternate"
          label={props.alternate}
          title={`${props.alternate} with the pick · tap to switch (Shift+Enter takes a row with it)`}
          pressed={props.on}
          onPress={props.toggle}
        >
          {props.on ? "✓ " : ""}
          {props.alternate}
        </Key>
      )}
      <Key class="icon send" label="choose" title="choose (Enter)" onPress={props.choose}>
        ✓
      </Key>
    </div>
  );
}
