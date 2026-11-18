import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { contextLine, runConversation, TOOL_LABEL, useAiStatus, type Block, type Proposal, type ToolContext, type Turn } from '../lib/askHub';
import { createMatchCampaign } from '../lib/campaigns';
import { displayName } from '../lib/filters';
import { addMembers } from '../lib/members';
import { useOpportunities } from '../lib/opportunities';
import { useSession } from '../lib/session';
import { useContacts } from '../lib/store';

const STORE = 'hub.askHub';
const EXAMPLES = [
  'Who are the builder/developers we know within 20 km of Bradford?',
  'Which buyers match the listings we have open?',
  'Find land for an industrial buyer: 20–50 acres in Simcoe, under $8M.',
  'Whose follow-ups are overdue, and what should I say to each?',
];

interface Saved {
  conversationId: string;
  turns: Turn[];
  proposals: Proposal[];
  spentHere: number;
}

const fresh = (): Saved => ({ conversationId: crypto.randomUUID(), turns: [], proposals: [], spentHere: 0 });
function load(): Saved {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORE) ?? '');
    if (s && Array.isArray(s.turns)) return s;
  } catch {
    /* nothing saved, or storage blocked */
  }
  return fresh();
}

/** The Ask Hub button and its side panel. The conversation lasts until the tab closes or "New chat". */
export function AskHub() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={`ask-hub-btn ${open ? 'active' : ''}`} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ask Hub" title="Ask Hub">
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4L12 3Z" />
          <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
        </svg>
        <span>Ask Hub</span>
      </button>
      {open && <AskHubPanel onClose={() => setOpen(false)} />}
    </>
  );
}

function AskHubPanel({ onClose }: { onClose: () => void }) {
  const { profile, people, business } = useSession();
  const { contacts } = useContacts();
  const { opportunities } = useOpportunities();
  const { status } = useAiStatus();
  const location = useLocation();
  const [saved, setSaved] = useState<Saved>(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [spend, setSpend] = useState<{ month: number; cap: number } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(saved));
    } catch {
      /* storage full or blocked: the chat still works for this visit */
    }
  }, [saved]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [saved.turns.length, busy]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    inputRef.current?.focus();
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  // What the user is looking at, so "this contact" and "this campaign" make sense.
  const page = useMemo(() => {
    const p = location.pathname;
    const contact = p.match(/^\/contacts\/([^/]+)/)?.[1];
    if (contact) {
      const c = contacts.find((x) => x.id === decodeURIComponent(contact));
      return c ? `the contact page of ${displayName(c)} (id ${c.id})` : '';
    }
    const campaign = p.match(/^\/campaigns\/([0-9a-f-]{36})/)?.[1];
    if (campaign) return `the campaign page with id ${campaign}`;
    const match = new URLSearchParams(location.search).get('match');
    if (p === '/map' && match) {
      const o = opportunities.find((x) => x.id === match);
      return o ? `the map, matching "${o.title}" (opportunity id ${o.id})` : 'the map';
    }
    return { '/': 'the dashboard', '/map': 'the map', '/prospects': 'the prospects list', '/contacts': 'the contacts list', '/campaigns': 'the campaigns list' }[p] ?? '';
  }, [location.pathname, location.search, contacts, opportunities]);

  const ctx: ToolContext = {
    contacts,
    opportunities,
    business,
    myId: profile.id,
    people,
    propose: (p) => setSaved((s) => ({ ...s, proposals: [...s.proposals, { ...p, id: crypto.randomUUID() }] })),
  };

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError('');
    setText('');
    setBusy(true);
    const userTurn: Turn = { role: 'user', content: [{ type: 'text', text: `${contextLine({ name: profile.displayName, business, page })}\n${q}` }] };
    const start = [...saved.turns, userTurn];
    setSaved((s) => ({ ...s, turns: start }));
    try {
      await runConversation(start, {
        conversationId: saved.conversationId,
        question: q,
        ctx,
        onTurn: (t) => setSaved((s) => ({ ...s, turns: [...s.turns, t] })),
        onCost: (r) => {
          setSpend({ month: r.monthSpendUsd, cap: r.monthlyCapUsd });
          setSaved((s) => ({ ...s, spentHere: s.spentHere + r.costUsd }));
        },
      });
    } catch (e) {
      setError((e as Error).message);
      // Leave the conversation at the last complete exchange, so the next question starts cleanly.
      setSaved((s) => ({ ...s, turns: trimToComplete(s.turns) }));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  const off = status && (!status.enabled || !status.keySet);
  const capped = status && !off && status.monthSpendUsd >= status.monthlyCapUsd;

  return (
    <aside className="ask-panel" role="dialog" aria-label="Ask Hub">
      <header className="ask-head">
        <strong>Ask Hub</strong>
        <div className="inline-actions">
          {saved.turns.length > 0 && (
            <button type="button" className="link-btn small" onClick={() => setSaved(fresh())} disabled={busy}>
              New chat
            </button>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close Ask Hub">
            ×
          </button>
        </div>
      </header>

      <div className="ask-body">
        {status === null ? (
          <p className="muted small">Loading…</p>
        ) : off ? (
          <div className="ask-off">
            <p>
              <strong>Ask Hub is switched off.</strong>
            </p>
            <p className="small">
              It answers questions about your contacts, listings, buyers and campaigns using Claude, Anthropic's AI. It needs an Anthropic API key, and it costs
              roughly 5–15¢ a question.
            </p>
            {profile.role === 'admin' ? (
              <Link className="btn small primary" to="/settings#ask-hub" onClick={onClose}>
                Set it up in Settings
              </Link>
            ) : (
              <p className="small muted">Ask an admin to turn it on in Settings.</p>
            )}
          </div>
        ) : (
          <>
            {saved.turns.length === 0 && (
              <div className="ask-intro">
                <p className="small">Ask about your contacts, land, buyers and campaigns. Ask Hub looks things up in Hub and links what it finds. It can suggest adding people to a campaign, but never changes anything without your click.</p>
                <ul className="ask-examples">
                  {EXAMPLES.map((e) => (
                    <li key={e}>
                      <button type="button" className="link-btn" onClick={() => ask(e)} disabled={!!capped}>
                        {e}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Transcript turns={saved.turns} />
            {saved.proposals.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                business={business}
                onDone={(msg) => setSaved((s) => ({ ...s, proposals: s.proposals.map((x) => (x.id === p.id ? { ...x, done: msg } : x)) }))}
              />
            ))}
            {busy && <Working turns={saved.turns} />}
            {error && <p className="notice warn small">{error}</p>}
            {capped && <p className="notice warn small">Ask Hub has reached this month's spending cap. An admin can raise it in Settings.</p>}
          </>
        )}
        <div ref={endRef} />
      </div>

      {!off && status && (
        <form
          className="ask-input"
          onSubmit={(e) => {
            e.preventDefault();
            ask(text);
          }}
        >
          <textarea
            ref={inputRef}
            rows={2}
            placeholder={page ? 'Ask about this page, or anything in Hub…' : 'Ask anything about Hub…'}
            value={text}
            disabled={busy || !!capped}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                ask(text);
              }
            }}
          />
          <div className="ask-foot">
            <span className="muted small" title="Records Ask Hub looks up are sent to Anthropic to answer. Anthropic doesn't train on them.">
              {saved.spentHere > 0 && `This chat ${usd(saved.spentHere)} · `}
              {spend ? `${usd(spend.month)} of ${usd(spend.cap, 0)} this month` : status && `${usd(status.monthSpendUsd)} of ${usd(status.monthlyCapUsd, 0)} this month`}
            </span>
            <button type="submit" className="btn small primary" disabled={busy || !text.trim() || !!capped}>
              {busy ? 'Working…' : 'Ask'}
            </button>
          </div>
        </form>
      )}
    </aside>
  );
}

const usd = (n: number, digits = 2) => `$${n.toFixed(digits)}`;

/** Drops a trailing assistant turn that asked for tools whose results never came, and any dangling user turn. */
function trimToComplete(turns: Turn[]): Turn[] {
  let end = turns.length;
  while (end > 0) {
    const t = turns[end - 1];
    const finishedAnswer = t.role === 'assistant' && !t.content.some((b) => b.type === 'tool_use');
    if (finishedAnswer) break;
    end--;
  }
  return turns.slice(0, end);
}

const questionOf = (t: Turn) =>
  t.content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text.replace(/^\[Context:[^\n]*\]\n?/, ''))
    .join('\n');

/** The user's questions and Ask Hub's answers; tool calls show as small chips. */
function Transcript({ turns }: { turns: Turn[] }) {
  return (
    <div className="ask-transcript">
      {turns.map((t, i) => {
        if (t.role === 'user') {
          const q = questionOf(t);
          return q ? (
            <div key={i} className="ask-q">
              {q}
            </div>
          ) : null;
        }
        const texts = t.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text');
        const tools = t.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
        return (
          <Fragment key={i}>
            {texts.map((b, j) => (
              <div key={j} className="ask-a">
                <Markdown text={b.text} />
              </div>
            ))}
            {tools.length > 0 && (
              <div className="ask-tools">
                {tools.map((u) => (
                  <span key={u.id} className="ask-tool">
                    {TOOL_LABEL[u.name] ?? u.name}
                    {u.name === 'locate' && typeof u.input.place === 'string' && `: ${u.input.place}`}
                    {u.name === 'search_contacts' && typeof u.input.text === 'string' && u.input.text && `: “${u.input.text}”`}
                  </span>
                ))}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function Working({ turns }: { turns: Turn[] }) {
  const last = turns[turns.length - 1];
  const label = last?.role === 'user' && last.content.some((b) => b.type === 'tool_result') ? 'Reading the results…' : 'Thinking…';
  return (
    <div className="ask-working muted small">
      <span className="spinner" aria-hidden="true" /> {label}
    </div>
  );
}

/** Ask Hub's suggestion as a button: add these people to a campaign as Suggested. */
function ProposalCard({ p, business, onDone }: { p: Proposal; business: string; onDone: (msg: string) => void }) {
  const { contacts } = useContacts();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const names = p.contactIds.map((id) => contacts.find((c) => c.id === id)).filter(Boolean).map((c) => displayName(c!));

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const id = p.campaignId ?? (await createMatchCampaign(business as 'Real Estate' | 'Staging', p.newCampaignName || 'Ask Hub suggestions', p.opportunityId));
      const err = await addMembers(id, p.contactIds.map((contactId) => ({ contactId, stage: 'suggested', source: 'ai' })));
      if (err) throw new Error(err);
      onDone(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask-proposal">
      <div className="small">
        <strong>
          Add {p.contactIds.length} to {p.campaignId ? 'the campaign' : `a new campaign “${p.newCampaignName}”`} as Suggested?
        </strong>
        {p.why && <div className="muted">{p.why}</div>}
        <div className="muted">{names.slice(0, 8).join(', ')}{names.length > 8 && `, and ${names.length - 8} more`}</div>
      </div>
      {p.done ? (
        <button type="button" className="link-btn small" onClick={() => navigate(`/campaigns/${p.done}`)}>
          Added. Open the campaign →
        </button>
      ) : (
        <div className="inline-actions">
          <button type="button" className="btn small primary" onClick={accept} disabled={busy}>
            {busy ? 'Adding…' : 'Add as Suggested'}
          </button>
          <button type="button" className="link-btn small" onClick={() => onDone('')} disabled={busy}>
            No thanks
          </button>
        </div>
      )}
      {p.done === '' && <span className="muted small">Dismissed.</span>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

// ---- A small, safe Markdown renderer: paragraphs, "- " lists, **bold**, [links](...) ----
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
    para = [];
  };
  const flushList = () => {
    if (list.length)
      blocks.push(
        <ul key={blocks.length}>
          {list.map((li, i) => (
            <li key={i}>{inline(li)}</li>
          ))}
        </ul>,
      );
    list = [];
  };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (!line) {
      flushPara();
      flushList();
    } else if (item) {
      flushPara();
      list.push(item[1]);
    } else {
      flushList();
      para.push(line.replace(/^#+\s*/, ''));
    }
  }
  flushPara();
  flushList();
  return <>{blocks}</>;
}

function inline(s: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<strong key={out.length}>{inline(m[1])}</strong>);
    else {
      const href = m[3];
      if (/^\/(contacts|campaigns|map|prospects)\b/.test(href)) out.push(<Link key={out.length} to={href}>{m[2]}</Link>);
      else if (/^https:\/\//.test(href))
        out.push(
          <a key={out.length} href={href} target="_blank" rel="noopener noreferrer">
            {m[2]}
          </a>,
        );
      else out.push(m[2]);
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}
