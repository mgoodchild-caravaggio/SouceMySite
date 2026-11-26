import { useCallback, useEffect, useState } from 'react';
import { callFunction } from './outlook';
import { supabase } from './supabase';

/** Ask Hub outside research: runs (one request each) and the leads they found. */
export type ResearchKind = 'developers' | 'applications';

/** The areas Caravaggio works in; the server knows their official municipal sites. */
export const RESEARCH_AREAS = ['Simcoe (Barrie, Innisfil, Bradford West Gwillimbury)', 'Durham', 'York Region', 'Hamilton / Halton / Peel'];

export interface ResearchRun {
  id: string;
  kind: ResearchKind;
  area: string;
  focus: string;
  status: 'running' | 'done' | 'failed';
  summary: string;
  error?: string;
  steps: number;
  searches: number;
  costUsd: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Finding {
  id: string;
  runId: string;
  kind: 'developer' | 'application';
  name: string;
  contactName: string;
  role: string;
  website: string;
  phone: string;
  email: string;
  address: string;
  municipality: string;
  summary: string;
  appStatus: string;
  fileNumber: string;
  sourceUrl: string;
  sourceTitle: string;
  lat?: number;
  lng?: number;
  state: 'new' | 'added' | 'dismissed';
  contactId?: string;
  createdAt: string;
}

type RunRow = Record<string, unknown>;
const runFromRow = (r: RunRow): ResearchRun => ({
  id: r.id as string,
  kind: r.kind as ResearchKind,
  area: r.area as string,
  focus: (r.focus as string) ?? '',
  status: r.status as ResearchRun['status'],
  summary: (r.summary as string) ?? '',
  error: (r.error as string) ?? undefined,
  steps: Number(r.steps ?? 0),
  searches: Number(r.searches ?? 0),
  costUsd: Number(r.cost_usd ?? 0),
  createdBy: (r.created_by as string) ?? undefined,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
const findingFromRow = (r: Record<string, unknown>): Finding => ({
  id: r.id as string,
  runId: r.run_id as string,
  kind: r.kind as Finding['kind'],
  name: r.name as string,
  contactName: r.contact_name as string,
  role: r.role as string,
  website: r.website as string,
  phone: r.phone as string,
  email: r.email as string,
  address: r.address as string,
  municipality: r.municipality as string,
  summary: r.summary as string,
  appStatus: r.app_status as string,
  fileNumber: r.file_number as string,
  sourceUrl: r.source_url as string,
  sourceTitle: r.source_title as string,
  lat: (r.lat as number) ?? undefined,
  lng: (r.lng as number) ?? undefined,
  state: r.state as Finding['state'],
  contactId: (r.contact_id as string) ?? undefined,
  createdAt: r.created_at as string,
});

const RUN_COLUMNS = 'id, kind, area, focus, status, summary, error, steps, searches, cost_usd, created_by, created_at, updated_at';

/** Recent runs and every finding from them. */
export function useResearch() {
  const [runs, setRuns] = useState<ResearchRun[] | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [{ data: r, error: e1 }, { data: f, error: e2 }] = await Promise.all([
      supabase.from('research_runs').select(RUN_COLUMNS).order('created_at', { ascending: false }).limit(30),
      supabase.from('research_findings').select('*').order('created_at', { ascending: false }).limit(1000),
    ]);
    if (e1 || e2) return setError((e1 ?? e2)!.message);
    setRuns((r ?? []).map(runFromRow));
    setFindings((f ?? []).map(findingFromRow));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patchFinding = async (id: string, patch: Record<string, unknown>) => {
    const { data, error: e } = await supabase.from('research_findings').update(patch).eq('id', id).select('*').single();
    if (e) return e.message;
    setFindings((prev) => prev.map((x) => (x.id === id ? findingFromRow(data) : x)));
    return '';
  };

  return { runs, findings, error, reload: load, patchFinding };
}

export interface StepResult {
  runId: string;
  status: ResearchRun['status'];
  busy?: boolean;
  found?: number;
}
export const startResearch = (kind: ResearchKind, area: string, focus: string) => callFunction<StepResult>('ai-research', { action: 'start', kind, area, focus });
export const continueResearch = (runId: string) => callFunction<StepResult>('ai-research', { action: 'continue', runId });

/** A run nobody has advanced for a while (the page was closed mid-way): it can be continued by hand. */
export const isStalled = (r: ResearchRun) => r.status === 'running' && Date.now() - Date.parse(r.updatedAt) > 4 * 60_000;

export const domainOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};
