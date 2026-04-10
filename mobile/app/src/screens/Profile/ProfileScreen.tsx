import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TextInput, TouchableOpacity, Alert,
  ActivityIndicator, Switch,
} from 'react-native';
import { useDispatch } from 'react-redux';
import { logout } from '../../store/authSlice';
import { AppDispatch } from '../../store';
import api from '../../services/api';
import { TravelerProfile, TravelerPreferences } from '../../types';

const ACTIVITY_OPTIONS = ['Diving', 'Surfing', 'Hiking', 'Cultural', 'Food', 'Nightlife', 'Wellness', 'Snorkeling'];
const STYLE_OPTIONS = ['Solo', 'Couple', 'Group', 'Family', 'Backpacker', 'Luxury'];
const BUDGET_OPTIONS = ['budget', 'mid', 'luxury'] as const;

export default function ProfileScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const [profile, setProfile] = useState<TravelerProfile | null>(null);
  const [prefs, setPrefs] = useState<TravelerPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [bio, setBio] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => { fetchProfile(); }, []);

  const fetchProfile = async () => {
    try {
      const [profileRes, prefsRes] = await Promise.all([
        api.get('/travelers/me'),
        api.get('/travelers/me/preferences'),
      ]);
      setProfile(profileRes.data);
      setPrefs(prefsRes.data);
      setFirstName(profileRes.data.first_name || '');
      setLastName(profileRes.data.last_name || '');
      setBio(profileRes.data.bio || '');
      setPhone(profileRes.data.phone || '');
    } catch (err) {
      console.error('Failed to fetch profile', err);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    setSaving(true);
    try {
      const { data } = await api.patch('/travelers/me', {
        first_name: firstName.trim() || undefined,
        last_name: lastName.trim() || undefined,
        bio: bio.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      setProfile(prev => prev ? { ...prev, ...data } : data);
      setEditing(false);
      Alert.alert('Saved', 'Profile updated.');
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  const toggleActivity = async (activity: string) => {
    if (!prefs) return;
    const current = prefs.activity_types || [];
    const updated = current.includes(activity.toLowerCase())
      ? current.filter(a => a !== activity.toLowerCase())
      : [...current, activity.toLowerCase()];
    const newPrefs = { ...prefs, activity_types: updated };
    setPrefs(newPrefs);
    await api.put('/travelers/me/preferences', newPrefs);
  };

  const toggleStyle = async (style: string) => {
    if (!prefs) return;
    const current = prefs.travel_style || [];
    const updated = current.includes(style.toLowerCase())
      ? current.filter(s => s !== style.toLowerCase())
      : [...current, style.toLowerCase()];
    const newPrefs = { ...prefs, travel_style: updated };
    setPrefs(newPrefs);
    await api.put('/travelers/me/preferences', newPrefs);
  };

  const setBudget = async (budget: 'budget' | 'mid' | 'luxury') => {
    if (!prefs) return;
    const newPrefs = { ...prefs, budget_range: budget };
    setPrefs(newPrefs);
    await api.put('/travelers/me/preferences', newPrefs);
  };

  if (loading) {
    return <ActivityIndicator style={{ flex: 1, marginTop: 100 }} color="#2E7D32" />;
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
        <TouchableOpacity onPress={() => editing ? saveProfile() : setEditing(true)} disabled={saving}>
          {saving
            ? <ActivityIndicator color="#2E7D32" />
            : <Text style={styles.editBtn}>{editing ? 'Save' : 'Edit'}</Text>}
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(firstName || profile?.email || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text style={styles.email}>{profile?.email}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Personal info</Text>
        <View style={styles.fieldRow}>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>First name</Text>
            <TextInput
              style={[styles.input, !editing && styles.inputDisabled]}
              value={firstName}
              onChangeText={setFirstName}
              editable={editing}
              placeholder="First name"
              placeholderTextColor="#bbb"
            />
          </View>
          <View style={styles.fieldHalf}>
            <Text style={styles.fieldLabel}>Last name</Text>
            <TextInput
              style={[styles.input, !editing && styles.inputDisabled]}
              value={lastName}
              onChangeText={setLastName}
              editable={editing}
              placeholder="Last name"
              placeholderTextColor="#bbb"
            />
          </View>
        </View>

        <Text style={styles.fieldLabel}>Phone</Text>
        <TextInput
          style={[styles.input, !editing && styles.inputDisabled]}
          value={phone}
          onChangeText={setPhone}
          editable={editing}
          placeholder="+61 400 000 000"
          placeholderTextColor="#bbb"
          keyboardType="phone-pad"
        />

        <Text style={styles.fieldLabel}>Bio</Text>
        <TextInput
          style={[styles.input, styles.textArea, !editing && styles.inputDisabled]}
          value={bio}
          onChangeText={setBio}
          editable={editing}
          placeholder="Tell us about yourself..."
          placeholderTextColor="#bbb"
          multiline
          numberOfLines={3}
        />
      </View>

      {prefs && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Budget</Text>
            <View style={styles.chipRow}>
              {BUDGET_OPTIONS.map(b => (
                <TouchableOpacity
                  key={b}
                  style={[styles.chip, prefs.budget_range === b && styles.chipActive]}
                  onPress={() => setBudget(b)}>
                  <Text style={[styles.chipText, prefs.budget_range === b && styles.chipTextActive]}>
                    {b.charAt(0).toUpperCase() + b.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Activities</Text>
            <View style={styles.chipRow}>
              {ACTIVITY_OPTIONS.map(a => {
                const active = (prefs.activity_types || []).includes(a.toLowerCase());
                return (
                  <TouchableOpacity
                    key={a}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => toggleActivity(a)}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{a}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Travel style</Text>
            <View style={styles.chipRow}>
              {STYLE_OPTIONS.map(s => {
                const active = (prefs.travel_style || []).includes(s.toLowerCase());
                return (
                  <TouchableOpacity
                    key={s}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => toggleStyle(s)}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{s}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </>
      )}

      <View style={styles.section}>
        <TouchableOpacity style={styles.logoutBtn} onPress={() => dispatch(logout())}>
          <Text style={styles.logoutBtnText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f6' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, paddingTop: 60, backgroundColor: '#fff',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  editBtn: { fontSize: 16, color: '#2E7D32', fontWeight: '500' },
  section: { backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 14, padding: 16 },
  avatar: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#2E7D32',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 8,
  },
  avatarText: { fontSize: 32, color: '#fff', fontWeight: '600' },
  email: { textAlign: 'center', fontSize: 14, color: '#888' },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#1a1a1a', marginBottom: 14 },
  fieldRow: { flexDirection: 'row', gap: 12 },
  fieldHalf: { flex: 1 },
  fieldLabel: { fontSize: 12, color: '#888', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1, borderColor: '#e8e8e8', borderRadius: 10,
    padding: 12, fontSize: 15, color: '#1a1a1a',
  },
  inputDisabled: { backgroundColor: '#fafafa', borderColor: '#f0f0f0', color: '#666' },
  textArea: { height: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e8e8e8',
  },
  chipActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  chipText: { fontSize: 13, color: '#555' },
  chipTextActive: { color: '#fff', fontWeight: '500' },
  logoutBtn: {
    padding: 14, borderRadius: 10, borderWidth: 1,
    borderColor: '#ffcdd2', alignItems: 'center',
  },
  logoutBtnText: { fontSize: 15, color: '#C62828', fontWeight: '500' },
});
