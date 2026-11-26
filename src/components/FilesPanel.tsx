import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Confirm } from './Dialog';
import { formatDate } from '../lib/filters';
import { fileUrl, formatBytes, MAX_FILE_BYTES, useContactFiles, type ContactFile } from '../lib/files';
import { useSession } from '../lib/session';
import type { Contact } from '../types';

const EXT_ICON: Record<string, string> = { pdf: 'PDF', doc: 'DOC', docx: 'DOC', xls: 'XLS', xlsx: 'XLS', csv: 'CSV', jpg: 'IMG', jpeg: 'IMG', png: 'IMG', heic: 'IMG', gif: 'IMG', webp: 'IMG', zip: 'ZIP', txt: 'TXT', msg: 'MSG', eml: 'MSG', kml: 'MAP', kmz: 'MAP' };
const badge = (name: string) => EXT_ICON[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'FILE';
// Browsers can show these themselves; anything else is downloaded.
const viewable = (f: ContactFile) => /^(application\/pdf|image\/|text\/plain)/.test(f.mimeType);

/** PDFs, photos and other documents attached to a contact or prospect. */
export function FilesPanel({ contact, disabled, onChanged }: { contact: Contact; disabled?: boolean; onChanged?: () => void }) {
  const { profile, people } = useSession();
  const { files, error, upload, remove } = useContactFiles(contact.id);
  const [busy, setBusy] = useState(0);
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [deleting, setDeleting] = useState<ContactFile | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ref = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const isAdmin = profile.role === 'admin';

  useEffect(() => {
    if (hash === '#files') ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [hash, files?.length]);

  async function add(list: File[]) {
    if (!list.length || disabled) return;
    setProblems([]);
    setBusy(list.length);
    const p = await upload(list);
    setBusy(0);
    setProblems(p);
    onChanged?.();
  }

  async function open(f: ContactFile) {
    // Open the tab straight away (pop-up blockers allow that), then point it at the file.
    const tab = viewable(f) ? window.open('', '_blank') : null;
    try {
      const url = await fileUrl(f, !viewable(f));
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      tab?.close();
      setProblems([`Couldn't open ${f.name}: ${(e as Error).message}`]);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    add([...e.dataTransfer.files]);
  };

  return (
    <section
      ref={ref}
      className={`panel files-panel ${dragging ? 'dragging' : ''}`}
      id="files"
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <div className="panel-head">
        <h2>Files{files?.length ? <span className="count-pill">{files.length}</span> : null}</h2>
        {!disabled && (
          <button type="button" className="btn small" onClick={() => input.current?.click()} disabled={busy > 0}>
            {busy ? `Uploading ${busy === 1 ? '1 file' : `${busy} files`}…` : '+ Attach files'}
          </button>
        )}
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </div>
      {error && <p className="field-error">{error}</p>}
      {problems.map((p) => (
        <p key={p} className="field-error">
          {p}
        </p>
      ))}
      {files === null ? (
        <p className="muted">Loading…</p>
      ) : files.length === 0 ? (
        <p className="muted small">
          {disabled ? 'No files.' : `No files yet. Attach PDFs, photos, surveys or documents, or drag them here (up to ${formatBytes(MAX_FILE_BYTES)} each).`}
        </p>
      ) : (
        <ul className="file-list">
          {files.map((f) => {
            const who = f.uploadedBy === profile.id ? 'You' : people.find((p) => p.id === f.uploadedBy)?.displayName ?? 'Former user';
            const canDelete = !disabled && (f.uploadedBy === profile.id || isAdmin);
            return (
              <li key={f.id}>
                <span className={`file-badge fb-${badge(f.name).toLowerCase()}`} aria-hidden="true">
                  {badge(f.name)}
                </span>
                <button type="button" className="file-name" onClick={() => open(f)} title={viewable(f) ? 'Open' : 'Download'}>
                  {f.name}
                </button>
                <span className="muted small file-meta">
                  {formatBytes(f.size)} · {who} · {formatDate(f.createdAt)}
                </span>
                <span className="file-actions">
                  <button type="button" className="link-btn small" onClick={() => fileUrl(f, true).then((u) => window.location.assign(u)).catch((e) => setProblems([(e as Error).message]))}>
                    Download
                  </button>
                  {canDelete && (
                    <button type="button" className="link-btn small danger-text" onClick={() => setDeleting(f)}>
                      Delete
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {dragging && <div className="drop-hint">Drop to attach to {contact.firstName || contact.lastName || 'this contact'}</div>}
      {deleting && (
        <Confirm
          title="Delete this file?"
          message={`“${deleting.name}” will be removed from Hub for everyone. This can't be undone.`}
          confirmLabel="Delete file"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const f = deleting;
            setDeleting(null);
            const err = await remove(f);
            setProblems(err ? [err] : []);
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
