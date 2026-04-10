import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import api from '../../services/api';
import { Booking } from '../../types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#FFF8E1',
  confirmed: '#E8F5E9',
  cancelled: '#FFEBEE',
  completed: '#E3F2FD',
};

const STATUS_TEXT: Record<string, string> = {
  pending: '#F57F17',
  confirmed: '#2E7D32',
  cancelled: '#C62828',
  completed: '#1565C0',
};

export default function BookingsScreen({ navigation }: any) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchBookings = async () => {
    try {
      const { data } = await api.get('/bookings');
      setBookings(data);
    } catch (err) {
      console.error('Failed to fetch bookings', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(useCallback(() => { fetchBookings(); }, []));

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Bookings</Text>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchBookings(); }} />}>
        {loading ? (
          <ActivityIndicator style={{ marginTop: 60 }} color="#2E7D32" />
        ) : bookings.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyTitle}>No bookings yet</Text>
            <Text style={styles.emptyDesc}>Browse operators and make your first booking.</Text>
          </View>
        ) : (
          bookings.map(booking => (
            <TouchableOpacity
              key={booking.id}
              style={styles.card}
              onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })}>
              <View style={styles.cardTop}>
                <Text style={styles.businessName}>{booking.business_name}</Text>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[booking.status] }]}>
                  <Text style={[styles.statusText, { color: STATUS_TEXT[booking.status] }]}>
                    {booking.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.dateRange}>
                {formatDate(booking.start_date)}
                {booking.end_date ? ` → ${formatDate(booking.end_date)}` : ''}
              </Text>
              <View style={styles.cardBottom}>
                <Text style={styles.guests}>{booking.guests} guest{booking.guests !== 1 ? 's' : ''}</Text>
                {booking.total_amount ? (
                  <Text style={styles.amount}>
                    {booking.currency} {parseFloat(booking.total_amount).toFixed(2)}
                  </Text>
                ) : null}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f6' },
  header: { padding: 20, paddingTop: 60, backgroundColor: '#fff', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#1a1a1a', marginBottom: 8 },
  emptyDesc: { fontSize: 14, color: '#999', textAlign: 'center', lineHeight: 20 },
  card: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  businessName: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', flex: 1, marginRight: 8 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '600' },
  dateRange: { fontSize: 14, color: '#555', marginBottom: 10 },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between' },
  guests: { fontSize: 13, color: '#999' },
  amount: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
});
