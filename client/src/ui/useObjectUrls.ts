import { useEffect, useState } from 'react';

/** object URL для каждого Blob; создаются и отзываются в одном эффекте (корректно и в StrictMode). */
export function useObjectUrls(blobs: (Blob | undefined)[]): (string | undefined)[] {
  const [urls, setUrls] = useState<(string | undefined)[]>([]);
  useEffect(() => {
    const next = blobs.map((b) => (b ? URL.createObjectURL(b) : undefined));
    setUrls(next);
    return () => next.forEach((u) => u && URL.revokeObjectURL(u));
  }, [blobs]);
  return urls;
}
