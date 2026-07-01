/**
 * Share or download a PNG blob. Uses the Web Share API with a file (which on
 * mobile surfaces Instagram, etc.); falls back to a download when unavailable.
 * When Capacitor is added, this is where the native Share plugin slots in.
 */
export async function shareOrDownloadPng(
  blob: Blob,
  filename: string,
): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], filename, { type: 'image/png' });

  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean;
  };
  if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'aera' });
      return 'shared';
    } catch (err) {
      // User cancelled the share sheet — treat as no-op, don't fall through.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return 'downloaded';
}
