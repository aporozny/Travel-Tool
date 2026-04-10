import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { RootState, AppDispatch } from '../../store';
import { logout } from '../../store/authSlice';
import api from '../../services/api';
import { Operator } from '../../types';

export default function HomeScreen({ navigation }: any) {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((s: RootState) => s.auth);
  const [operators, setOperators] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchOperators = async () => {
    try {
      const { data } = await api.get('/operators?region=Nusa+Penida');
      setOperators(data);
    } catch (err) {
      console.error('Failed to fetch operators', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchOperators(); }, []);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchOperators(); }} />}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
        <TouchableOpacity onPress={() => dispatch(logout())}>
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionTitle}>Discover Nusa Penida</Text>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color="#2E7D32" />
      ) : (
        operators.map(op => (
          <TouchableOpacity
            key={op.id}
            style={styles.card}
            onPress={() => navigation.navigate('OperatorDetail', { operator: op })}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>{op.business_name}</Text>
              <View style={[styles.badge, styles[`badge_${op.category}`]]}>
                <Text style={styles.badgeText}>{op.category}</Text>
              </View>
            </View>
            {op.description ? (
              <Text style={styles.cardDesc} numberOfLines={2}>{op.description}</Text>
            ) : null}
            <View style={styles.cardFooter}>
              <Text style={styles.rating}>
                {parseFloat(op.avg_rating) > 0 ? `★ ${parseFloat(op.avg_rating).toFixed(1)}` : 'No reviews yet'}
              </Text>
              {op.region ? <Text style={styles.region}>{op.region}</Text> : null}
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const categoryColors: Record<string, string> = {
  food: '#E8F5E9', accommodation: '#E3F2FD',
  activity: '#FFF8E1', transport: '#F3E5F5',
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f6' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 60, backgroundColor: '#fff',
  },
  greeting: { fontSize: 13, color: '#999' },
  email: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  logoutText: { fontSize: 14, color: '#999' },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: '#1a1a1a', padding: 20, paddingBottom: 12 },
  card: {
    backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12,
    borderRadius: 14, padding: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', flex: 1, marginRight: 8 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badge_food: { backgroundColor: '#E8F5E9' },
  badge_accommodation: { backgroundColor: '#E3F2FD' },
  badge_activity: { backgroundColor: '#FFF8E1' },
  badge_transport: { backgroundColor: '#F3E5F5' },
  badgeText: { fontSize: 11, fontWeight: '500', color: '#444' },
  cardDesc: { fontSize: 14, color: '#666', lineHeight: 20, marginBottom: 10 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between' },
  rating: { fontSize: 13, color: '#F9A825', fontWeight: '500' },
  region: { fontSize: 13, color: '#999' },
});
