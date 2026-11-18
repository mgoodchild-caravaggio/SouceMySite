import { useRef, useState } from 'react';
import { Confirm, Dialog } from './Dialog';
import { formatDate } from '../lib/filters';
import { useSession } from '../lib/session';
import { MERGE_FIELDS, unknownFields, useTemplates, type EmailTemplate } from '../lib/templates';

type Draft = Pick<EmailTemplate, 'name' | 'subject' | 'body' | 'shared'> & { id?: string };

/** Settings section: the team's shared templates and your own, with add, edit and delete. */
export function TemplateManager() {
  const { profile, people } = useSession();
  const { templates, error, save, remove } = useTemplates();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null);
  const [message, setMessage] = useState('');

  const canEdit = (t: EmailTemplate) => t.ownerId === profile.id || (t.shared && profile.role === 'admin');
  const ownerName = (t: EmailTemplate) => (t.ownerId ? people.find((p) => p.id === t.ownerId)?.displayName ?? 'Former user' : 'Hub');

  return (
    <section className="panel" id="templates">
      <div className="panel-head">
        <h2>Email templates</h2>
        <button type="button" className="btn small primary" onClick={() => setEditing({ name: '', subject: '', body: '', shared: true })}>
          New template
        </button>
      </div>
      <p className="muted small">
        Shared templates are available to everyone; personal ones only to you. Use fields like {'{{first_name}}'} and Hub fills them in for each contact.
      </p>
      {error && <p className="field-error">{error}</p>}
      {message && <p className="muted small" role="status">{message}</p>}
      {templates === null ? (
        <p className="muted">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="muted">No templates yet.</p>
      ) : (
        <ul className="template-list">
          {templates.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.name}</strong> {!t.shared && <span className="tag">Personal</span>}
                <div className="muted small">
                  {t.subject || '(no subject)'} · by {ownerName(t)} · updated {formatDate(t.updatedAt)}
                </div>
              </div>
              {canEdit(t) && (
                <div className="inline-actions">
                  <button type="button" className="btn small" onClick={() => setEditing(t)}>
                    Edit
                  </button>
                  <button type="button" className="link-btn tl-delete" onClick={() => setDeleting(t)}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <TemplateEditor
          draft={editing}
          isAdmin={profile.role === 'admin'}
          onClose={() => setEditing(null)}
          onSave={async (d) => {
            const err = await save(d);
            if (!err) {
              setEditing(null);
              setMessage(`Saved “${d.name.trim()}”.`);
            }
            return err;
          }}
        />
      )}
      {deleting && (
        <Confirm
          title={`Delete “${deleting.name}”?`}
          message={deleting.shared ? 'It will be removed for everyone on the team.' : 'This personal template will be removed.'}
          confirmLabel="Delete"
          danger
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            const t = deleting;
            setDeleting(null);
            const err = await remove(t.id);
            setMessage(err ? `Couldn't delete: ${err}` : `Deleted “${t.name}”.`);
          }}
        />
      )}
    </section>
  );
}

function TemplateEditor({ draft, isAdmin, onClose, onSave }: { draft: Draft; isAdmin: boolean; onClose: () => void; onSave: (d: Draft) => Promise<string> }) {
  const [d, setD] = useState<Draft>(draft);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const lastFocused = useRef<'subject' | 'body'>('body');

  // Insert a {{field}} where the cursor is, in whichever box was used last.
  const insert = (key: string) => {
    const token = `{{${key}}}`;
    const el = lastFocused.current === 'subject' ? subjectRef.current : bodyRef.current;
    const field = lastFocused.current === 'subject' ? 'subject' : 'body';
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + token + el.value.slice(end);
    setD((x) => ({ ...x, [field]: next }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  async function submit() {
    if (!d.name.trim()) return setError('Give the template a name.');
    const typos = unknownFields(`${d.subject}\n${d.body}`);
    if (typos.length) return setError(`Hub doesn't know {{${typos.join('}}, {{')}}}. Use the field buttons to insert fields.`);
    setSaving(true);
    const err = await onSave(d);
    if (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <Dialog
      title={d.id ? `Edit “${draft.name}”` : 'New template'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : 'Save template'}
          </button>
        </>
      }
    >
      <div className="template-form">
        <label className="field">
          <span>Name (only you and the team see this)</span>
          <input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Intro: land owner" />
        </label>
        <label className="field">
          <span>Subject</span>
          <input ref={subjectRef} value={d.subject} onFocus={() => (lastFocused.current = 'subject')} onChange={(e) => setD({ ...d, subject: e.target.value })} />
        </label>
        <div className="field">
          <span>Insert a field</span>
          <div className="field-chips">
            {MERGE_FIELDS.map((f) => (
              <button key={f.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(f.key)} title={`Inserts {{${f.key}}}`}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Message</span>
          <textarea ref={bodyRef} rows={12} value={d.body} onFocus={() => (lastFocused.current = 'body')} onChange={(e) => setD({ ...d, body: e.target.value })} />
        </label>
        <label className="check-field">
          <input type="checkbox" checked={d.shared} disabled={!!d.id && d.shared && !isAdmin} onChange={(e) => setD({ ...d, shared: e.target.checked })} />
          <span>Share with the team</span>
        </label>
        <p className="muted small">Your signature is added automatically when you send, so leave it out of the template.</p>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
