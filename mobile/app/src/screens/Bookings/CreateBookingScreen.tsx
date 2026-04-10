import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TextInput,
  TouchableOpacity, Alert, ActivityIndicator,
  ScrollView, Platform,
} from 'react-native';
import api from '../../services/api';
import { Operator } from '../../types';

export default function CreateBookingScreen({ route, navigation }: any) {
  const { operator } = route.params as { operator: Operator };
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [guests, setGuests] = useState('1');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const validateDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

  const handleBook = async () => {
    if (!validateDate(startDate)) {
      Alert.alert('Error', 'Enter start date as YYYY-MM-DD');
      return;
    }
    if (endDate && !validateDate(endDate)) {
      Alert.alert('Error', 'Enter end date as YYYY-MM-DD');
      return;
    }
    const g = parseInt(guests);
    if (isNaN(g) || g < 1) {
      Alert.alert('Error', 'Guests must be at least 1');
      return;
    }

    setLoading(true);
    try {
      await api.post('/bookings', {
        operator_id: operator.id,
        start_date: startDate,
        end_date: endDate || undefined,
        guests: g,
        notes: notes.trim() || undefined,
      });
      Alert.alert(
        'Booking requested',
        `Your booking at ${operator.business_name} has been submitted. The operator will confirm shortly.`,
        [{ text: 'OK', onPress: () => navigation.navigate('Bookings') }]
      );
    } catch (err: any) {
      Alert.alert('Error', err.response?.data?.message || 'Could not create booking');
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
        <Text style={styles.title}>Book</Text>
        <Text style={styles.subtitle}>{operator.business_name}</Text>
      </View>

      <View style={styles.form}>
        <Text style={styles.label}>Start date</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#bbb"
          value={startDate}
          onChangeText={setStartDate}
          maxLength={10}
        />

        <Text style={styles.label}>End date (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#bbb"
          value={endDate}
          onChangeText={setEndDate}
          maxLength={10}
        />

        <Text style={styles.label}>Guests</Text>
        <TextInput
          style={styles.input}
          placeholder="1"
          placeholderTextColor="#bbb"
          keyboardType="number-pad"
          value={guests}
          onChangeText={setGuests}
          maxLength={2}
        />

        <Text style={styles.label}>Notes (optional)</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="Any special requests or details..."
          placeholderTextColor="#bbb"
          multiline
          numberOfLines={4}
          value={notes}
          onChangeText={setNotes}
        />

        <TouchableOpacity style={styles.button} onPress={handleBook} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Request booking</Text>}
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
  subtitle: { fontSize: 16, color: '#666', marginTop: 4 },
  form: { padding: 20 },
  label: { fontSize: 14, fontWeight: '500', color: '#555', marginBottom: 6, marginTop: 16 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e8e8e8',
    borderRadius: 10, padding: 14, fontSize: 16, color: '#1a1a1a',
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  button: {
    backgroundColor: '#2E7D32', padding: 16, borderRadius: 14,
    alignItems: 'center', marginTop: 32,
  },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
