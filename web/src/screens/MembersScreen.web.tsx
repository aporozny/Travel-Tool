import React, { useEffect, useState, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import api from '../services/api.web';

const NEXT_TRIP_LABELS: Record<string, string> = {
  planning_now: 'Planning now',
  already_here: 'Already there',
  next_6_months: 'Next 6 months',
  within_a_year: 'Within a year',
  just_dreaming: 'Just dreaming',
};

const NEXT_TRIP_COLORS: Record<string, { bg: string; color: string }> = {
  planning_now:  { bg: '#E8F5E9', color: '#2E7D32' },
  already_here:  { bg: '#E3F2FD', color: '#1565C0' },
  next_6_months: { bg: '#FFF8E1', color: '#F57F17' },
  within_a_year: { bg: '#f5f5f5', color: '#666' },
  just_dreaming: { bg: '#f5f5f5', color: '#aaa' },
};

const BUDGET_LABELS: Record<string, string> = {
  budget: 'Budget',
  mid: 'Mid range',
  upper_mid: 'Upper mid',
  luxury: 'Luxury',
  ultra_luxury: 'Ultra luxury',
};

function Avatar({ name, avatar, size = 48 }: { name: string; avatar?: string; size?: number }) {
  const initials = name?.charAt(0)?.toUpperCase() || '?';
  if (avatar) {
    return <img src={avatar} alt={name} style={{ width: size, height: size, borderRadius: size / 2, objectFit: 'cover' }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: size / 2, background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, fontWeight: 700, flexShrink: 0 }}>
      {initials}
    </div>
  );
}

function MemberCard({ member, onConnect, onView }: any) {
  const tripColor = NEXT_TRIP_COLORS[member.next_trip_timing] || NEXT_TRIP_COLORS.just_dreaming;
  const allActivities = [
    ...(member.water_activities || []),
    ...(member.land_activities || []),
    ...(member.wellness_interests || []),
  ].slice(0, 4);

  const connectionStatus = member.connection_status;

  return (
    <div style={s.card} onClick={() => onView(member)}>
      <div style={s.cardTop}>
        <Avatar name={member.display_name} avatar={member.avatar_url} />
        <div style={s.cardInfo}>
          <h3 style={s.cardName}>{member.display_name}</h3>
          <p style={s.cardLocation}>
            {[member.home_city, member.home_country].filter(Boolean).join(', ') || 'Location private'}
          </p>
        </div>
        {member.next_trip_timing && (
          <span style={{ ...s.tripBadge, background: tripColor.bg, color: tripColor.color }}>
            {NEXT_TRIP_LABELS[member.next_trip_timing] || member.next_trip_timing}
          </span>
        )}
      </div>

      <div style={s.cardMeta}>
        {member.travel_style?.length > 0 && (
          <span style={s.metaChip}>{member.travel_style[0].replace(/_/g, ' ')}</span>
        )}
        {member.budget_range && (
          <span style={s.metaChip}>{BUDGET_LABELS[member.budget_range] || member.budget_range}</span>
        )}
        {member.sea_experience_level && (
          <span style={s.metaChip}>{member.sea_experience_level.replace(/_/g, ' ')}</span>
        )}
      </div>

      {allActivities.length > 0 && (
        <div style={s.activities}>
          {allActivities.map(a => (
            <span key={a} style={s.activityTag}>{a.replace(/_/g, ' ')}</span>
          ))}
        </div>
      )}

      {member.bucket_list_regions?.length > 0 && (
        <p style={s.regions}>
          Bucket list: {member.bucket_list_regions.slice(0, 3).map((r: string) => r.replace(/_/g, ' ')).join(' · ')}
        </p>
      )}

      <div style={s.cardActions} onClick={e => e.stopPropagation()}>
        {!connectionStatus && (
          <button style={s.connectBtn} onClick={() => onConnect(member)}>Connect</button>
        )}
        {connectionStatus === 'pending' && (
          <span style={s.pendingLabel}>Request sent</span>
        )}
        {connectionStatus === 'pending_received' && (
          <span style={{ ...s.pendingLabel, color: '#2E7D32' }}>Wants to connect</span>
        )}
        {connectionStatus === 'accepted' && (
          <span style={s.connectedLabel}>✓ Connected</span>
        )}
      </div>
    </div>
  );
}

function TripCard({ trip }: any) {
  return (
    <div style={s.tripCard}>
      <div style={s.tripTop}>
        <Avatar name={trip.member_name} avatar={trip.avatar_url} size={36} />
        <div>
          <p style={s.tripName}>{trip.member_name}</p>
          <p style={s.tripDest}>{trip.destination}{trip.region ? ` · ${trip.region}` : ''}</p>
        </div>
        {trip.start_date && (
          <span style={s.tripDate}>
            {new Date(trip.start_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}
            {trip.end_date ? ` → ${new Date(trip.end_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}
          </span>
        )}
      </div>
      {trip.looking_for?.length > 0 && (
        <div style={s.tripLooking}>
          Looking for: {trip.looking_for.map((l: string) => l.replace(/_/g, ' ')).join(', ')}
        </div>
      )}
      {trip.notes && <p style={s.tripNotes}>"{trip.notes}"</p>}
      <div style={s.tripMeta}>
        {trip.budget_range && <span style={s.metaChip}>{BUDGET_LABELS[trip.budget_range]}</span>}
        {trip.water_activities?.slice(0, 2).map((a: string) => (
          <span key={a} style={s.activityTag}>{a.replace(/_/g, ' ')}</span>
        ))}
      </div>
    </div>
  );
}

export default function MembersScreen() {
  const { user } = useSelector((s: RootState) => s.auth);
  const [tab, setTab] = useState<'directory' | 'trips' | 'connections'>('directory');
  const [members, setMembers] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<any>(null);
  const [connections, setConnections] = useState<any[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [connectMsg, setConnectMsg] = useState('');
  const [connecting, setConnecting] = useState<string | null>(null);
  const [filterRegion, setFilterRegion] = useState('');
  const [filterActivity, setFilterActivity] = useState('');
  const [filterNextTrip, setFilterNextTrip] = useState('');

  const fetchMembers = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterRegion) params.region = filterRegion;
      if (filterActivity) params.activity = filterActivity;
      if (filterNextTrip) params.next_trip = filterNextTrip;

      const res = await api.get('/members', { params });
      setMembers(res.data.members || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filterRegion, filterActivity, filterNextTrip]);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await api.get('/members/me/connections');
      setConnections(res.data || []);
      setPendingCount((res.data || []).filter((c: any) => c.direction === 'received' && c.status === 'pending').length);
    } catch (err) { console.error(err); }
  }, []);

  const fetchConnections2 = fetchConnections;

  const handleConnectionResponse = async (connectionId: string, status: 'accepted' | 'declined') => {
    try {
      await api.patch(`/members/connections/${connectionId}`, { status });
      setConnections(prev => prev.map(c => c.id === connectionId ? { ...c, status } : c));
      setPendingCount(prev => Math.max(0, prev - 1));
    } catch (err) { console.error(err); }
  };

  const fetchTrips = useCallback(async () => {
    try {
      const res = await api.get('/members/trips');
      setTrips(res.data || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    if (tab === 'directory') fetchMembers();
    else if (tab === 'trips') fetchTrips();
    else fetchConnections();
  }, [tab, fetchMembers, fetchTrips, fetchConnections]);

  // Load pending count on mount
  useEffect(() => { fetchConnections(); }, []);

  const handleConnect = async (member: any) => {
    if (connecting) return;
    setConnecting(member.user_id);
    try {
      await api.post(`/members/${member.user_id}/connect`, { message: connectMsg });
      setMembers(prev => prev.map(m =>
        m.user_id === member.user_id ? { ...m, connection_status: 'pending' } : m
      ));
      if (selected?.user_id === member.user_id) {
        setSelected({ ...selected, connection_status: 'pending' });
      }
    } catch (err: any) {
      console.error(err);
    } finally {
      setConnecting(null);
    }
  };

  if (selected) {
    return (
      <div style={s.container}>
        <div style={s.detail}>
          <button style={s.backBtn} onClick={() => setSelected(null)}>← Back to members</button>
          <div style={s.detailCard}>
            <div style={s.detailTop}>
              <Avatar name={selected.display_name} avatar={selected.avatar_url} size={64} />
              <div style={s.detailInfo}>
                <h2 style={s.detailName}>{selected.display_name}</h2>
                <p style={s.detailLocation}>
                  {[selected.home_city, selected.home_country].filter(Boolean).join(', ') || ''}
                </p>
                {selected.next_trip_timing && (
                  <span style={{ ...s.tripBadge, ...(NEXT_TRIP_COLORS[selected.next_trip_timing] || {}) }}>
                    {NEXT_TRIP_LABELS[selected.next_trip_timing]}
                  </span>
                )}
              </div>
            </div>

            <div style={s.detailSection}>
              <p style={s.detailSectionLabel}>Travel style</p>
              <div style={s.tagRow}>
                {selected.travel_style?.map((t: string) => <span key={t} style={s.metaChip}>{t.replace(/_/g, ' ')}</span>)}
                {selected.budget_range && <span style={s.metaChip}>{BUDGET_LABELS[selected.budget_range]}</span>}
                {selected.travel_pace && <span style={s.metaChip}>{selected.travel_pace}</span>}
              </div>
            </div>

            {([...( selected.water_activities || []), ...(selected.land_activities || []), ...(selected.wellness_interests || [])]).length > 0 && (
              <div style={s.detailSection}>
                <p style={s.detailSectionLabel}>Activities</p>
                <div style={s.tagRow}>
                  {[...(selected.water_activities || []), ...(selected.land_activities || []), ...(selected.wellness_interests || [])].map((a: string) => (
                    <span key={a} style={s.activityTag}>{a.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.bucket_list_regions?.length > 0 && (
              <div style={s.detailSection}>
                <p style={s.detailSectionLabel}>Bucket list regions</p>
                <div style={s.tagRow}>
                  {selected.bucket_list_regions.map((r: string) => (
                    <span key={r} style={s.activityTag}>{r.replace(/_/g, ' ')}</span>
                  ))}
                </div>
              </div>
            )}

            {selected.upcoming_trips?.length > 0 && (
              <div style={s.detailSection}>
                <p style={s.detailSectionLabel}>Upcoming trips</p>
                {selected.upcoming_trips.map((t: any) => (
                  <div key={t.id} style={s.upcomingTrip}>
                    <strong>{t.destination}</strong>
                    {t.start_date && ` · ${new Date(t.start_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    {t.notes && <p style={s.tripNotes}>"{t.notes}"</p>}
                  </div>
                ))}
              </div>
            )}

            <div style={s.detailSection}>
              <p style={s.detailSectionLabel}>Member since</p>
              <p style={s.detailMeta}>{new Date(selected.member_since).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' })}</p>
            </div>

            {!selected.connection_status && user?.id !== selected.user_id && (
              <div style={s.connectSection}>
                <p style={s.detailSectionLabel}>Send a connection request</p>
                <textarea
                  style={s.connectInput}
                  placeholder="Introduce yourself — where are you heading, what do you dive, what are you looking for? (optional)"
                  value={connectMsg}
                  onChange={e => setConnectMsg(e.target.value)}
                  maxLength={500}
                />
                <button
                  style={s.connectBtnLarge}
                  disabled={!!connecting}
                  onClick={() => handleConnect(selected)}>
                  {connecting === selected.user_id ? 'Sending...' : 'Send connection request'}
                </button>
              </div>
            )}
            {selected.connection_status === 'pending' && (
              <p style={s.pendingLabel}>Connection request sent</p>
            )}
            {selected.connection_status === 'accepted' && (
              <p style={s.connectedLabel}>✓ You are connected</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h2 style={s.title}>Members</h2>
        <p style={s.subtitle}>Find travellers heading to the same places</p>
        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(tab === 'directory' ? s.tabActive : {}) }} onClick={() => setTab('directory')}>Directory</button>
          <button style={{ ...s.tab, ...(tab === 'trips' ? s.tabActive : {}) }} onClick={() => setTab('trips')}>Upcoming trips</button>
          <button style={{ ...s.tab, ...(tab === 'connections' ? s.tabActive : {}) }} onClick={() => { setTab('connections'); fetchConnections(); }}>
            Connections
            {pendingCount > 0 && <span style={s.badge}>{pendingCount}</span>}
          </button>
        </div>
      </div>

      {tab === 'directory' && (
        <>
          <div style={s.filters}>
            <select style={s.filterSelect} value={filterNextTrip} onChange={e => setFilterNextTrip(e.target.value)}>
              <option value="">Any timing</option>
              <option value="planning_now">Planning now</option>
              <option value="already_here">Already there</option>
              <option value="next_6_months">Next 6 months</option>
              <option value="within_a_year">Within a year</option>
            </select>
            <select style={s.filterSelect} value={filterRegion} onChange={e => setFilterRegion(e.target.value)}>
              <option value="">Any region</option>
              {['bali', 'nusa_penida', 'lombok', 'gili_islands', 'flores', 'raja_ampat'].map(r => (
                <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select style={s.filterSelect} value={filterActivity} onChange={e => setFilterActivity(e.target.value)}>
              <option value="">Any activity</option>
              {['scuba_diving', 'surfing', 'hiking', 'yoga', 'snorkeling', 'sailing', 'freediving'].map(a => (
                <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          {loading ? (
            <div style={s.loading}>Finding members...</div>
          ) : members.length === 0 ? (
            <div style={s.empty}>
              <p>No members found with those filters.</p>
              <p style={{ color: '#bbb', fontSize: 13, marginTop: 8 }}>The community is just getting started. Be one of the first.</p>
            </div>
          ) : (
            <div style={s.grid}>
              {members.map(m => (
                <MemberCard
                  key={m.user_id}
                  member={m}
                  onConnect={handleConnect}
                  onView={setSelected}
                />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'connections' && (
        <div style={s.tripList}>
          {connections.length === 0 ? (
            <div style={s.empty}><p>No connections yet.</p><p style={{ color: '#bbb', fontSize: 13, marginTop: 8 }}>Connect with members from the directory.</p></div>
          ) : (
            connections.map(c => (
              <div key={c.id} style={s.tripCard}>
                <div style={s.tripTop}>
                  <Avatar name={c.other_display_name} size={36} />
                  <div style={{ flex: 1 }}>
                    <p style={s.tripName}>{c.other_display_name}</p>
                    <p style={s.tripDest}>
                      {c.other_regions?.slice(0,2).map((r: string) => r.replace(/_/g,' ')).join(' · ')}
                      {c.other_next_trip ? ` · ${NEXT_TRIP_LABELS[c.other_next_trip] || c.other_next_trip}` : ''}
                    </p>
                  </div>
                  <span style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600,
                    background: c.status === 'accepted' ? '#E8F5E9' : c.status === 'declined' ? '#ffebee' : '#FFF8E1',
                    color: c.status === 'accepted' ? '#2E7D32' : c.status === 'declined' ? '#c62828' : '#F57F17',
                  }}>
                    {c.direction === 'received' && c.status === 'pending' ? 'Wants to connect' :
                     c.direction === 'sent' && c.status === 'pending' ? 'Request sent' :
                     c.status}
                  </span>
                </div>
                {c.message && <p style={s.tripNotes}>"{c.message}"</p>}
                {c.direction === 'received' && c.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button style={s.connectBtn} onClick={() => handleConnectionResponse(c.id, 'accepted')}>Accept</button>
                    <button style={{ ...s.connectBtn, background: '#fff', color: '#c62828', border: '1px solid #ffcdd2' }}
                      onClick={() => handleConnectionResponse(c.id, 'declined')}>Decline</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'trips' && (
        <div style={s.tripList}>
          {trips.length === 0 ? (
            <div style={s.empty}>
              <p>No upcoming trips posted yet.</p>
              <p style={{ color: '#bbb', fontSize: 13, marginTop: 8 }}>Post your trip to find travel buddies.</p>
            </div>
          ) : (
            trips.map(t => <TripCard key={t.id} trip={t} />)
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { height: '100%', overflow: 'auto', background: '#f8f8f6' },
  header: { background: '#fff', borderBottom: '1px solid #f0f0f0', padding: '24px 24px 0' },
  title: { fontSize: 24, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#888', marginBottom: 16 },
  tabs: { display: 'flex', gap: 4, borderBottom: '2px solid #f0f0f0' },
  badge: { background: '#c62828', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11, marginLeft: 6 },
  tab: { padding: '10px 20px', border: 'none', background: 'transparent', fontSize: 14, color: '#888', cursor: 'pointer', fontWeight: 500 },
  tabActive: { color: '#1a1a1a', borderBottom: '2px solid #1a1a1a', marginBottom: -2 },
  filters: { display: 'flex', gap: 8, padding: '14px 24px', background: '#fff', borderBottom: '1px solid #f0f0f0', flexWrap: 'wrap' },
  filterSelect: { padding: '7px 12px', borderRadius: 8, border: '1px solid #e0e0e0', fontSize: 13, color: '#555', background: '#fff' },
  loading: { padding: 60, textAlign: 'center', color: '#999' },
  empty: { padding: 60, textAlign: 'center', color: '#888' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, padding: 24 },
  card: { background: '#fff', borderRadius: 14, padding: 20, cursor: 'pointer', boxShadow: '0 1px 6px rgba(0,0,0,0.06)' },
  cardTop: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  cardInfo: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 },
  cardLocation: { fontSize: 12, color: '#999' },
  tripBadge: { fontSize: 11, padding: '3px 8px', borderRadius: 6, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 },
  cardMeta: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  metaChip: { fontSize: 12, color: '#666', background: '#f5f5f5', padding: '3px 9px', borderRadius: 6, textTransform: 'capitalize' },
  activities: { display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 },
  activityTag: { fontSize: 11, color: '#2E7D32', background: '#E8F5E9', padding: '2px 7px', borderRadius: 5, textTransform: 'capitalize' },
  regions: { fontSize: 12, color: '#888', marginBottom: 12 },
  cardActions: { borderTop: '1px solid #f5f5f5', paddingTop: 12, marginTop: 4 },
  connectBtn: { padding: '7px 18px', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer' },
  pendingLabel: { fontSize: 13, color: '#888', fontStyle: 'italic' },
  connectedLabel: { fontSize: 13, color: '#2E7D32', fontWeight: 500 },
  tripList: { padding: 24, display: 'flex', flexDirection: 'column', gap: 12 },
  tripCard: { background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' },
  tripTop: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 },
  tripName: { fontSize: 14, fontWeight: 600, color: '#1a1a1a' },
  tripDest: { fontSize: 13, color: '#888' },
  tripDate: { fontSize: 12, color: '#2E7D32', marginLeft: 'auto', whiteSpace: 'nowrap', fontWeight: 500 },
  tripLooking: { fontSize: 13, color: '#555', marginBottom: 6 },
  tripNotes: { fontSize: 13, color: '#666', fontStyle: 'italic', marginBottom: 8 },
  tripMeta: { display: 'flex', flexWrap: 'wrap', gap: 5 },
  detail: { maxWidth: 700, margin: '0 auto', padding: 24 },
  backBtn: { background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13, color: '#666', marginBottom: 20 },
  detailCard: { background: '#fff', borderRadius: 16, padding: 28, boxShadow: '0 1px 6px rgba(0,0,0,0.06)' },
  detailTop: { display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 24 },
  detailInfo: { flex: 1 },
  detailName: { fontSize: 22, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 },
  detailLocation: { fontSize: 14, color: '#888', marginBottom: 8 },
  detailSection: { marginBottom: 20 },
  detailSectionLabel: { fontSize: 12, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  detailMeta: { fontSize: 14, color: '#555' },
  tagRow: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  upcomingTrip: { background: '#f8f8f6', borderRadius: 10, padding: '12px 14px', marginBottom: 8, fontSize: 14, color: '#555' },
  connectSection: { borderTop: '1px solid #f0f0f0', paddingTop: 20, marginTop: 4 },
  connectInput: { width: '100%', padding: '12px 14px', border: '1.5px solid #e0e0e0', borderRadius: 10, fontSize: 14, minHeight: 80, resize: 'vertical', boxSizing: 'border-box', marginBottom: 12, fontFamily: 'inherit' },
  connectBtnLarge: { width: '100%', padding: '12px 0', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer' },
};
