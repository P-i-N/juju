import { remoteDrag, remoteDragReceived } from "../signals";
import styles from "./remote-drop-hint.module.css";

export function RemoteDropHint() {
  if (!remoteDrag.value || remoteDragReceived.value) {
    return null;
  }
  return (
    <div id="remote-drop-hint" class={styles.remoteDropHint}>
      <i class="codicon codicon-keyboard"></i>
      Hold Shift to Drop Here
    </div>
  );
}
