'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { prepareUpload, recordUpload } from '@/app/actions';

const MAX_BYTES = 15 * 1024 * 1024;
const BUCKET = 'attachments';

// The browser sends the file straight to Supabase Storage with a one-time token from the
// server, so large receipts aren't blocked by the hosting platform's request size limit.
export function UploadForm({ ownerTable, ownerId }: { ownerTable: string; ownerId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ error?: string; ok?: string; progress?: string }>({});

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const files = Array.from(inputRef.current?.files ?? []).filter((f) => f.size > 0);
    if (!files.length) return setStatus({ error: 'Choose a file first.' });
    const tooBig = files.find((f) => f.size > MAX_BYTES);
    if (tooBig) return setStatus({ error: `${tooBig.name} is larger than 15 MB.` });

    setBusy(true);
    const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false },
    }).storage.from(BUCKET);
    let done = 0;
    try {
      for (const file of files) {
        setStatus({ progress: `Uploading ${file.name} (${done + 1} of ${files.length})...` });
        const prepared = await prepareUpload(ownerTable, ownerId, file.name, file.size);
        if ('error' in prepared) return setStatus({ error: prepared.error });
        const { error } = await storage.uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: file.type || 'application/octet-stream',
        });
        if (error) return setStatus({ error: `${file.name}: ${error.message}` });
        const recorded = await recordUpload(ownerTable, ownerId, prepared.path, file.name, file.type);
        if (recorded?.error) return setStatus({ error: recorded.error });
        done += 1;
      }
      setStatus({ ok: done === 1 ? 'File attached.' : `${done} files attached.` });
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch {
      setStatus({ error: 'Upload failed. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={upload} className="flex flex-wrap items-center gap-2">
      <input ref={inputRef} type="file" name="file" multiple className="field max-w-xs py-1.5 text-sm" aria-label="Choose files" disabled={busy} />
      <button className="btn" disabled={busy}>{busy ? 'Uploading...' : 'Attach'}</button>
      {status.progress && busy && <span className="text-sm text-ink-2">{status.progress}</span>}
      {status.error && <span role="alert" className="text-sm text-bad">{status.error}</span>}
      {status.ok && <span className="text-sm text-good">{status.ok}</span>}
      <span className="basis-full text-xs text-muted">Any file type, up to 15 MB each.</span>
    </form>
  );
}
