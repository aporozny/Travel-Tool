import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, Alert, ActivityIndicator,
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import api from '../../services/api';
import { SafetyContact } from '../../types';

export default function SafetyScreen() {
  const [contacts, setContacts] = useState<SafetyContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [sosLoading, setSosLoading] = useState(false);
  const [trackingActive, setTrackingActive] = useState(false);

  useEffect(() => {
    fetchContacts();
  }, []);

  const fetchContacts = async () => {
    try {
      const { data } = await api.get('/safety/contacts');
      setContacts(data);
    } catch (err) {
      console.error('Failed to fetch contacts', err);
    } finally {
      setLoading(false);
    }
  };

  const shareLocation = async () => {
    Geolocation.getCurrentPosition(
      async position => {
        try {
          await api.post('/safety/location', {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Math.floor(position.timestamp / 1000),
          });
          setTrackingActive(true);
          Alert.alert('Location shared', 'Your location has been updated.');
        } catch (err) {
          Alert.alert('Error', 'Could not share location.');
        }
      },
      error => Alert.alert('Location error', error.message),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const triggerSOS = () => {
    Alert.alert(
      'Send SOS Alert',
      `This will notify ${contacts.filter(c => c.receives_sos).length} emergency contact(s) with your current location.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS', style: 'destructive',
          onPress: async () => {
            setSosLoading(true);
            try {
              const { data } = await api.post('/safety/sos', { message: 'SOS triggered from app' });
              Alert.alert(
                'SOS Sent',
                `${data.contacts_notified} contact(s) have been notified.`
              );
            } catch (err) {
              Alert.alert('Error', 'Could not send SOS.');
            } finally {
              setSosLoading(false);
            }
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Safety</Text>
      </View>

      <TouchableOpacity style={styles.sosButton} onPress={triggerSOS} disabled={sosLoading}>
        {sosLoading
          ? <ActivityIndicator color="#fff" size="large" />
          : <>
              <Text style={styles.sosButtonText}>SOS</Text>
              <Text style={styles.sosButtonSub}>Hold to alert contacts</Text>
            </>}
      </TouchableOpacity>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Location tracking</Text>
          <TouchableOpacity style={styles.trackBtn} onPress={shareLocation}>
            <Text style={styles.trackBtnText}>{trackingActive ? 'Update' : 'Share'}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.trackDesc}>
          {trackingActive
            ? 'Your location is being shared with emergency contacts.'
            : 'Share your location with emergency contacts.'}
        </Text>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Emergency contacts</Text>
        </View>
        {loading ? (
          <ActivityIndicator color="#2E7D32" />
        ) : contacts.length === 0 ? (
          <Text style={styles.emptyText}>No emergency contacts added yet.</Text>
        ) : (
          contacts.map(contact => (
            <View key={contact.id} style={styles.contactCard}>
              <View style={styles.contactAvatar}>
                <Text style={styles.contactAvatarText}>
                  {contact.name.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName}>{contact.name}</Text>
                <Text style={styles.contactDetail}>{contact.email || contact.phone}</Text>
                <Text style={styles.contactRelation}>{contact.relationship}</Text>
              </View>
              <View style={styles.contactBadges}>
                {contact.receives_sos && (
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>SOS</Text>
                  </View>
                )}
                {contact.can_see_location && (
                  <View style={[styles.badge, styles.badgeLocation]}>
                    <Text style={styles.badgeText}>Location</Text>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f6' },
  header: { padding: 20, paddingTop: 60, backgroundColor: '#fff' },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  sosButton: {
    backgroundColor: '#C62828', margin: 20, borderRadius: 20,
    padding: 40, alignItems: 'center',
    shadowColor: '#C62828', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
  },
  sosButtonText: { fontSize: 48, fontWeight: '800', color: '#fff', letterSpacing: 4 },
  sosButtonSub: { fontSize: 13, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 14, padding: 16 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a' },
  trackBtn: { backgroundColor: '#E8F5E9', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  trackBtnText: { fontSize: 14, color: '#2E7D32', fontWeight: '500' },
  trackDesc: { fontSize: 14, color: '#666' },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 16 },
  contactCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  contactAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2E7D32', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  contactAvatarText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  contactDetail: { fontSize: 13, color: '#666' },
  contactRelation: { fontSize: 12, color: '#999' },
  contactBadges: { flexDirection: 'row', gap: 4 },
  badge: { backgroundColor: '#FFCDD2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeLocation: { backgroundColor: '#E8F5E9' },
  badgeText: { fontSize: 10, fontWeight: '500', color: '#444' },
});
