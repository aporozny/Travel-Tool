import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
  ScrollView, Switch,
} from 'react-native';
import api from '../../services/api';

export default function AddContactScreen({ navigation }: any) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [canSeeLocation, setCanSeeLocation] = useState(true);
  const [receivesSos, setReceivesSos] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }
    if (!email.trim() && !phone.trim()) {
      Alert.alert('Error', 'Provide at least an email or phone number');
      return;
    }

    setLoading(true);
    try {
      await api.post('/safety/contacts', {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        relationship: relationship.trim() || undefined,
        can_see_location: canSeeLocation,
        receives_sos: receivesSos,
      });
      Alert.alert(
        'Contact added',
        `${name} has been added as an emergency contact.`,
        [{ text: 'OK', onPress: () => navigation.goBack() }]
      );
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Could not add contact');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Add contact</Text>
        <Text style={styles.subtitle}>This person will be notified in an emergency.</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Full name"
          placeholderTextColor="#bbb"
          value={name}
          onChangeText={setName}
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="email@example.com"
          placeholderTextColor="#bbb"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          placeholder="+61 400 000 000"
          placeholderTextColor="#bbb"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />

        <Text style={styles.label}>Relationship</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. Mother, Partner, Friend"
          placeholderTextColor="#bbb"
          value={relationship}
          onChangeText={setRelationship}
        />

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Can see my location</Text>
            <Text style={styles.toggleDesc}>They can view your location on a map</Text>
          </View>
          <Switch
            value={canSeeLocation}
            onValueChange={setCanSeeLocation}
            trackColor={{ true: '#2E7D32' }}
          />
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleInfo}>
            <Text style={styles.toggleLabel}>Receives SOS alerts</Text>
            <Text style={styles.toggleDesc}>Notified when you trigger an SOS</Text>
          </View>
          <Switch
            value={receivesSos}
            onValueChange={setReceivesSos}
            trackColor={{ true: '#C62828' }}
          />
        </View>

        <TouchableOpacity style={styles.button} onPress={handleSave} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Add contact</Text>}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f6' },
  header: { backgroundColor: '#fff', padding: 20, paddingTop: 56 },
  backText: { fontSize: 16, color: '#2E7D32', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#1a1a1a' },
  subtitle: { fontSize: 14, color: '#888', marginTop: 4 },
  form: { padding: 20 },
  label: { fontSize: 14, fontWeight: '500', color: '#555', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8e8e8',
    borderRadius: 10, padding: 14, fontSize: 16, color: '#1a1a1a',
  },
  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: { fontSize: 15, fontWeight: '500', color: '#1a1a1a' },
  toggleDesc: { fontSize: 13, color: '#999', marginTop: 2 },
  button: {
    backgroundColor: '#2E7D32', padding: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 32,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
