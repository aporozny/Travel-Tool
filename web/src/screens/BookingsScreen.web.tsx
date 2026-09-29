import React, { useState } from 'react';
import { TravelBookings } from './TravelBookings.web';
import { OperatorBookings } from './OperatorBookings.web';
import { TripUpdates } from './TripUpdates.web';
import PendingFlightPayments from './PendingFlightPayments.web';

export default function BookingsScreen() {
  // Both sections load themselves; null until each has (used only to size the empty state).
  const [travelCount, setTravelCount] = useState<number | null>(null);
  const [operatorCount, setOperatorCount] = useState<number | null>(null);

  const stillLoading = travelCount === null || operatorCount === null;
  const nothingBooked = !stillLoading && travelCount === 0 && operatorCount === 0;

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Bookings</h2>
      <PendingFlightPayments />
      <TripUpdates />
      <TravelBookings onLoaded={setTravelCount} />
      <OperatorBookings onLoaded={setOperatorCount} />
      {stillLoading ? (
        <p style={styles.empty}>Loading...</p>
      ) : nothingBooked ? (
        <div style={styles.emptyBox}>
          <p style={{ fontSize: 40, marginBottom: 12 }}>📋</p>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#1a1a1a' }}>No bookings yet</p>
          <p style={{ fontSize: 14, color: '#999', marginTop: 6 }}>Browse operators and make your first booking.</p>
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: 32 },
  title: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', marginBottom: 24 },
  empty: { color: '#999', padding: 40, textAlign: 'center' },
  emptyBox: { textAlign: 'center', padding: 80 },
};
