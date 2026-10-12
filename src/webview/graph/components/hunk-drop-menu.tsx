import { hunkDropMenu, postMessage } from "../signals";
import { Menu, MenuItem } from "./menu-container";

/** The menu of dropping hunks on a change: move them there or copy them there. */
export function HunkDropMenu() {
  const state = hunkDropMenu.value;
  if (!state) {
    return null;
  }

  const send = (duplicate: boolean) => {
    postMessage({
      command: "moveHunks",
      fromChangeId: state.fromChangeId,
      toChangeId: state.toChangeId,
      hunks: state.hunks,
      duplicate,
    });
    hunkDropMenu.value = null;
  };

  return (
    <Menu id="hunk-drop-menu" state={state} onClick={(e) => e.stopPropagation()}>
      <MenuItem action="moveHunks" onClick={() => send(false)}>
        Move
      </MenuItem>
      <MenuItem action="duplicateHunks" onClick={() => send(true)}>
        Duplicate
      </MenuItem>
    </Menu>
  );
}
