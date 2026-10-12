import { edgeDropMenu, postMessage } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

/**
 * The menu of a Ctrl+drop on an edge. Where the dropped changes or files go
 * (onto, after or before the change) comes from the edge; the menu picks what
 * to do there.
 */
export function EdgeDropMenu() {
  const state = edgeDropMenu.value;
  if (!state) {
    return null;
  }

  const { targetId, position } = state;
  const close = () => {
    edgeDropMenu.value = null;
  };

  if (state.kind === "files") {
    const send = (command: "moveFileChangesToNewChange" | "copyFileChangesToNewChange") => {
      postMessage({
        command,
        fromChangeId: state.fromChangeId,
        targetChangeId: targetId,
        position,
        paths: state.paths,
      });
      close();
    };
    return (
      <Menu id="edge-drop-menu" state={state} onClick={(e) => e.stopPropagation()}>
        <MenuItem action="moveToNewChange" onClick={() => send("moveFileChangesToNewChange")}>
          Move to New Change
        </MenuItem>
        <MenuSeparator />
        <MenuItem action="copyToNewChange" onClick={() => send("copyFileChangesToNewChange")}>
          Copy to New Change
        </MenuItem>
      </Menu>
    );
  }

  const { sourceIds } = state;
  const allLabel = sourceIds.length > 1 ? " All" : "";
  const suffix = position === "onto" ? "Onto" : position === "after" ? "After" : "Before";
  const rebase = (withDescendants: boolean) => {
    postMessage({ command: `rebase${suffix}`, changeIds: sourceIds, targetChangeId: targetId, withDescendants });
    close();
  };
  const duplicate = () => {
    postMessage({ command: `duplicate${suffix}`, changeIds: sourceIds, targetChangeId: targetId });
    close();
  };

  return (
    <Menu id="edge-drop-menu" state={state} onClick={(e) => e.stopPropagation()}>
      <MenuItem action="rebase" onClick={() => rebase(false)}>
        Rebase{allLabel}
      </MenuItem>
      <MenuItem action="rebaseWithDescendants" onClick={() => rebase(true)}>
        Rebase{allLabel} With Descendants
      </MenuItem>
      <MenuSeparator />
      <MenuItem action="duplicate" onClick={duplicate}>
        Duplicate{allLabel}
      </MenuItem>
    </Menu>
  );
}
