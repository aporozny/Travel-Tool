import React, { useEffect, useState } from 'react';
import api from '../services/api.web';

const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  red:       '#C62828',
  redLight:  '#FFEBEE',
  green:     '#10B981',
  greenLight:'#ECFDF5',
  bg:        '#f8f7f4',
  white:     '#FFFFFF',
  border:    '#F0EDE8',
  text:      '#1A1A1A',
  muted:     '#9B9590',
};

const REGIONS = [
  'Seminyak','Canggu','Ubud','Nusa Penida','Uluwatu',
  'Sanur','Amed','Tulamben','Lombok','Gili Islands','Flores','Sidemen',
];

export default function SafetyScreen() {
  const [tab, setTab] = useState<'overview'|'trips'|'contacts'|'verify'|'location'>('overview');
  const [contacts, setContacts] = useState<any[]>([]);
  const [trips, setTrips] = useState<any[]>([]);
  const [verification, setVerification] = useState<any>({ status: 'none' });
  const [sosLoading, setSosLoading] = useState(false);
  const [sosResult, setSosResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Location tracking
  const [currentLocation, setCurrentLocation] = useState<any>(null);
  const [locationHistory, setLocationHistory] = useState<any[]>([]);
  const [postingLocation, setPostingLocation] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // New trip form
  const [showTripForm, setShowTripForm] = useState(false);
  const [tripDest, setTripDest] = useState('');
  const [tripRegion, setTripRegion] = useState('');
  const [tripStart, setTripStart] = useState('');
  const [tripEnd, setTripEnd] = useState('');
  const [tripNotes, setTripNotes] = useState('');
  const [tripPublic, setTripPublic] = useState(true);
  const [savingTrip, setSavingTrip] = useState(false);

  // New contact form
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRel, setContactRel] = useState('');
  const [savingContact, setSavingContact] = useState(false);

  useEffect(() => {
    Promise.all([
      api.get('/safety/contacts').catch(() => ({ data: [] })),
      api.get('/safety/trips').catch(() => ({ data: [] })),
      api.get('/safety/verification/status').catch(() => ({ data: { status: 'none' } })),
      api.get('/safety/location/history?limit=10').catch(() => ({ data: [] })),
    ]).then(([c, t, v, h]) => {
      setContacts(c.data || []);
      setTrips(t.data || []);
      setVerification(v.data || { status: 'none' });
      setLocationHistory(h.data || []);
    }).finally(() => setLoading(false));
  }, []);

  const handlePostLocation = async () => {
    setPostingLocation(true);
    setGeoError(null);
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject);
      });
      const { latitude, longitude } = position.coords;
      const { data } = await api.post('/safety/location', { latitude, longitude });
      setCurrentLocation(data);
      alert(`Location saved: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
      const updated = await api.get('/safety/location/history?limit=10');
      setLocationHistory(updated.data || []);
    } catch (e: any) {
      const msg = e.message || 'Could not get location';
      setGeoError(msg);
      alert(`Error: ${msg}`);
    } finally {
      setPostingLocation(false);
    }
  };

  const handleSOS = async () => {
    if (!window.confirm(`Send SOS alert to ${contacts.filter((c: any) => c.receives_sos).length} emergency contact(s)?`)) return;
    setSosLoading(true);
    try {
      const { data } = await api.post('/safety/sos', { message: 'SOS triggered from web app' });
      setSosResult(`SOS sent. ${data.contacts_notified} contact(s) notified.`);
    } catch {
      setSosResult('Could not send SOS. Please call emergency services directly.');
    } finally {
      setSosLoading(false);
    }
  };

  const handleVerify = async () => {
    try {
      const { data } = await api.post('/safety/verification/initiate');
      alert(`Verification initiated (ID: ${data.verificationId}). Stripe Identity integration pending API key configuration.`);
      setVerification({ status: 'pending' });
    } catch {
      alert('Could not initiate verification. Please try again.');
    }
  };

  const handleCreateTrip = async () => {
    if (!tripDest.trim()) return;
    setSavingTrip(true);
    try {
      const res = await api.post('/safety/trips', {
        destination: tripDest,
        region: tripRegion || undefined,
        start_date: tripStart || undefined,
        end_date: tripEnd || undefined,
        notes: tripNotes || undefined,
        is_public: tripPublic,
      });
      setTrips(prev => [res.data, ...prev]);
      setShowTripForm(false);
      setTripDest(''); setTripRegion(''); setTripStart(''); setTripEnd(''); setTripNotes('');
    } catch {
      alert('Could not save trip. Please try again.');
    } finally {
      setSavingTrip(false);
    }
  };

  const handleCheckin = async (tripId: string) => {
    try {
      await api.post('/safety/trips/checkin', { tripId });
      const updated = await api.get('/safety/trips');
      setTrips(updated.data || []);
      alert('Checked in successfully!');
    } catch {
      alert('Check-in failed. Please try again.');
    }
  };

  const handleStartTrip = async (tripId: string) => {
    try {
      await api.post(`/safety/trips/${tripId}/start`);
      const updated = await api.get('/safety/trips');
      setTrips(updated.data || []);
    } catch {
      alert('Could not start trip.');
    }
  };

  const handleCompleteTrip = async (tripId: string) => {
    if (!window.confirm('Mark this trip as complete?')) return;
    try {
      await api.post(`/safety/trips/${tripId}/complete`);
      const updated = await api.get('/safety/trips');
      setTrips(updated.data || []);
    } catch {
      alert('Could not complete trip.');
    }
  };

  const handleAddContact = async () => {
    if (!contactName.trim() || (!contactEmail.trim() && !contactPhone.trim())) {
      alert('Name and email or phone required.');
      return;
    }
    setSavingContact(true);
    try {
      const res = await api.post('/safety/contacts', {
        name: contactName,
        email: contactEmail || undefined,
        phone: contactPhone || undefined,
        relationship: contactRel || undefined,
        can_see_location: true,
        receives_sos: true,
      });
      setContacts(prev => [...prev, res.data]);
      setShowContactForm(false);
      setContactName(''); setContactEmail(''); setContactPhone(''); setContactRel('');
    } catch {
      alert('Could not add contact.');
    } finally {
      setSavingContact(false);
    }
  };

  const handleDeleteContact = async (id: string) => {
    if (!window.confirm('Remove this contact?')) return;
    try {
      await api.delete(`/safety/contacts/${id}`);
      setContacts(prev => prev.filter((c: any) => c.id !== id));
    } catch {}
  };

  const verifyStatus = verification.status;
  const verifyColour = verifyStatus === 'verified' ? C.green : verifyStatus === 'pending' || verifyStatus === 'processing' ? C.gold : C.muted;
  const verifyLabel = { none: 'Not verified', pending: 'Pending', submitted: 'Submitted', processing: 'Processing', verified: 'Verified', failed: 'Failed', expired: 'Expired' }[verifyStatus] || 'Unknown';

  const TABS = [
    { key: 'overview', label: 'Overview' },
    { key: 'trips', label: `Trips${trips.length ? ` (${trips.length})` : ''}` },
    { key: 'location', label: 'Location' },
    { key: 'contacts', label: `Contacts${contacts.length ? ` (${contacts.length})` : ''}` },
    { key: 'verify', label: 'Identity' },
  ];

  return (
    <div style={s.container}>
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Safety</h1>
          <p style={s.subtitle}>Trips, check-ins, and emergency tools</p>
        </div>
      </div>

      {/* Tabs */}
      <div style={s.tabs}>
        {TABS.map(t => (
          <button key={t.key} style={{ ...s.tab, ...(tab === t.key ? s.tabActive : {}) }}
            onClick={() => setTab(t.key as any)}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={s.content}>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div>
            {/* SOS */}
            <div style={s.sosCard}>
              <div>
                <h3 style={s.sosTitle}>🚨 Emergency SOS</h3>
                <p style={s.sosDesc}>Instantly alert your emergency contacts with your location.</p>
                {sosResult && <p style={{ ...s.note, color: sosResult.includes('sent') ? C.green : C.red }}>{sosResult}</p>}
              </div>
              <button style={s.sosBtn} onClick={handleSOS} disabled={sosLoading}>
                {sosLoading ? 'Sending...' : 'Send SOS'}
              </button>
            </div>

            {/* Status cards */}
            <div style={s.statusGrid}>
              <div style={s.statusCard} onClick={() => setTab('verify')}>
                <div style={{ ...s.statusDot, background: verifyColour }} />
                <div>
                  <div style={s.statusLabel}>Identity</div>
                  <div style={s.statusValue}>{verifyLabel}</div>
                </div>
              </div>
              <div style={s.statusCard} onClick={() => setTab('trips')}>
                <div style={{ ...s.statusDot, background: trips.filter((t: any) => t.safety_status === 'active').length > 0 ? C.green : C.muted }} />
                <div>
                  <div style={s.statusLabel}>Active trips</div>
                  <div style={s.statusValue}>{trips.filter((t: any) => t.safety_status === 'active').length}</div>
                </div>
              </div>
              <div style={s.statusCard} onClick={() => setTab('contacts')}>
                <div style={{ ...s.statusDot, background: contacts.length > 0 ? C.green : C.muted }} />
                <div>
                  <div style={s.statusLabel}>Emergency contacts</div>
                  <div style={s.statusValue}>{contacts.length}</div>
                </div>
              </div>
            </div>

            {/* Overdue warning */}
            {trips.some((t: any) => t.safety_status === 'overdue') && (
              <div style={s.overdueAlert}>
                ⚠ You have overdue check-ins. Go to Trips to check in now.
              </div>
            )}
          </div>
        )}

        {/* ── TRIPS ── */}
        {tab === 'trips' && (
          <div>
            <div style={s.sectionHeader}>
              <h3 style={s.sectionTitle}>Your Trips</h3>
              <button style={s.addBtn} onClick={() => setShowTripForm(true)}>+ Plan a trip</button>
            </div>

            {showTripForm && (
              <div style={s.formCard}>
                <h4 style={s.formTitle}>New Trip</h4>
                <div style={s.formGrid}>
                  <input style={s.input} placeholder="Destination *" value={tripDest} onChange={e => setTripDest(e.target.value)} />
                  <select style={s.input} value={tripRegion} onChange={e => setTripRegion(e.target.value)}>
                    <option value="">Region (optional)</option>
                    {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input style={s.input} type="date" placeholder="Start date" value={tripStart} onChange={e => setTripStart(e.target.value)} />
                  <input style={s.input} type="date" placeholder="End date" value={tripEnd} onChange={e => setTripEnd(e.target.value)} />
                </div>
                <textarea style={s.textarea} placeholder="Notes (visible to community if public)" value={tripNotes} onChange={e => setTripNotes(e.target.value)} />
                <div style={s.formFooter}>
                  <label style={s.checkboxRow}>
                    <input type="checkbox" checked={tripPublic} onChange={e => setTripPublic(e.target.checked)} />
                    <span style={{ marginLeft: 8, fontSize: 13, color: C.muted }}>Share with community (let others find you)</span>
                  </label>
                  <div style={s.formActions}>
                    <button style={s.cancelBtn} onClick={() => setShowTripForm(false)}>Cancel</button>
                    <button style={s.saveBtn} onClick={handleCreateTrip} disabled={savingTrip}>
                      {savingTrip ? 'Saving...' : 'Save trip'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {trips.length === 0 ? (
              <div style={s.empty}>
                <p style={s.emptyIcon}>✈</p>
                <p style={s.emptyTitle}>No trips planned</p>
                <p style={s.emptyDesc}>Plan a trip to enable check-ins and let the community know where you are headed.</p>
              </div>
            ) : (
              trips.map((trip: any) => {
                const statusColour = { active: C.green, overdue: C.red, completed: C.muted, planned: C.gold, escalated: C.red }[trip.safety_status] || C.muted;
                return (
                  <div key={trip.id} style={s.tripCard}>
                    <div style={s.tripHeader}>
                      <div>
                        <div style={s.tripDest}>{trip.destination}</div>
                        {trip.start_date && <div style={s.tripDates}>{trip.start_date}{trip.end_date ? ` → ${trip.end_date}` : ''}</div>}
                      </div>
                      <span style={{ ...s.statusPill, color: statusColour, borderColor: statusColour }}>
                        {trip.safety_status}
                      </span>
                    </div>
                    {trip.notes && <p style={s.tripNotes}>{trip.notes}</p>}
                    {trip.next_checkin_due && trip.safety_status === 'active' && (
                      <p style={s.nextCheckin}>Next check-in: {new Date(trip.next_checkin_due).toLocaleString()}</p>
                    )}
                    {trip.safety_status === 'overdue' && (
                      <div style={s.overdueAlert}>⚠ Check-in overdue</div>
                    )}
                    <div style={s.tripActions}>
                      {trip.safety_status === 'planned' && (
                        <button style={s.actionBtn} onClick={() => handleStartTrip(trip.id)}>Start trip</button>
                      )}
                      {['active', 'overdue'].includes(trip.safety_status) && (
                        <button style={{ ...s.actionBtn, background: C.gold, color: '#fff', borderColor: C.gold }}
                          onClick={() => handleCheckin(trip.id)}>✓ Check in</button>
                      )}
                      {['active', 'overdue'].includes(trip.safety_status) && (
                        <button style={s.actionBtnGhost} onClick={() => handleCompleteTrip(trip.id)}>Mark safe</button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── LOCATION ── */}
        {tab === 'location' && (
          <div>
            <div style={s.sectionHeader}>
              <h3 style={s.sectionTitle}>Location Tracking</h3>
            </div>

            {/* Current location card */}
            <div style={s.formCard}>
              <h4 style={s.formTitle}>Share Your Location</h4>
              <p style={s.formDesc}>Share your current location with emergency contacts and trip companions.</p>
              {geoError && <div style={s.errorMsg}>⚠ {geoError}</div>}
              <button style={{ ...s.saveBtn, width: '100%', marginBottom: 12 }} onClick={handlePostLocation} disabled={postingLocation}>
                {postingLocation ? '📍 Getting location...' : '📍 Share my location now'}
              </button>
              {currentLocation && (
                <div style={s.locationInfo}>
                  <div style={s.locDetail}>Last shared: {new Date(currentLocation.recorded_at).toLocaleString()}</div>
                  <div style={s.locDetail}>Coords: {currentLocation.latitude.toFixed(4)}, {currentLocation.longitude.toFixed(4)}</div>
                </div>
              )}
            </div>

            {/* Location history */}
            <div style={s.sectionHeader}>
              <h3 style={s.sectionTitle}>Recent Locations (last 10)</h3>
            </div>

            {locationHistory.length === 0 ? (
              <div style={s.empty}>
                <p style={s.emptyIcon}>📍</p>
                <p style={s.emptyTitle}>No location history</p>
                <p style={s.emptyDesc}>Share your location to start building a location history for your trip.</p>
              </div>
            ) : (
              <div style={s.locationList}>
                {locationHistory.map((loc: any, idx: number) => (
                  <div key={idx} style={s.locationItem}>
                    <div style={s.locTime}>{new Date(loc.recorded_at).toLocaleString()}</div>
                    <div style={s.locCoords}>
                      {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                    </div>
                    <a 
                      href={`https://maps.google.com/?q=${loc.latitude},${loc.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={s.mapLink}
                    >
                      View on map →
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CONTACTS ── */}
        {tab === 'contacts' && (
          <div>
            <div style={s.sectionHeader}>
              <h3 style={s.sectionTitle}>Emergency Contacts</h3>
              <button style={s.addBtn} onClick={() => setShowContactForm(true)}>+ Add contact</button>
            </div>

            {showContactForm && (
              <div style={s.formCard}>
                <h4 style={s.formTitle}>New Emergency Contact</h4>
                <div style={s.formGrid}>
                  <input style={s.input} placeholder="Name *" value={contactName} onChange={e => setContactName(e.target.value)} />
                  <input style={s.input} placeholder="Relationship (e.g. Partner)" value={contactRel} onChange={e => setContactRel(e.target.value)} />
                  <input style={s.input} placeholder="Email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} />
                  <input style={s.input} placeholder="Phone (+61...)" value={contactPhone} onChange={e => setContactPhone(e.target.value)} />
                </div>
                <div style={s.formActions}>
                  <button style={s.cancelBtn} onClick={() => setShowContactForm(false)}>Cancel</button>
                  <button style={s.saveBtn} onClick={handleAddContact} disabled={savingContact}>
                    {savingContact ? 'Saving...' : 'Add contact'}
                  </button>
                </div>
              </div>
            )}

            {contacts.length === 0 ? (
              <div style={s.empty}>
                <p style={s.emptyIcon}>👥</p>
                <p style={s.emptyTitle}>No emergency contacts</p>
                <p style={s.emptyDesc}>Add people who should be alerted if you trigger an SOS or miss a check-in.</p>
              </div>
            ) : (
              <div style={s.contactList}>
                {contacts.map((c: any) => (
                  <div key={c.id} style={s.contactCard}>
                    <div style={s.contactAvatar}>{c.name.charAt(0).toUpperCase()}</div>
                    <div style={{ flex: 1 }}>
                      <div style={s.contactName}>{c.name}</div>
                      <div style={s.contactDetail}>{c.email || c.phone}</div>
                      {c.relationship && <div style={s.contactRel}>{c.relationship}</div>}
                    </div>
                    <div style={s.contactBadges}>
                      {c.receives_sos && <span style={s.badgeSOS}>SOS</span>}
                      {c.can_see_location && <span style={s.badgeLoc}>Location</span>}
                    </div>
                    <button style={s.deleteBtn} onClick={() => handleDeleteContact(c.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── IDENTITY ── */}
        {tab === 'verify' && (
          <div>
            <h3 style={s.sectionTitle}>Identity Verification</h3>
            <div style={s.verifyCard}>
              <div style={{ ...s.verifyStatus, color: verifyColour }}>
                {verifyStatus === 'verified' ? '✓' : '◎'} {verifyLabel}
              </div>
              <p style={s.verifyDesc}>
                {verifyStatus === 'verified'
                  ? 'Your identity has been verified. You have access to all Drift features.'
                  : 'Verify your identity to unlock verified-only experiences, build trust with other members, and enable emergency ID.'}
              </p>
              {verifyStatus !== 'verified' && (
                <button style={s.verifyBtn} onClick={handleVerify}>
                  {verifyStatus === 'requires_input' ? 'Re-submit documents' : 'Start verification'}
                </button>
              )}
              <div style={s.trustLevels}>
                <p style={s.trustTitle}>Trust levels</p>
                {[
                  ['Email confirmed', true],
                  ['Phone confirmed', false],
                  ['ID verified', verifyStatus === 'verified'],
                  ['ID + face match', verifyStatus === 'verified'],
                  ['Community vouched', false],
                ].map(([label, done]: any) => (
                  <div key={label} style={s.trustRow}>
                    <span style={{ ...s.trustDot, background: done ? C.green : C.border }} />
                    <span style={{ color: done ? C.text : C.muted, fontSize: 14 }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { height: '100%', overflow: 'auto', background: '#f8f7f4' },
  header: { padding: '32px 32px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' },
  title: { fontSize: 26, fontWeight: 700, color: '#1A1A1A', fontFamily: "'DM Serif Display', serif" },
  subtitle: { fontSize: 14, color: '#9B9590', marginTop: 2 },

  tabs: { display: 'flex', gap: 4, padding: '20px 32px 0', borderBottom: '1px solid #F0EDE8', background: '#fff', marginTop: 16 },
  tab: { padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#9B9590', fontWeight: 500, borderBottom: '2px solid transparent', marginBottom: -1 },
  tabActive: { color: '#C9A84C', borderBottomColor: '#C9A84C', fontWeight: 600 },

  content: { padding: '24px 32px' },

  // SOS
  sosCard: { background: '#fff', borderRadius: 16, padding: 24, border: '2px solid #FFCDD2', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20 },
  sosTitle: { fontSize: 18, fontWeight: 700, color: '#C62828', marginBottom: 6 },
  sosDesc: { fontSize: 14, color: '#666' },
  sosBtn: { background: '#C62828', color: '#fff', border: 'none', padding: '14px 24px', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' as const },
  note: { fontSize: 13, marginTop: 8, fontWeight: 500 },

  // Status grid
  statusGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 },
  statusCard: { background: '#fff', borderRadius: 12, padding: '16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', border: '1px solid #F0EDE8' },
  statusDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  statusLabel: { fontSize: 11, color: '#9B9590', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  statusValue: { fontSize: 16, fontWeight: 600, color: '#1A1A1A', marginTop: 2 },

  overdueAlert: { background: '#FFEBEE', color: '#C62828', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 16 },

  // Section header
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 600, color: '#1A1A1A' },
  addBtn: { background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

  // Form
  formCard: { background: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, border: '1px solid #F0EDE8' },
  formTitle: { fontSize: 15, fontWeight: 600, color: '#1A1A1A', marginBottom: 14 },
  formDesc: { fontSize: 13, color: '#9B9590', marginBottom: 16 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 },
  input: { padding: '10px 12px', border: '1px solid #E8E4DE', borderRadius: 8, fontSize: 14, outline: 'none', background: '#f8f7f4', width: '100%', boxSizing: 'border-box' as const },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid #E8E4DE', borderRadius: 8, fontSize: 14, outline: 'none', background: '#f8f7f4', minHeight: 80, resize: 'vertical' as const, marginBottom: 12, boxSizing: 'border-box' as const },
  formFooter: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  checkboxRow: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  formActions: { display: 'flex', gap: 8 },
  cancelBtn: { padding: '8px 16px', border: '1px solid #E8E4DE', borderRadius: 8, background: 'none', fontSize: 13, cursor: 'pointer', color: '#9B9590' },
  saveBtn: { padding: '8px 16px', border: 'none', borderRadius: 8, background: '#C9A84C', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' },

  // Location
  locationInfo: { background: '#ECFDF5', borderRadius: 10, padding: 12, marginTop: 12 },
  locDetail: { fontSize: 13, color: '#10B981', lineHeight: 1.6 },
  locationList: { display: 'flex', flexDirection: 'column', gap: 8 },
  locationItem: { background: '#fff', borderRadius: 12, padding: '14px 16px', border: '1px solid #F0EDE8' },
  locTime: { fontSize: 13, fontWeight: 600, color: '#1A1A1A', marginBottom: 4 },
  locCoords: { fontSize: 12, color: '#9B9590', fontFamily: 'monospace', marginBottom: 8 },
  mapLink: { fontSize: 12, color: '#C9A84C', textDecoration: 'none', fontWeight: 500 },
  errorMsg: { background: '#FFEBEE', color: '#C62828', borderRadius: 10, padding: '10px 14px', fontSize: 13, marginBottom: 12 },

  // Trips
  tripCard: { background: '#fff', borderRadius: 14, padding: 18, marginBottom: 12, border: '1px solid #F0EDE8' },
  tripHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  tripDest: { fontSize: 17, fontWeight: 700, color: '#1A1A1A' },
  tripDates: { fontSize: 13, color: '#9B9590', marginTop: 2 },
  tripNotes: { fontSize: 14, color: '#666', lineHeight: 1.5, marginBottom: 10 },
  nextCheckin: { fontSize: 12, color: '#9B9590', marginBottom: 10 },
  statusPill: { fontSize: 11, fontWeight: 600, border: '1px solid', borderRadius: 20, padding: '3px 10px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  tripActions: { display: 'flex', gap: 8 },
  actionBtn: { padding: '8px 16px', border: '1px solid #E8E4DE', borderRadius: 8, background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#1A1A1A' },
  actionBtnGhost: { padding: '8px 16px', border: '1px solid #E8E4DE', borderRadius: 8, background: 'none', fontSize: 13, cursor: 'pointer', color: '#9B9590' },

  // Contacts
  contactList: { display: 'flex', flexDirection: 'column', gap: 8 },
  contactCard: { background: '#fff', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, border: '1px solid #F0EDE8' },
  contactAvatar: { width: 40, height: 40, borderRadius: '50%', background: '#FBF5E6', color: '#A8893A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700, flexShrink: 0 },
  contactName: { fontSize: 15, fontWeight: 600, color: '#1A1A1A' },
  contactDetail: { fontSize: 13, color: '#9B9590' },
  contactRel: { fontSize: 12, color: '#C9A84C' },
  contactBadges: { display: 'flex', gap: 6 },
  badgeSOS: { background: '#FFEBEE', color: '#C62828', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  badgeLoc: { background: '#ECFDF5', color: '#10B981', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  deleteBtn: { background: 'none', border: 'none', color: '#9B9590', cursor: 'pointer', fontSize: 16, padding: 4 },

  // Empty state
  empty: { textAlign: 'center' as const, padding: '40px 20px' },
  emptyIcon: { fontSize: 36, marginBottom: 10 },
  emptyTitle: { fontSize: 17, fontWeight: 600, color: '#1A1A1A', marginBottom: 6 },
  emptyDesc: { fontSize: 14, color: '#9B9590', lineHeight: 1.6, maxWidth: 320, margin: '0 auto' },

  // Verify
  verifyCard: { background: '#fff', borderRadius: 16, padding: 24, border: '1px solid #F0EDE8' },
  verifyStatus: { fontSize: 20, fontWeight: 700, marginBottom: 10 },
  verifyDesc: { fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 20 },
  verifyBtn: { background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', marginBottom: 24 },
  trustLevels: { borderTop: '1px solid #F0EDE8', paddingTop: 16 },
  trustTitle: { fontSize: 12, fontWeight: 600, color: '#9B9590', letterSpacing: '0.8px', textTransform: 'uppercase' as const, marginBottom: 12 },
  trustRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 },
  trustDot: { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  border: '#F0EDE8',
};
