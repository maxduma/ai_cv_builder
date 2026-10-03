/** How long a saved file's object URL stays valid: revoking it at once can cancel the download. */
const REVOKE_AFTER_MS = 60_000;

/** Saves `blob` as a download named `fileName`, as a link with a `download` attribute would. */
export function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
