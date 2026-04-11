import React, { useEffect, useState } from 'react';
import api from '../services/api.web';
import { SafetyContact } from '@/types';

export default function SafetyScreen() {
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [sosLoading, setSosLoading] = useState(false);
  const [sosResult, setSosResult] = useState<string | null>(null);

  useEffect(() => {
    api.get('/safety/contacts')
      .then(r => setContacts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleSOS = async () => {
    if (!window.confirm(`Send SOS alert to ${contacts.filter(c => c.receives_sos).length} emergency contact(s)?`)) return;
    setSosLoading(true);
    try {
      const { data } = await api.post('/safety/sos', { message: 'SOS triggered from web' });
      setSosResult(`SOS sent. ${data.contacts_notified} contact(s) notified.`);
    } catch {
      setSosResult('Could not send SOS. Please try again.');
    } finally {
      setSosLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Safety</h2>

      <div style={styles.sosCard}>
        <div>
          <h3 style={styles.sosTitle}>Emergency SOS</h3>
          <p style={styles.sosDesc}>Instantly alert your emergency contacts with your current status.</p>
          {sosResult && <p style={styles.sosResult}>{sosResult}</p>}
        </div>
        <button style={styles.sosBtn} onClick={handleSOS} disabled={sosLoading}>
          {sosLoading ? 'Sending...' : '🚨 Send SOS'}
        </button>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Emergency contacts</h3>
        {loading ? (
          <p style={styles.empty}>Loading...</p>
        ) : contacts.length === 0 ? (
          <p style={styles.empty}>No emergency contacts added. Add contacts from the mobile app.</p>
        ) : (
          <div style={styles.contactList}>
            {contacts.map(c => (
              <div key={c.id} style={styles.contactCard}>
                <div style={styles.avatar}>{c.name.charAt(0).toUpperCase()}</div>
                <div style={styles.contactInfo}>
                  <strong style={styles.contactName}>{c.name}</strong>
                  <span style={styles.contactDetail}>{c.email || c.phone}</span>
                  {c.relationship && <span style={styles.contactRelation}>{c.relationship}</span>}
                </div>
                <div style={styles.badges}>
                  {c.receives_sos && <span style={styles.badgeSOS}>SOS</span>}
                  {c.can_see_location && <span style={styles.badgeLoc}>Location</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32, maxWidth: 720 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', marginBottom: 24 },
  sosCard: {
    background: '#fff', borderRadius: 16, padding: 24,
    border: '2px solid #ffcdd2', marginBottom: 24,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20,
  },
  sosTitle: { fontSize: 18, fontWeight: 700, color: '#C62828', marginBottom: 6 },
  sosDesc: { fontSize: 14, color: '#666' },
  sosResult: { fontSize: 13, color: '#2E7D32', marginTop: 8, fontWeight: 500 },
  sosBtn: {
    background: '#C62828', color: '#fff', border: 'none',
    padding: '14px 24px', borderRadius: 12, fontSize: 16,
    fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  section: { background: '#fff', borderRadius: 16, padding: 24 },
  sectionTitle: { fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginBottom: 16 },
  contactList: { display: 'flex', flexDirection: 'column', gap: 12 },
  contactCard: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '12px 0', borderBottom: '1px solid #f5f5f5',
  },
  avatar: {
    width: 44, height: 44, borderRadius: 22, background: '#2E7D32',
    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, fontWeight: 600, flexShrink: 0,
  },
  contactInfo: { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  contactName: { fontSize: 15, color: '#1a1a1a' },
  contactDetail: { fontSize: 13, color: '#666' },
  contactRelation: { fontSize: 12, color: '#aaa' },
  badges: { display: 'flex', gap: 6 },
  badgeSOS: { background: '#FFEBEE', color: '#C62828', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  badgeLoc: { background: '#E8F5E9', color: '#2E7D32', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 },
  empty: { color: '#999', fontSize: 14, padding: '20px 0' },
};
