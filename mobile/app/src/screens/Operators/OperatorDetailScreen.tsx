import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet,
  TouchableOpacity, ActivityIndicator, Linking, Alert,
} from 'react-native';
import api from '../../services/api';
import { Operator, Review } from '../../types';

export default function OperatorDetailScreen({ route, navigation }: any) {
  const { operator: initial } = route.params as { operator: Operator };
  const [operator, setOperator] = useState<Operator>(initial);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [bookingLoading, setBookingLoading] = useState(false);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      const { data } = await api.get(`/reviews/operator/${operator.id}`);
      setReviews(data.reviews);
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch reviews', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBook = () => {
    navigation.navigate('CreateBooking', { operator });
  };

  const handleWebsite = () => {
    if (operator.website) Linking.openURL(operator.website);
  };

  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <Text key={i} style={{ color: i < rating ? '#F9A825' : '#ddd', fontSize: 16 }}>★</Text>
    ));
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.heroBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.heroContent}>
        <View style={[styles.categoryBadge, styles[`cat_${operator.category}`]]}>
          <Text style={styles.categoryBadgeText}>{operator.category}</Text>
        </View>
        <Text style={styles.name}>{operator.business_name}</Text>
        {operator.region ? <Text style={styles.location}>{operator.region}, {operator.country}</Text> : null}

        <View style={styles.ratingRow}>
          <Text style={styles.ratingScore}>
            {parseFloat(operator.avg_rating) > 0
              ? `★ ${parseFloat(operator.avg_rating).toFixed(1)}`
              : 'No reviews'}
          </Text>
          <Text style={styles.ratingCount}>({operator.review_count} reviews)</Text>
          {operator.is_verified && (
            <View style={styles.verifiedBadge}>
              <Text style={styles.verifiedText}>✓ Verified</Text>
            </View>
          )}
        </View>
      </View>

      {operator.description ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>
          <Text style={styles.description}>{operator.description}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact</Text>
        {operator.address ? <Text style={styles.contactLine}>📍  {operator.address}</Text> : null}
        {operator.phone ? <Text style={styles.contactLine}>📞  {operator.phone}</Text> : null}
        {operator.website ? (
          <TouchableOpacity onPress={handleWebsite}>
            <Text style={[styles.contactLine, styles.link]}>🌐  {operator.website}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {stats && parseInt(stats.total) > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reviews</Text>
          <View style={styles.statsRow}>
            <Text style={styles.avgBig}>{parseFloat(stats.avg_rating).toFixed(1)}</Text>
            <View style={styles.starBars}>
              {[5, 4, 3, 2, 1].map(n => (
                <View key={n} style={styles.starBarRow}>
                  <Text style={styles.starBarLabel}>{n}★</Text>
                  <View style={styles.starBarTrack}>
                    <View style={[
                      styles.starBarFill,
                      { width: `${(parseInt(stats[`${['', 'one', 'two', 'three', 'four', 'five'][n]}_star`]) / parseInt(stats.total)) * 100}%` }
                    ]} />
                  </View>
                </View>
              ))}
            </View>
          </View>

          {reviews.map(review => (
            <View key={review.id} style={styles.reviewCard}>
              <View style={styles.reviewHeader}>
                <Text style={styles.reviewerName}>{review.reviewer_name}</Text>
                <View style={styles.starsRow}>{renderStars(review.rating)}</View>
              </View>
              {review.title ? <Text style={styles.reviewTitle}>{review.title}</Text> : null}
              {review.body ? <Text style={styles.reviewBody}>{review.body}</Text> : null}
              <Text style={styles.reviewDate}>
                {new Date(review.created_at).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}
              </Text>
            </View>
          ))}
        </View>
      )}

      <View style={styles.bookingFooter}>
        <TouchableOpacity style={styles.bookBtn} onPress={handleBook} disabled={bookingLoading}>
          <Text style={styles.bookBtnText}>Book now</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f8f6' },
  heroBar: { backgroundColor: '#fff', paddingTop: 56, paddingHorizontal: 16, paddingBottom: 8 },
  backBtn: { paddingVertical: 4 },
  backText: { fontSize: 16, color: '#2E7D32' },
  heroContent: { backgroundColor: '#fff', padding: 20, paddingTop: 8, paddingBottom: 20 },
  categoryBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, marginBottom: 10 },
  cat_food: { backgroundColor: '#E8F5E9' },
  cat_accommodation: { backgroundColor: '#E3F2FD' },
  cat_activity: { backgroundColor: '#FFF8E1' },
  cat_transport: { backgroundColor: '#F3E5F5' },
  categoryBadgeText: { fontSize: 12, fontWeight: '500', color: '#444' },
  name: { fontSize: 26, fontWeight: '700', color: '#1a1a1a', marginBottom: 4 },
  location: { fontSize: 14, color: '#888', marginBottom: 12 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingScore: { fontSize: 16, color: '#F9A825', fontWeight: '600' },
  ratingCount: { fontSize: 14, color: '#999' },
  verifiedBadge: { backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  verifiedText: { fontSize: 12, color: '#2E7D32', fontWeight: '500' },
  section: { backgroundColor: '#fff', margin: 16, marginBottom: 0, borderRadius: 14, padding: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#1a1a1a', marginBottom: 12 },
  description: { fontSize: 15, color: '#444', lineHeight: 22 },
  contactLine: { fontSize: 14, color: '#444', marginBottom: 8 },
  link: { color: '#2E7D32' },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 16 },
  avgBig: { fontSize: 48, fontWeight: '700', color: '#1a1a1a' },
  starBars: { flex: 1 },
  starBarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, gap: 6 },
  starBarLabel: { fontSize: 11, color: '#999', width: 20 },
  starBarTrack: { flex: 1, height: 6, backgroundColor: '#f0f0f0', borderRadius: 3 },
  starBarFill: { height: 6, backgroundColor: '#F9A825', borderRadius: 3 },
  reviewCard: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  reviewerName: { fontSize: 14, fontWeight: '600', color: '#1a1a1a' },
  starsRow: { flexDirection: 'row' },
  reviewTitle: { fontSize: 14, fontWeight: '500', color: '#1a1a1a', marginBottom: 4 },
  reviewBody: { fontSize: 14, color: '#555', lineHeight: 20, marginBottom: 6 },
  reviewDate: { fontSize: 12, color: '#bbb' },
  bookingFooter: { padding: 20, paddingBottom: 40 },
  bookBtn: {
    backgroundColor: '#2E7D32', padding: 16, borderRadius: 14,
    alignItems: 'center',
    shadowColor: '#2E7D32', shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  bookBtnText: { color: '#fff', fontSize: 17, fontWeight: '600' },
});
