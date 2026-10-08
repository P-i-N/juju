import { fileContextMenu, postMessage } from "../signals";
import { Menu, MenuItem, MenuSeparator } from "./menu-container";

// Mirrors the scm/resourceState/context menu contributions in package.json:
// the working-copy group shows "Open File" (the working-copy file itself) while
// other groups additionally offer "Open File in Working Copy". "Open File" is
// omitted for deleted files outside the working copy because they do not exist
// at their own revision. "Discard Changes" is an inline action of the SCM
// view; here it acts on every selected file.
export function FileContextMenu() {
  const state = fileContextMenu.value;
  if (!state) {
    return null;
  }

  const { change, file, files } = state;
  const isWorkingCopy = change.currentWorkingCopy;

  return (
    <Menu id="file-context-menu" state={state} onClick={(e) => e.stopPropagation()}>
      <MenuItem
        action="openFileDiff"
        onClick={() => {
          postMessage({
            command: "openFileDiff",
            changeId: change.id.changeId,
            path: file.path,
            status: file.type,
            ...(file.renamedFrom ? { renamedFrom: file.renamedFrom } : {}),
          });
          fileContextMenu.value = null;
        }}
      >
        View as Diff
      </MenuItem>
      {(isWorkingCopy || file.type !== "D") && (
        <MenuItem
          action="openFileAtRevision"
          onClick={() => {
            postMessage({ command: "openFileAtRevision", changeId: change.id.changeId, path: file.path });
            fileContextMenu.value = null;
          }}
        >
          Open File
        </MenuItem>
      )}
      {!isWorkingCopy && (
        <MenuItem
          action="openFileInWorkingCopy"
          onClick={() => {
            postMessage({ command: "openFileInWorkingCopy", path: file.path });
            fileContextMenu.value = null;
          }}
        >
          Open File in Working Copy
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem
        action="copyPath"
        onClick={() => {
          postMessage({ command: "copyPath", path: file.path });
          fileContextMenu.value = null;
        }}
      >
        Copy Path
      </MenuItem>
      <MenuItem
        action="copyRelativePath"
        onClick={() => {
          postMessage({ command: "copyRelativePath", path: file.path });
          fileContextMenu.value = null;
        }}
      >
        Copy Relative Path
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        action="discardChanges"
        onClick={() => {
          postMessage({
            command: "discardFileChanges",
            changeId: change.id.changeId,
            files: files.map((f) => ({ path: f.path, ...(f.renamedFrom ? { renamedFrom: f.renamedFrom } : {}) })),
          });
          fileContextMenu.value = null;
        }}
      >
        Discard Changes
      </MenuItem>
    </Menu>
  );
}
