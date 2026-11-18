import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MatchRow } from '../components/MatchesPanel';
import { matchListing, matchRequirement } from '../lib/matching';
import { useOpportunities } from '../lib/opportunities';
import { MapView } from '../components/MapView';
import { MultiSelect } from '../components/MultiSelect';
import { PlaceSearch } from '../components/PlaceSearch';
import { ProspectCard } from '../components/ProspectCard';
import { ProspectDetail } from '../components/ProspectDetail';
import { distanceToRoute, formatKm, haversineKm, indexRoute } from '../lib/geo';
import { currentPosition, fetchRoute, reverseGeocode } from '../lib/services';
import { EMPTY_FILTERS, matchesFilters } from '../lib/filters';
import { useSession } from '../lib/session';
import { exportCallList, useContacts } from '../lib/store';
import {
  CATEGORIES,
  CUSTOMER_TYPES,
  REGIONS,
  STATUSES,
  type Filters,
  type LatLng,
  type Match,
  type Mode,
  type Place,
  type Property,
  type RouteResult,
} from '../types';


type Sort = 'distance' | 'name' | 'value';

export default function MapPage() {
  const [notice, setNotice] = useState('');
  const { business } = useSession();
  const { contacts, loading, update } = useContacts();
  // The map shows prospects in the business picked in the sidebar.
  const { opportunities } = useOpportunities();
  const [params, setParams] = useSearchParams();
  const matchId = params.get('match');

  // Match mode (/map?match=<opportunity>): the map centres on the listing or requirement, and the list
  // shows every match with its score, including buyers who own no land (so have no pin).
  const matchState = useMemo(() => {
    const opportunity = matchId ? opportunities.find((o) => o.id === matchId) : undefined;
    const owner = opportunity && contacts.find((c) => c.id === opportunity.contactId);
    if (!opportunity || !owner) return null;
    const property = owner.properties.find((p) => p.id === opportunity.propertyId);
    const data = { contacts, opportunities };
    const results = opportunity.kind === 'listing' ? matchListing({ opportunity, contact: owner, property }, data) : matchRequirement({ opportunity, contact: owner }, data);
    const point =
      opportunity.kind === 'listing'
        ? property && { lat: property.lat, lng: property.lng }
        : opportunity.areaLat != null && opportunity.areaLng != null
          ? { lat: opportunity.areaLat, lng: opportunity.areaLng }
          : undefined;
    return { opportunity, owner, property, results, point, radiusKm: opportunity.areaRadiusKm ?? 25 };
  }, [matchId, opportunities, contacts]);

  const businessProspects = useMemo(() => contacts.filter((c) => c.isProspect && c.business === business), [contacts, business]);
  // In match mode the map shows the subject's land and the matches' land; otherwise every prospect.
  const prospects = useMemo(() => {
    if (!matchState) return businessProspects;
    const ids = new Set([matchState.owner.id, ...matchState.results.map((r) => r.contact.id)]);
    return contacts.filter((c) => ids.has(c.id) && c.properties.length);
  }, [matchState, businessProspects, contacts]);
  const campaigns = useMemo(() => [...new Set(prospects.flatMap((p) => p.campaigns))].sort((a, b) => a.localeCompare(b)), [prospects]);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [mode, setMode] = useState<Mode>('near');
  const [center, setCenter] = useState<Place | null>(null);
  const [radiusKm, setRadiusKm] = useState(10);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [corridorKm, setCorridorKm] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>('distance');
  const [mobileView, setMobileView] = useState<'map' | 'list'>('map');
  const [locating, setLocating] = useState(false);

  // Entering match mode centres the map on the listing's land or the buyer's search area.
  useEffect(() => {
    if (!matchState?.point) return;
    setMode('near');
    setCenter({ ...matchState.point, label: matchState.opportunity.kind === 'listing' ? matchState.property?.address ?? 'the listing' : matchState.opportunity.areaLabel || 'their area' });
    setRadiusKm(Math.round(matchState.radiusKm));
    setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchState?.opportunity.id, matchState?.point?.lat, matchState?.point?.lng]);

  const exitMatch = () => {
    const next = new URLSearchParams(params);
    next.delete('match');
    setParams(next, { replace: true });
    setCenter(null);
  };

  // Fetch a driving route whenever both ends are set.
  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      return;
    }
    const ac = new AbortController();
    setRouting(true);
    fetchRoute(origin, destination, ac.signal)
      .then((r) => {
        setRoute(r);
        if (r.approximate) setNotice('Routing service unavailable — using a straight line between the two points.');
      })
      .catch((e) => e.name !== 'AbortError' && setNotice(e.message))
      .finally(() => !ac.signal.aborted && setRouting(false));
    return () => ac.abort();
  }, [origin, destination]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const filtered = useMemo(() => prospects.filter((p) => matchesFilters(p, filters)), [prospects, filters]);

  const routeIndex = useMemo(() => (route ? indexRoute(route.line) : null), [route]);
  const searchActive = (mode === 'near' && !!center) || (mode === 'route' && !!routeIndex);

  // One entry per property, scored against the active search.
  const pins: Match[] = useMemo(
    () =>
      filtered.flatMap((prospect) =>
        prospect.properties.map((property) => {
          if (mode === 'near' && center) {
            const distanceKm = haversineKm(center, property);
            return { prospect, property, distanceKm, inRange: distanceKm <= radiusKm };
          }
          if (mode === 'route' && routeIndex) {
            const { distKm, alongKm } = distanceToRoute(property, routeIndex);
            return { prospect, property, distanceKm: distKm, alongKm, inRange: distKm <= corridorKm };
          }
          return { prospect, property, distanceKm: 0, inRange: true };
        }),
      ),
    [filtered, mode, center, radiusKm, routeIndex, corridorKm],
  );

  // One entry per prospect: their closest qualifying property.
  const matches: Match[] = useMemo(() => {
    const best = new Map<string, Match>();
    for (const m of pins) {
      if (!m.inRange) continue;
      const cur = best.get(m.prospect.id);
      if (!cur || m.distanceKm < cur.distanceKm) best.set(m.prospect.id, m);
    }
    const list = [...best.values()];
    const byName = (a: Match, b: Match) => a.prospect.lastName.localeCompare(b.prospect.lastName);
    if (sort === 'value') return list.sort((a, b) => (b.prospect.dealValue ?? 0) - (a.prospect.dealValue ?? 0));
    if (sort === 'name' || !searchActive) return list.sort(byName);
    // In route mode "distance" means the order you would reach them while driving.
    if (mode === 'route') return list.sort((a, b) => (a.alongKm ?? 0) - (b.alongKm ?? 0));
    return list.sort((a, b) => a.distanceKm - b.distanceKm);
  }, [pins, sort, searchActive, mode]);

  const selected = selectedId ? prospects.find((p) => p.id === selectedId) ?? null : null;

  const handleMapClick = useCallback(
    async (p: LatLng) => {
      const place: Place = { ...p, label: 'Dropped pin' };
      const setter =
        mode === 'near' ? setCenter : !destination ? setDestination : !origin ? setOrigin : setDestination;
      setter(place);
      const label = await reverseGeocode(p);
      setter((cur) => (cur && cur.lat === p.lat && cur.lng === p.lng ? { ...cur, label } : cur));
    },
    [mode, origin, destination],
  );

  const useMyLocation = async () => {
    setLocating(true);
    try {
      setOrigin(await currentPosition());
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setLocating(false);
    }
  };

  const routeTo = (prop: Property) => {
    setMode('route');
    setDestination({ lat: prop.lat, lng: prop.lng, label: prop.address });
    if (!origin && center) setOrigin(center);
    setSelectedId(null);
  };

  const filterCount =
    filters.statuses.length +
    filters.regions.length +
    filters.categories.length +
    filters.customerTypes.length +
    filters.campaigns.length +
    (filters.followUpOnly ? 1 : 0) +
    (filters.text ? 1 : 0);

  const set = <K extends keyof Filters>(k: K) => (v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  const summary = (() => {
    if (loading) return 'Loading prospects…';
    const n = matches.length;
    const noun = n === 1 ? 'prospect' : 'prospects';
    if (mode === 'near' && center) return `${n} ${noun} within ${radiusKm} km of ${center.label}`;
    if (mode === 'route' && route)
      return `${n} ${noun} within ${corridorKm} km of your route`;
    if (mode === 'route') return `${n} ${noun} — set a start and destination to search along a route`;
    return `${n} ${noun} — search or click the map to find who's nearby`;
  })();

  return (
    <div className={`map-page view-${mobileView}`}>
      <header className="topbar">

        <div className="seg" role="tablist" aria-label="Search mode">
          <button role="tab" aria-selected={mode === 'near'} className={mode === 'near' ? 'on' : ''} onClick={() => setMode('near')}>
            Near a place
          </button>
          <button role="tab" aria-selected={mode === 'route'} className={mode === 'route' ? 'on' : ''} onClick={() => setMode('route')}>
            Along a route
          </button>
        </div>

        <div className="search-area">
          {mode === 'near' ? (
            <PlaceSearch large placeholder="Search a town, address or postal code" value={center} onSelect={setCenter} />
          ) : (
            <div className="route-inputs">
              <PlaceSearch
                placeholder="From"
                value={origin}
                onSelect={setOrigin}
                accessory={
                  <button type="button" className="loc-btn" onClick={useMyLocation} disabled={locating} title="Use my location">
                    {locating ? <span className="spinner" /> : (
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                        <circle cx="8" cy="8" r="3" fill="currentColor" />
                        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
                      </svg>
                    )}
                    <span className="sr-only">Use my location</span>
                  </button>
                }
              />
              <button
                type="button"
                className="swap-btn"
                title="Swap start and destination"
                onClick={() => {
                  setOrigin(destination);
                  setDestination(origin);
                }}
              >
                ⇅
              </button>
              <PlaceSearch placeholder="To" value={destination} onSelect={setDestination} />
            </div>
          )}
        </div>

      </header>

      <div className="filterbar">
        <div className="range">
          <label htmlFor="range">{mode === 'near' ? 'Within' : 'Off route'}</label>
          <input
            id="range"
            type="range"
            min={mode === 'near' ? 1 : 0.5}
            max={mode === 'near' ? 50 : 15}
            step={mode === 'near' ? 1 : 0.5}
            value={mode === 'near' ? radiusKm : corridorKm}
            onChange={(e) => (mode === 'near' ? setRadiusKm : setCorridorKm)(Number(e.target.value))}
          />
          <output>{mode === 'near' ? radiusKm : corridorKm} km</output>
        </div>
        <span className="divider" />
        <MultiSelect label="Status" options={STATUSES} value={filters.statuses} onChange={set('statuses')} />
        <MultiSelect label="Customer type" options={CUSTOMER_TYPES} value={filters.customerTypes} onChange={set('customerTypes')} />
        <MultiSelect label="Category" options={CATEGORIES} value={filters.categories} onChange={set('categories')} />
        <MultiSelect label="Region" options={REGIONS} value={filters.regions} onChange={set('regions')} />
        <MultiSelect label="Campaign" options={campaigns} value={filters.campaigns} onChange={set('campaigns')} />
        <button
          type="button"
          className={`chip-btn ${filters.followUpOnly ? 'active' : ''}`}
          aria-pressed={filters.followUpOnly}
          onClick={() => set('followUpOnly')(!filters.followUpOnly)}
        >
          Follow up
        </button>
        <input
          className="text-filter"
          placeholder="Name, company or phone"
          value={filters.text}
          onChange={(e) => set('text')(e.target.value)}
        />
        {filterCount > 0 && (
          <button type="button" className="link-btn" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filters
          </button>
        )}
      </div>

      <main className="body">
        <section className="map-wrap">
          <MapView
            pins={pins}
            searchActive={searchActive}
            mode={mode}
            center={center}
            radiusKm={radiusKm}
            origin={origin}
            destination={destination}
            route={route}
            corridorKm={corridorKm}
            selectedId={selectedId}
            hoveredId={hoveredId}
            onMapClick={handleMapClick}
            onSelect={(id) => {
              setSelectedId(id);
              setMobileView('list');
            }}
            onHover={setHoveredId}
          />
          <div className="map-hint">
            {mode === 'near'
              ? 'Click the map to search around that spot'
              : !destination
                ? 'Click the map to set your destination'
                : !origin
                  ? 'Click the map to set your start, or use your location'
                  : 'Click the map to move the destination'}
          </div>
          {mode === 'route' && route && (
            <div className="route-chip">
              {routing ? 'Routing…' : `${formatKm(route.distanceKm)} · ${Math.round(route.durationMin)} min drive`}
              {route.approximate && ' (straight line)'}
            </div>
          )}
          {notice && <div className="toast" role="status">{notice}</div>}
        </section>

        <section className="list-wrap">
          {selected ? (
            <ProspectDetail
              prospect={selected}
              from={mode === 'near' ? center : origin}
              onClose={() => setSelectedId(null)}
              onUpdate={(patch) => update(selected.id, patch)}
              onRouteTo={routeTo}
            />
          ) : matchState ? (
            <div className="match-mode">
              <div className="list-head">
                <p className="summary">
                  {matchState.opportunity.kind === 'listing' ? 'Who might buy' : 'Land for'} “{matchState.opportunity.title}”
                </p>
                <div className="list-tools">
                  <span className="muted small">
                    {matchState.results.length} match{matchState.results.length === 1 ? '' : 'es'} · for {matchState.owner.firstName} {matchState.owner.lastName}
                  </span>
                  <button type="button" className="btn small" onClick={exitMatch}>
                    Exit match mode
                  </button>
                </div>
              </div>
              {matchState.results.length === 0 ? (
                <div className="empty">
                  <strong>No matches yet.</strong>
                  <span>Add more detail to the {matchState.opportunity.kind}, or add requirements and listings to other contacts.</span>
                </div>
              ) : (
                <ul className="match-list match-mode-list">
                  {matchState.results.map((m) => (
                    <MatchRow
                      key={`${m.kind}:${m.contact.id}:${m.opportunity?.id ?? m.property?.id ?? ''}`}
                      m={m}
                      onShow={m.property ? () => setSelectedId(m.contact.id) : undefined}
                    />
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <>
              <div className="list-head">
                <p className="summary">{summary}</p>
                <div className="list-tools">
                  <label className="sort">
                    Sort
                    <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                      <option value="distance">{mode === 'route' ? 'Order along route' : 'Closest first'}</option>
                      <option value="value">Deal value</option>
                      <option value="name">Name</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn small"
                    disabled={!matches.length}
                    onClick={() =>
                      exportCallList(
                        matches.map((m) => ({
                          prospect: m.prospect,
                          address: m.property.address,
                          distanceLabel: searchActive ? formatKm(m.distanceKm) : '',
                        })),
                      )
                    }
                  >
                    Export call list
                  </button>
                </div>
              </div>
              <div className="cards">
                {matches.map((m) => (
                  <ProspectCard
                    key={m.prospect.id}
                    match={m}
                    mode={mode}
                    searchActive={searchActive}
                    selected={m.prospect.id === selectedId}
                    hovered={m.prospect.id === hoveredId}
                    onSelect={() => setSelectedId(m.prospect.id)}
                    onHover={(on) => setHoveredId(on ? m.prospect.id : null)}
                  />
                ))}
                {matches.length === 0 && (
                  <div className="empty">
                    <strong>No prospects here.</strong>
                    <span>
                      {searchActive
                        ? `Try widening the ${mode === 'near' ? 'radius' : 'corridor'} or clearing filters.`
                        : 'Try clearing some filters.'}
                    </span>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>

      <button type="button" className="view-toggle" onClick={() => setMobileView((v) => (v === 'map' ? 'list' : 'map'))}>
        {mobileView === 'map' ? `List (${matches.length})` : 'Map'}
      </button>
    </div>
  );
}

