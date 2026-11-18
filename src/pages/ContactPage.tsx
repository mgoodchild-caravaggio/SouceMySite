import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ConsentPanel } from '../components/ConsentPanel';
import { ContactForm } from '../components/ContactForm';
import { EmailComposer } from '../components/EmailComposer';
import { MeetingsPanel } from '../components/MeetingsPanel';
import { Confirm } from '../components/Dialog';
import { PropertiesMap, PropertyEditor } from '../components/PropertyEditor';
import { slug } from '../components/ProspectCard';
import { KIND_LABEL, LOGGABLE_KINDS, useActivities, type LoggableKind } from '../lib/activities';
import { companyLabel, displayName, followUpState, formatDate, initials, todayIso } from '../lib/filters';
import { formatMoney } from '../lib/geo';
import { useSession } from '../lib/session';
import { fetchContact, useContacts } from '../lib/store';
import { supabase } from '../lib/supabase';
import { STATUSES, type Contact, type Property, type Status } from '../types';

const TIME_FMT = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** One contact: details, follow-up and assignment, properties, and activity history. */
export default function ContactPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { profile, people } = useSession();
  const store = useContacts();
  const [error, setError] = useState('');
  const reportError = useCallback((m: string) => setError(m), []);
  const live = store.contacts.find((c) => c.id === id);
  // Archived contacts aren't in the shared list, so fetch them directly.
  const [archived, setArchived] = useState<Contact | null | undefined>(undefined);
  const contact = live ?? archived ?? undefined;
  const { activities, add, remove, reload: reloadActivities } = useActivities(id, reportError);

  const [editing, setEditing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [propertyEditing, setPropertyEditing] = useState<Property | 'new' | null>(null);
  const [confirm, setConfirm] = useState<'archive' | 'delete' | 'removeProperty' | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (live || store.loading) return;
    let cancelled = false;
    fetchContact(id).then((c) => !cancelled && setArchived(c));
    return () => {
      cancelled = true;
    };
  }, [id, live, store.loading]);

  useEffect(() => setNotes(contact?.notes ?? ''), [contact?.id, contact?.notes]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const peopleById = useMemo(() => Object.fromEntries(people.map((p) => [p.id, p])), [people]);

  if (!contact) {
    return (
      <div className="detail-page">
        {store.loading || archived === undefined ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="empty">
            <strong>This contact doesn't exist.</strong>
            <span>
              It may have been permanently deleted. <Link to="/contacts">Back to contacts</Link>
            </span>
          </div>
        )}
      </div>
    );
  }

  const isArchived = !!contact.archivedAt;
  const company = companyLabel(contact);
  const backTo = contact.isProspect ? '/prospects' : '/contacts';

  // Status changes are logged by the database; reload the timeline to show them.
  const change = async (patch: Parameters<typeof store.update>[1]) => {
    await store.update(contact.id, patch);
    if ('status' in patch) {
      await reloadActivities();
      store.touchActivity(contact.id, new Date().toISOString());
    }
  };

  const followUpDone = async () => {
    const a = await add('follow_up_done', '');
    if (a) store.touchActivity(contact.id, a.occurredAt);
    await store.update(contact.id, { followUpOn: undefined });
  };

  const snooze = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    store.update(contact.id, { followUpOn: d.toLocaleDateString('en-CA') });
  };

  const restore = async () => {
    const { error: e } = await supabase.from('contacts').update({ archived_at: null }).eq('id', contact.id);
    if (e) return setError(`Couldn't restore: ${e.message}`);
    await store.reload(contact.id);
    setArchived(null);
    reloadActivities();
  };

  return (
    <div className="detail-page">
      <nav className="crumbs">
        <Link to={backTo}>← {contact.isProspect ? 'Prospects' : 'Contacts'}</Link>
      </nav>

      {isArchived && (
        <div className="notice warn archived-banner">
          <span>
            Archived {formatDate(contact.archivedAt!)}. It's hidden everywhere except the Archive page.
          </span>
          <span className="banner-actions">
            <button type="button" className="btn small" onClick={restore}>
              Restore
            </button>
            {profile.role === 'admin' && (
              <button type="button" className="btn small danger" onClick={() => setConfirm('delete')}>
                Delete permanently
              </button>
            )}
          </span>
        </div>
      )}

      <header className="contact-head">
        <span className={`avatar lg ${contact.isProspect ? `s-${slug(contact.status)}` : 'other'}`}>{initials(contact)}</span>
        <div className="contact-title">
          <h1>{displayName(contact)}</h1>
          <div className="muted">{[contact.title, company || (contact.isProspect ? 'Individual' : '')].filter(Boolean).join(' · ')}</div>
          <div className="tag-row">
            <span className="tag">{contact.business}</span>
            {contact.isProspect ? <span className={`tag s-${slug(contact.status)}`}>{contact.status}</span> : <span className="tag">Contact</span>}
            {contact.customerTypes.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        </div>
        {!isArchived && (
          <div className="head-actions">
            {contact.phone && (
              <a className="btn primary" href={`tel:${contact.phone.replace(/\D/g, '')}`}>
                Call
              </a>
            )}
            {contact.email && (
              <button type="button" className="btn" onClick={() => setEmailing(true)}>
                Email
              </button>
            )}
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn danger-outline" onClick={() => setConfirm('archive')}>
              Archive
            </button>
          </div>
        )}
      </header>

      <div className="detail-grid">
        <div className="detail-col">
          <section className="panel">
            <h2>Follow-up</h2>
            <div className="form-grid">
              <label className="field">
                <span>Assigned to</span>
                <select
                  disabled={isArchived}
                  value={contact.assignedTo ?? ''}
                  onChange={(e) => change({ assignedTo: e.target.value || undefined })}
                >
                  <option value="">Nobody</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Next follow-up</span>
                <input
                  type="date"
                  disabled={isArchived}
                  value={contact.followUpOn ?? ''}
                  onChange={(e) => change({ followUpOn: e.target.value || undefined })}
                />
              </label>
            </div>
            {contact.followUpOn && !isArchived && (
              <div className="follow-actions">
                <span className={`due due-${followUpState(contact.followUpOn)}`}>
                  {contact.followUpOn < todayIso() ? 'Overdue since ' : contact.followUpOn === todayIso() ? 'Due today, ' : 'Due '}
                  {formatDate(contact.followUpOn)}
                </span>
                <button type="button" className="btn small primary" onClick={followUpDone}>
                  Done
                </button>
                <button type="button" className="btn small" onClick={() => snooze(1)}>
                  Tomorrow
                </button>
                <button type="button" className="btn small" onClick={() => snooze(7)}>
                  Next week
                </button>
              </div>
            )}
            {contact.isProspect && (
              <label className="field">
                <span>Status</span>
                <select disabled={isArchived} value={contact.status} onChange={(e) => change({ status: e.target.value as Status })}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section className="panel">
            <h2>Details</h2>
            <dl className="facts-list">
              <Fact label="Phone">
                {contact.phone && <a href={`tel:${contact.phone.replace(/\D/g, '')}`}>{contact.phone}</a>}
              </Fact>
              <Fact label="Second phone">
                {contact.phone2 && <a href={`tel:${contact.phone2.replace(/\D/g, '')}`}>{contact.phone2}</a>}
              </Fact>
              <Fact label="Email">{contact.email && <a href={`mailto:${contact.email}`}>{contact.email}</a>}</Fact>
              <Fact label="Website">
                {contact.website && (
                  <a href={/^https?:\/\//.test(contact.website) ? contact.website : `https://${contact.website}`} target="_blank" rel="noreferrer">
                    {contact.website.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </Fact>
              <Fact label="Mailing address">{contact.mailingAddress}</Fact>
              {contact.isProspect && (
                <>
                  <Fact label="Deal value">{contact.dealValue ? formatMoney(contact.dealValue) : ''}</Fact>
                  <Fact label="Lead source">{contact.leadSource}</Fact>
                  <Fact label="Categories">{contact.categories.join(', ')}</Fact>
                  <Fact label="Regions">{contact.regions.join(', ')}</Fact>
                  <Fact label="Campaigns">{contact.campaigns.join(', ')}</Fact>
                </>
              )}
            </dl>
            {!contact.isProspect && !isArchived && (
              <button type="button" className="btn small" onClick={() => change({ isProspect: true, assignedTo: contact.assignedTo ?? profile.id })}>
                Make prospect
              </button>
            )}
          </section>

          <ConsentPanel contact={contact} disabled={isArchived} onChange={(p) => change(p)} />

          <section className="panel">
            <h2>Summary</h2>
            <textarea
              className="notes"
              rows={4}
              disabled={isArchived}
              placeholder="Key facts to know before calling. Log individual calls and notes in Activity."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== contact.notes && change({ notes })}
            />
          </section>
        </div>

        <div className="detail-col">
          {(contact.isProspect || contact.properties.length > 0) && (
            <section className="panel">
              <div className="panel-head">
                <h2>Properties</h2>
                {!isArchived && (
                  <button type="button" className="btn small" onClick={() => setPropertyEditing('new')}>
                    + Add property
                  </button>
                )}
              </div>
              {contact.properties.length > 0 ? (
                <>
                  <PropertiesMap properties={contact.properties} onPick={(p) => !isArchived && setPropertyEditing(p)} />
                  <ul className="property-list">
                    {contact.properties.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="property-row" disabled={isArchived} onClick={() => setPropertyEditing(p)}>
                          <strong>{p.address}</strong>
                          <span className="muted small">
                            {[p.relation, p.category, p.acres != null ? `${p.acres} ac` : ''].filter(Boolean).join(' · ')}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <Link className="link-btn" to="/map">
                    Find nearby prospects on the map →
                  </Link>
                </>
              ) : (
                <p className="muted">No properties yet. Add one to put this prospect on the map.</p>
              )}
            </section>
          )}

          <MeetingsPanel
            contact={contact}
            disabled={isArchived}
            onChanged={async (followUpDay) => {
              if (followUpDay) await store.update(contact.id, { followUpOn: followUpDay });
              await reloadActivities();
              store.touchActivity(contact.id, new Date().toISOString());
            }}
          />

          <section className="panel">
            <h2>Activity</h2>
            {!isArchived && (
              <ActivityComposer
                onAdd={async (kind, body, when) => {
                  const a = await add(kind, body, when);
                  if (a) store.touchActivity(contact.id, a.occurredAt);
                  return !!a;
                }}
              />
            )}
            <ol className="timeline">
              {activities.map((a) => {
                const who = a.createdBy ? peopleById[a.createdBy]?.displayName ?? 'Former user' : 'Hub';
                const manual = (LOGGABLE_KINDS as readonly string[]).includes(a.kind);
                return (
                  <li key={a.id} className={`tl-${a.kind}`}>
                    <div className="tl-head">
                      <strong>{KIND_LABEL[a.kind]}</strong>
                      {a.kind === 'status_change' && <span> {a.body}</span>}
                      <span className="muted small">
                        {' '}
                        · {who} · {TIME_FMT.format(new Date(a.occurredAt))}
                      </span>
                      {manual && a.createdBy === profile.id && (
                        <button type="button" className="link-btn tl-delete" onClick={() => remove(a.id)}>
                          Delete
                        </button>
                      )}
                    </div>
                    {a.body && a.kind !== 'status_change' && <p className="tl-body">{a.body}</p>}
                  </li>
                );
              })}
              {activities.length === 0 && <li className="muted">No activity yet.</li>}
            </ol>
          </section>
        </div>
      </div>

      {error && (
        <div className="toast app-toast" role="alert">
          {error}
        </div>
      )}

      {emailing && (
        <EmailComposer
          contact={contact}
          onClose={() => setEmailing(false)}
          onSent={async (at) => {
            await reloadActivities();
            store.touchActivity(contact.id, at);
          }}
        />
      )}

      {editing && <ContactForm contact={contact} onClose={() => setEditing(false)} onSaved={() => reloadActivities()} />}

      {propertyEditing && (
        <PropertyEditor
          property={propertyEditing === 'new' ? undefined : propertyEditing}
          onClose={() => setPropertyEditing(null)}
          onSave={(input) =>
            propertyEditing === 'new'
              ? store.addProperty(contact.id, input)
              : store.updateProperty(contact.id, propertyEditing.id, input)
          }
          onRemove={propertyEditing === 'new' ? undefined : () => setConfirm('removeProperty')}
        />
      )}

      {confirm === 'archive' && (
        <Confirm
          title={`Archive ${displayName(contact)}?`}
          message="They'll be hidden from lists, the map and the dashboard. You can restore them from the Archive page."
          confirmLabel="Archive"
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await store.archive([contact.id]);
            navigate(backTo);
          }}
        />
      )}
      {confirm === 'removeProperty' && propertyEditing && propertyEditing !== 'new' && (
        <Confirm
          title="Remove this property?"
          message={`${propertyEditing.address} will be removed from ${displayName(contact)} and the map.`}
          confirmLabel="Remove"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            const pid = propertyEditing.id;
            setConfirm(null);
            setPropertyEditing(null);
            await store.removeProperty(contact.id, pid);
          }}
        />
      )}
      {confirm === 'delete' && (
        <Confirm
          title={`Permanently delete ${displayName(contact)}?`}
          message="This removes the contact, their properties and all activity for good. It can't be undone."
          confirmLabel="Delete permanently"
          danger
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            const { error: e } = await supabase.from('contacts').delete().eq('id', contact.id);
            if (e) return setError(`Couldn't delete: ${e.message}`);
            navigate('/archive');
          }}
        />
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function ActivityComposer({ onAdd }: { onAdd: (kind: LoggableKind, body: string, when?: string) => Promise<boolean> }) {
  const [kind, setKind] = useState<LoggableKind>('call');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim() && kind === 'note') return;
    setBusy(true);
    if (await onAdd(kind, body.trim())) setBody('');
    setBusy(false);
  }

  return (
    <form className="composer" onSubmit={submit}>
      <div className="seg small" role="group" aria-label="Activity type">
        {LOGGABLE_KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        placeholder={kind === 'call' ? 'How did the call go? Next steps…' : kind === 'note' ? 'Add a note…' : `What happened?`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
        }}
      />
      <div className="composer-foot">
        <span className="muted small">⌘↵ to save</span>
        <button type="submit" className="btn small primary" disabled={busy || (kind === 'note' && !body.trim())}>
          Log {KIND_LABEL[kind].toLowerCase()}
        </button>
      </div>
    </form>
  );
}
