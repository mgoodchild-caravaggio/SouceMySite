import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from './Dialog';
import { displayName } from '../lib/filters';
import { useSession } from '../lib/session';
import { useContacts, type NewContact } from '../lib/store';
import {
  BUSINESSES,
  CATEGORIES,
  CUSTOMER_TYPES,
  REGIONS,
  STATUSES,
  type Category,
  type Contact,
  type CustomerType,
  type Region,
} from '../types';

interface Props {
  /** The contact being edited; leave out to add a new one. */
  contact?: Contact;
  /** Starting values for a new contact. */
  initial?: Partial<NewContact>;
  onClose: () => void;
  onSaved: (c: Contact) => void;
}

const LEAD_SOURCES = ['Advertisement', 'Referral', 'Cold Call', 'Website', 'Past Client', 'Other'];

function blank(business: NewContact['business'], isProspect: boolean, me: string): NewContact {
  return {
    business,
    isProspect,
    firstName: '',
    lastName: '',
    company: 'tbd',
    title: '',
    phone: '',
    phone2: '',
    email: undefined,
    website: '',
    mailingAddress: '',
    status: 'Prospect',
    leadSource: '',
    regions: [],
    categories: [],
    customerTypes: [],
    dealValue: undefined,
    followUpOn: undefined,
    assignedTo: isProspect ? me : undefined,
    campaigns: [],
    notes: '',
    emailConsent: 'none',
    consentDate: undefined,
    consentSource: '',
    consentExpiresOn: undefined,
    unsubscribedAt: undefined,
  };
}

const digits = (s: string) => s.replace(/\D/g, '');

/** Add or edit a contact. Warns before saving if the phone or email is already in Hub. */
export function ContactForm({ contact, initial, onClose, onSaved }: Props) {
  const { profile, people, business } = useSession();
  const { contacts, create, update } = useContacts();
  const [form, setForm] = useState<NewContact>(() => {
    if (contact) {
      // Strip fields the form doesn't edit.
      const { id: _id, properties: _p, followUp: _f, archivedAt: _a, ...rest } = contact;
      return rest;
    }
    const base = blank(initial?.business ?? business, initial?.isProspect ?? false, profile.id);
    return { ...base, ...initial, assignedTo: initial?.assignedTo ?? base.assignedTo };
  });
  const [campaignDraft, setCampaignDraft] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  // Bring the duplicate warning or the first error into view when a save is held back.
  useEffect(() => {
    if (!confirmDuplicates && !Object.keys(errors).length) return;
    formRef.current?.querySelector('.notice.warn, .field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [confirmDuplicates, errors]);

  const set = <K extends keyof NewContact>(k: K, v: NewContact[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setConfirmDuplicates(false);
  };
  const toggleIn = <T extends string>(k: 'customerTypes' | 'regions' | 'categories', v: T) => {
    const list = form[k] as T[];
    set(k, (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]) as never);
  };

  const allCampaigns = useMemo(() => [...new Set(contacts.flatMap((c) => c.campaigns))].sort((a, b) => a.localeCompare(b)), [contacts]);
  const company = form.company === 'tbd' ? '' : form.company;

  // Other contacts sharing a phone number or email address.
  const duplicates = useMemo(() => {
    const phones = [form.phone, form.phone2].map(digits).filter((d) => d.length >= 7);
    const email = form.email?.trim().toLowerCase();
    return contacts.filter((c) => {
      if (c.id === contact?.id) return false;
      const theirs = [c.phone, c.phone2].map(digits).filter((d) => d.length >= 7);
      return phones.some((p) => theirs.includes(p)) || (!!email && c.email?.toLowerCase() === email);
    });
  }, [form.phone, form.phone2, form.email, contacts, contact?.id]);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!form.firstName.trim() && !form.lastName.trim() && !company.trim()) e.name = 'Enter a name or a company.';
    for (const k of ['phone', 'phone2'] as const) {
      const d = digits(form[k]);
      if (form[k].trim() && (d.length < 10 || d.length > 11)) e[k] = 'Enter a 10-digit phone number.';
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'Enter a valid email address.';
    if (form.website && !/^(https?:\/\/)?[\w-]+(\.[\w-]+)+/i.test(form.website.trim())) e.website = 'Enter a web address, e.g. example.com.';
    return e;
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) return;
    if (duplicates.length && !confirmDuplicates) {
      setConfirmDuplicates(true);
      return;
    }
    const clean: NewContact = {
      ...form,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      company: company.trim() || 'tbd',
      title: form.title.trim(),
      phone: form.phone.trim(),
      phone2: form.phone2.trim(),
      email: form.email?.trim() || undefined,
      website: form.website.trim(),
      mailingAddress: form.mailingAddress.trim(),
    };
    setSaving(true);
    if (contact) {
      await update(contact.id, clean);
      onSaved({ ...contact, ...clean, followUp: clean.followUpOn != null });
    } else {
      const created = await create(clean);
      if (created) onSaved(created);
    }
    setSaving(false);
    onClose();
  }

  const title = contact ? `Edit ${displayName(contact)}` : form.isProspect ? 'New prospect' : 'New contact';

  return (
    <Dialog
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="contact-form" className="btn primary" disabled={saving}>
            {saving ? 'Saving…' : confirmDuplicates ? 'Save anyway' : contact ? 'Save changes' : 'Add'}
          </button>
        </>
      }
    >
      <form id="contact-form" className="contact-form" onSubmit={submit} noValidate ref={formRef}>
        {duplicates.length > 0 && (
          <div className={`notice ${confirmDuplicates ? 'warn' : ''}`} role={confirmDuplicates ? 'alert' : undefined}>
            <strong>Possible duplicate.</strong> The same phone or email is already on{' '}
            {duplicates.slice(0, 3).map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                <Link to={`/contacts/${d.id}`} onClick={onClose}>
                  {displayName(d)}
                </Link>
                {d.archivedAt && ' (archived)'}
              </span>
            ))}
            {duplicates.length > 3 && ` and ${duplicates.length - 3} more`}.
            {confirmDuplicates && ' Save anyway if this is a different person.'}
          </div>
        )}

        <div className="form-row">
          <label className="field">
            <span>Business</span>
            <select value={form.business} onChange={(e) => set('business', e.target.value as NewContact['business'])}>
              {BUSINESSES.map((b) => (
                <option key={b}>{b}</option>
              ))}
            </select>
          </label>
          <label className="field check-field">
            <input type="checkbox" checked={form.isProspect} onChange={(e) => set('isProspect', e.target.checked)} />
            <span>Prospect (in the sales pipeline, shown on the map)</span>
          </label>
        </div>

        <fieldset>
          <legend>Contact</legend>
          <div className="form-grid">
            <label className="field">
              <span>First name</span>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="off" />
            </label>
            <label className="field">
              <span>Last name</span>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="off" />
            </label>
            <label className="field">
              <span>Company</span>
              <input value={company} placeholder="Leave blank for an individual" onChange={(e) => set('company', e.target.value)} />
            </label>
            <label className="field">
              <span>Title / role</span>
              <input value={form.title} placeholder="e.g. Owner, Planner, Lawyer" onChange={(e) => set('title', e.target.value)} />
            </label>
            {errors.name && <p className="field-error span-2">{errors.name}</p>}
            <label className="field">
              <span>Phone</span>
              <input type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} />
              {errors.phone && <small className="field-error">{errors.phone}</small>}
            </label>
            <label className="field">
              <span>Second phone</span>
              <input type="tel" value={form.phone2} onChange={(e) => set('phone2', e.target.value)} aria-invalid={!!errors.phone2} />
              {errors.phone2 && <small className="field-error">{errors.phone2}</small>}
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
              {errors.email && <small className="field-error">{errors.email}</small>}
            </label>
            <label className="field">
              <span>Website or LinkedIn</span>
              <input value={form.website} onChange={(e) => set('website', e.target.value)} aria-invalid={!!errors.website} />
              {errors.website && <small className="field-error">{errors.website}</small>}
            </label>
            <label className="field span-2">
              <span>Mailing address</span>
              <input value={form.mailingAddress} placeholder="Where to send letters (properties are added separately)" onChange={(e) => set('mailingAddress', e.target.value)} />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Customer type</legend>
          <div className="chip-group">
            {CUSTOMER_TYPES.map((t) => (
              <label key={t} className={`chip-toggle ${form.customerTypes.includes(t) ? 'on' : ''}`}>
                <input type="checkbox" checked={form.customerTypes.includes(t)} onChange={() => toggleIn<CustomerType>('customerTypes', t)} />
                {t}
              </label>
            ))}
          </div>
        </fieldset>

        {form.isProspect && (
          <fieldset>
            <legend>Pipeline</legend>
            <div className="form-grid">
              <label className="field">
                <span>Status</span>
                <select value={form.status} onChange={(e) => set('status', e.target.value as NewContact['status'])}>
                  {STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Lead source</span>
                <input list="lead-sources" value={form.leadSource} onChange={(e) => set('leadSource', e.target.value)} />
                <datalist id="lead-sources">
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>Deal value ($)</span>
                <input
                  inputMode="numeric"
                  value={form.dealValue ?? ''}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/[^\d.]/g, ''));
                    set('dealValue', e.target.value.trim() && Number.isFinite(n) ? n : undefined);
                  }}
                />
              </label>
            </div>
            <div className="sub-label">Categories</div>
            <div className="chip-group">
              {CATEGORIES.map((c) => (
                <label key={c} className={`chip-toggle ${form.categories.includes(c) ? 'on' : ''}`}>
                  <input type="checkbox" checked={form.categories.includes(c)} onChange={() => toggleIn<Category>('categories', c)} />
                  {c}
                </label>
              ))}
            </div>
            <div className="sub-label">Regions</div>
            <div className="chip-group">
              {REGIONS.map((r) => (
                <label key={r} className={`chip-toggle ${form.regions.includes(r) ? 'on' : ''}`}>
                  <input type="checkbox" checked={form.regions.includes(r)} onChange={() => toggleIn<Region>('regions', r)} />
                  {r}
                </label>
              ))}
            </div>
            <div className="sub-label">Campaigns</div>
            <div className="chip-group">
              {form.campaigns.map((c) => (
                <span key={c} className="chip-toggle on">
                  {c}
                  <button type="button" className="chip-remove" aria-label={`Remove ${c}`} onClick={() => set('campaigns', form.campaigns.filter((x) => x !== c))}>
                    ×
                  </button>
                </span>
              ))}
              <input
                className="chip-input"
                list="form-campaigns"
                placeholder="Add a campaign, press Enter"
                value={campaignDraft}
                onChange={(e) => setCampaignDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  const name = campaignDraft.trim();
                  if (name && !form.campaigns.includes(name)) set('campaigns', [...form.campaigns, name]);
                  setCampaignDraft('');
                }}
              />
              <datalist id="form-campaigns">
                {allCampaigns.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend>Follow-up</legend>
          <div className="form-grid">
            <label className="field">
              <span>Assigned to</span>
              <select value={form.assignedTo ?? ''} onChange={(e) => set('assignedTo', e.target.value || undefined)}>
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
              <input type="date" value={form.followUpOn ?? ''} onChange={(e) => set('followUpOn', e.target.value || undefined)} />
            </label>
          </div>
        </fieldset>
      </form>
    </Dialog>
  );
}
