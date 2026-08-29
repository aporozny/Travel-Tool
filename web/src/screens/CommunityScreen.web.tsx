import React, { useState, useEffect, useRef } from 'react';
import { WhosGoingPanel } from './WhosGoingPanel';
import api from '../services/api.web';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  bg:        '#f8f7f4',
  white:     '#FFFFFF',
  border:    '#F0EDE8',
  text:      '#1A1A1A',
  muted:     '#9B9590',
  soft:      '#F5F3EF',
};

const REACTIONS = [
  { key: 'like',  emoji: '👍', label: 'Like' },
  { key: 'fire',  emoji: '🔥', label: 'Fire' },
  { key: 'heart', emoji: '❤️',  label: 'Heart' },
  { key: 'wave',  emoji: '🌊', label: 'Wave' },
];

const REGIONS = [
  'Seminyak', 'Canggu', 'Ubud', 'Uluwatu', 'Nusa Penida',
  'Amed', 'Tulamben', 'Lovina', 'Kuta', 'Sanur', 'Jimbaran',
  'Nusa Dua', 'Candidasa', 'Munduk', 'Sidemen',
];

const PLACE_CATEGORIES = [
  { key: 'food', label: 'Food & drink' },
  { key: 'accommodation', label: 'Accommodation' },
  { key: 'activity', label: 'Activity' },
  { key: 'transport', label: 'Transport' },
];

interface Post {
  id: string;
  body: string;
  region: string;
  reaction_count: number;
  comment_count: number;
  created_at: string;
  author_type: string;
  author_id: string;
  display_name: string;
  avatar_url: string | null;
  media: string[];
  my_reaction: string | null;
  place_name: string | null;
}

export default function CommunityScreen() {
  const [mode, setMode] = useState<'feed' | 'discover'>('discover');
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [commentPost, setCommentPost] = useState<string | null>(null);

  useEffect(() => {
    loadPosts();
  }, [mode]);

  const loadPosts = async () => {
    setLoading(true);
    try {
      const endpoint = mode === 'feed' ? '/community/feed' : '/community/discover';
      const res = await api.get(endpoint);
      setPosts(res.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleReact = async (postId: string, reaction: string) => {
    try {
      await api.post(`/community/posts/${postId}/react`, { reaction });
      loadPosts();
    } catch (e) {
      console.error(e);
    }
  };

  const handlePostCreated = () => {
    setComposing(false);
    loadPosts();
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>Community</h1>
          {/* Honest label: the default feed shows posts from your
              connections and yourself, not a Bali-specific feed --
              was hardcoded, same staleness pattern as the old Explore
              destination pills. */}
          <p style={styles.subtitle}>What's happening in your network</p>
        </div>
        <button style={styles.composeBtn} onClick={() => setComposing(true)}>
          + Post
        </button>
      </div>

      {/* Toggle */}
      <div style={styles.toggle}>
        <button
          style={{ ...styles.toggleBtn, ...(mode === 'discover' ? styles.toggleActive : {}) }}
          onClick={() => setMode('discover')}
        >
          Discover
        </button>
        <button
          style={{ ...styles.toggleBtn, ...(mode === 'feed' ? styles.toggleActive : {}) }}
          onClick={() => setMode('feed')}
        >
          Following
        </button>
      </div>

      {/* Who is going */}
      <div style={{ padding: "0 32px" }}>
        <WhosGoingPanel />
      </div>

      {/* Who is going */}
      <div style={{ padding: "0 32px" }}>
      </div>

      {/* Who is going */}
      <div style={{ padding: "0 32px" }}>
      </div>

      {/* Feed */}
      <div style={styles.feed}>
        {loading ? (
          <div style={styles.loading}>
            <div style={styles.loadingDot} />
          </div>
        ) : posts.length === 0 ? (
          <div style={styles.empty}>
            <p style={styles.emptyIcon}>◈</p>
            <p style={styles.emptyTitle}>Nothing here yet</p>
            <p style={styles.emptyDesc}>
              {mode === 'feed'
                ? 'Connect with other members to see their posts here.'
                : 'Be the first to post something.'}
            </p>
          </div>
        ) : (
          posts.map(post => (
            <PostCard
              key={post.id}
              post={post}
              onReact={handleReact}
              onComment={() => setCommentPost(post.id)}
            />
          ))
        )}
      </div>

      {/* Compose Modal */}
      {composing && (
        <ComposeModal
          onClose={() => setComposing(false)}
          onPosted={handlePostCreated}
        />
      )}

      {/* Comments Modal */}
      {commentPost && (
        <CommentsModal
          postId={commentPost}
          onClose={() => setCommentPost(null)}
        />
      )}
    </div>
  );
}

// ─── Post Card ────────────────────────────────────────────────────────────────

function PostCard({ post, onReact, onComment }: {
  post: Post;
  onReact: (id: string, reaction: string) => void;
  onComment: () => void;
}) {
  const initials = (post.display_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
  const timeAgo = formatTimeAgo(post.created_at);

  return (
    <div style={styles.card}>
      {/* Author row */}
      <div style={styles.cardHeader}>
        <div style={styles.avatar}>{initials}</div>
        <div style={{ flex: 1 }}>
          <div style={styles.authorName}>{post.display_name || 'Drift Member'}</div>
          <div style={styles.meta}>
            {post.region && (
              <span style={styles.regionPill}>{post.region}</span>
            )}
            <span style={styles.time}>{timeAgo}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      {post.body && (
        <p style={styles.cardBody}>{post.body}</p>
      )}

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div style={styles.mediaGrid}>
          {post.media.slice(0, 3).map((url: string, i: number) => (
            <img
              key={i}
              src={url}
              style={{
                ...styles.mediaImg,
                ...(post.media.length === 1 ? styles.mediaImgFull : {}),
              }}
              alt=""
            />
          ))}
        </div>
      )}

      {/* Place tag */}
      {post.place_name && (
        <div style={styles.placeTag}>
          <span style={{ marginRight: 4 }}>◎</span>
          {post.place_name}
        </div>
      )}

      {/* Reactions */}
      <div style={styles.cardFooter}>
        <div style={styles.reactions}>
          {REACTIONS.map(r => (
            <button
              key={r.key}
              style={{
                ...styles.reactionBtn,
                ...(post.my_reaction === r.key ? styles.reactionActive : {}),
              }}
              onClick={() => onReact(post.id, r.key)}
              title={r.label}
            >
              {r.emoji}
            </button>
          ))}
          {post.reaction_count > 0 && (
            <span style={styles.reactionCount}>{post.reaction_count}</span>
          )}
        </div>

        <button style={styles.commentBtn} onClick={onComment}>
          <span style={{ marginRight: 4 }}>◇</span>
          {post.comment_count > 0 ? post.comment_count : 'Comment'}
        </button>
      </div>
    </div>
  );
}

// ─── Compose Modal ────────────────────────────────────────────────────────────

interface PlaceSearchResult {
  id: string;
  name: string;
  category: string;
  region: string;
}

interface GeocodedPoint {
  latitude: number;
  longitude: number;
  name: string;
  country: string;
}

function ComposeModal({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [region, setRegion] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Place tagging -- pick an existing catalog place, or add one the
  // catalog doesn't have yet (member-sourced places, Stage 13).
  const [placeQuery, setPlaceQuery] = useState('');
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<PlaceSearchResult | null>(null);
  const placeSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showAddPlace, setShowAddPlace] = useState(false);
  const [newPlaceName, setNewPlaceName] = useState('');
  const [newPlaceCategory, setNewPlaceCategory] = useState('activity');
  const [newPlaceAddress, setNewPlaceAddress] = useState('');
  const [geocoding, setGeocoding] = useState(false);
  const [geocodedPoint, setGeocodedPoint] = useState<GeocodedPoint | null>(null);
  const [geocodeError, setGeocodeError] = useState<string | null>(null);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.slice(0, 5 - images.length).forEach(file => {
      const reader = new FileReader();
      reader.onload = async (ev) => {
        const base64 = (ev.target?.result as string).split(',')[1];
        try {
          const res = await api.post('/community/upload', {
            data: base64,
            mimeType: file.type,
          });
          setImages(prev => [...prev, res.data.url]);
        } catch (e) {
          console.error('Upload failed', e);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePlaceQueryChange = (value: string) => {
    setPlaceQuery(value);
    if (placeSearchTimer.current) clearTimeout(placeSearchTimer.current);
    if (!value.trim()) {
      setPlaceResults([]);
      return;
    }
    placeSearchTimer.current = setTimeout(async () => {
      setSearchingPlace(true);
      try {
        const params: any = { q: value.trim(), limit: 6 };
        if (region) params.region = region;
        const res = await api.get('/search', { params });
        setPlaceResults(res.data?.results || []);
      } catch (e) {
        console.error(e);
      } finally {
        setSearchingPlace(false);
      }
    }, 350);
  };

  const handleSelectPlace = (place: PlaceSearchResult) => {
    setSelectedPlace(place);
    setPlaceQuery('');
    setPlaceResults([]);
    setShowAddPlace(false);
  };

  const handleGeocodeAddress = async () => {
    if (!newPlaceAddress.trim()) return;
    setGeocoding(true);
    setGeocodeError(null);
    setGeocodedPoint(null);
    try {
      const res = await api.get('/search/geocode', { params: { address: newPlaceAddress.trim() } });
      setGeocodedPoint(res.data);
    } catch (e) {
      setGeocodeError("Couldn't find that location. Try a more specific address.");
    } finally {
      setGeocoding(false);
    }
  };

  const clearPlace = () => {
    setSelectedPlace(null);
    setShowAddPlace(false);
    setNewPlaceName('');
    setNewPlaceAddress('');
    setGeocodedPoint(null);
    setGeocodeError(null);
  };

  const handleSubmit = async () => {
    if (!body.trim() && images.length === 0) return;
    setSubmitting(true);
    try {
      const payload: any = {
        body: body.trim() || undefined,
        region: region || undefined,
        mediaUrls: images,
        visibility: 'public',
      };
      if (selectedPlace) {
        payload.placeId = selectedPlace.id;
      } else if (newPlaceName.trim() && geocodedPoint) {
        payload.newPlace = {
          name: newPlaceName.trim(),
          lat: geocodedPoint.latitude,
          lng: geocodedPoint.longitude,
          category: newPlaceCategory,
        };
      }
      await api.post('/community/posts', payload);
      onPosted();
    } catch (e: any) {
      const message = e.response?.data?.message;
      if (e.response?.status === 429) {
        alert(message || "You've added a lot of new places today -- try again tomorrow.");
      } else if (message) {
        alert(message);
      } else {
        console.error(e);
        alert('Could not post. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>New Post</h2>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <textarea
          style={styles.textarea}
          placeholder="What's happening in Bali?"
          value={body}
          onChange={e => setBody(e.target.value)}
          maxLength={2000}
          autoFocus
        />

        {/* Image previews */}
        {images.length > 0 && (
          <div style={styles.imagePreviews}>
            {images.map((url, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={url}
                  style={styles.previewImg}
                  alt=""
                />
                <button
                  style={styles.removeImg}
                  onClick={() => setImages(prev => prev.filter((_, j) => j !== i))}
                >✕</button>
              </div>
            ))}
          </div>
        )}

        {/* Place tagging */}
        <div style={styles.placeSection}>
          {selectedPlace || (newPlaceName.trim() && geocodedPoint) ? (
            <div style={styles.selectedPlaceChip}>
              <span style={{ marginRight: 6 }}>◎</span>
              <span style={{ flex: 1 }}>{selectedPlace ? selectedPlace.name : newPlaceName.trim()}</span>
              {!selectedPlace && <span style={styles.newPlaceBadge}>new</span>}
              <button style={styles.clearPlaceBtn} onClick={clearPlace}>✕</button>
            </div>
          ) : (
            <>
              <input
                style={styles.placeSearchInput}
                placeholder="Tag a place you visited..."
                value={placeQuery}
                onChange={e => handlePlaceQueryChange(e.target.value)}
              />
              {placeQuery.trim() && (
                <div style={styles.placeResultsBox}>
                  {searchingPlace ? (
                    <div style={styles.placeResultRow}>Searching...</div>
                  ) : placeResults.length > 0 ? (
                    placeResults.map(p => (
                      <div
                        key={p.id}
                        style={styles.placeResultRow}
                        onClick={() => handleSelectPlace(p)}
                      >
                        {p.name}
                        <span style={styles.placeResultCategory}>{p.category}</span>
                      </div>
                    ))
                  ) : (
                    <div style={styles.placeResultRow}>No matches</div>
                  )}
                  <div
                    style={{ ...styles.placeResultRow, color: C.goldDark, fontWeight: 600 }}
                    onClick={() => { setShowAddPlace(true); setNewPlaceName(placeQuery); setPlaceQuery(''); setPlaceResults([]); }}
                  >
                    Can't find it? Add the place
                  </div>
                </div>
              )}
              {!placeQuery.trim() && !showAddPlace && (
                <button style={styles.addPlaceLink} onClick={() => setShowAddPlace(true)}>
                  Can't find it? Add the place
                </button>
              )}
            </>
          )}

          {showAddPlace && !selectedPlace && (
            <div style={styles.addPlaceForm}>
              <input
                style={styles.addPlaceInput}
                placeholder="Place name"
                value={newPlaceName}
                onChange={e => setNewPlaceName(e.target.value)}
              />
              <select
                style={styles.addPlaceInput}
                value={newPlaceCategory}
                onChange={e => setNewPlaceCategory(e.target.value)}
              >
                {PLACE_CATEGORIES.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  style={{ ...styles.addPlaceInput, flex: 1 }}
                  placeholder="Address or area (e.g. Jl. Pantai Berawa, Canggu)"
                  value={newPlaceAddress}
                  onChange={e => { setNewPlaceAddress(e.target.value); setGeocodedPoint(null); }}
                />
                <button
                  style={styles.findLocationBtn}
                  onClick={handleGeocodeAddress}
                  disabled={geocoding || !newPlaceAddress.trim()}
                >
                  {geocoding ? '...' : 'Find'}
                </button>
              </div>
              {geocodeError && <div style={styles.geocodeError}>{geocodeError}</div>}
              {geocodedPoint && (
                <div style={styles.geocodeConfirm}>Located: {geocodedPoint.name}, {geocodedPoint.country}</div>
              )}
            </div>
          )}
        </div>

        <div style={styles.composeFooter}>
          <div style={styles.composeActions}>
            {/* Photo upload */}
            <button
              style={styles.iconBtn}
              onClick={() => fileRef.current?.click()}
              title="Add photos"
            >
              📷
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleImage}
            />

            {/* Region picker */}
            <select
              style={styles.regionSelect}
              value={region}
              onChange={e => setRegion(e.target.value)}
            >
              <option value="">Region</option>
              {REGIONS.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <button
            style={{
              ...styles.postBtn,
              opacity: (!body.trim() && images.length === 0) || submitting ? 0.5 : 1,
            }}
            onClick={handleSubmit}
            disabled={(!body.trim() && images.length === 0) || submitting}
          >
            {submitting ? '...' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Comments Modal ───────────────────────────────────────────────────────────

function CommentsModal({ postId, onClose }: { postId: string; onClose: () => void }) {
  const [comments, setComments] = useState<any[]>([]);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get(`/community/posts/${postId}/comments`)
      .then(r => setComments(r.data || []))
      .catch(console.error);
  }, [postId]);

  const handleSubmit = async () => {
    if (!newComment.trim()) return;
    setSubmitting(true);
    try {
      await api.post(`/community/posts/${postId}/comments`, { body: newComment.trim() });
      setNewComment('');
      const r = await api.get(`/community/posts/${postId}/comments`);
      setComments(r.data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>Comments</h2>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 0' }}>
          {comments.length === 0 ? (
            <p style={{ color: C.muted, textAlign: 'center', padding: 20, fontSize: 14 }}>
              No comments yet. Be the first.
            </p>
          ) : (
            comments.map(c => {
              const initials = (c.display_name || '?').split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div key={c.id} style={styles.comment}>
                  <div style={{ ...styles.avatar, width: 28, height: 28, fontSize: 10 }}>{initials}</div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 2 }}>
                      {c.display_name || 'Member'}
                    </div>
                    <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{c.body}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div style={styles.commentInput}>
          <input
            style={styles.commentField}
            placeholder="Add a comment..."
            value={newComment}
            onChange={e => setNewComment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
          />
          <button
            style={{ ...styles.postBtn, padding: '8px 16px', opacity: !newComment.trim() ? 0.5 : 1 }}
            onClick={handleSubmit}
            disabled={!newComment.trim() || submitting}
          >
            {submitting ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { height: '100%', display: 'flex', flexDirection: 'column', background: C.bg },

  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
    padding: '32px 32px 0',
  },
  title: { fontSize: 26, fontWeight: 700, color: C.text, fontFamily: "'DM Serif Display', serif" },
  subtitle: { fontSize: 14, color: C.muted, marginTop: 2 },
  composeBtn: {
    background: C.gold, color: '#fff', border: 'none', borderRadius: 10,
    padding: '10px 20px', fontWeight: 600, fontSize: 14, cursor: 'pointer',
    flexShrink: 0,
  },

  toggle: {
    display: 'flex', gap: 4, padding: '20px 32px 0',
  },
  toggleBtn: {
    padding: '7px 16px', borderRadius: 20, border: 'none',
    background: 'transparent', color: C.muted, fontSize: 13,
    fontWeight: 500, cursor: 'pointer',
  },
  toggleActive: {
    background: C.goldLight, color: C.goldDark, fontWeight: 600,
  },

  feed: {
    flex: 1, overflowY: 'auto', padding: '16px 32px 32px',
    display: 'flex', flexDirection: 'column', gap: 16,
  },

  loading: { display: 'flex', justifyContent: 'center', padding: 40 },
  loadingDot: {
    width: 8, height: 8, borderRadius: '50%', background: C.gold,
    animation: 'pulse 1s infinite',
  },

  empty: { textAlign: 'center', padding: '60px 20px' },
  emptyIcon: { fontSize: 36, color: C.gold, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: 600, color: C.text, marginBottom: 6 },
  emptyDesc: { fontSize: 14, color: C.muted, lineHeight: 1.6 },

  // Post card
  card: {
    background: C.white, borderRadius: 16, padding: 20,
    border: `1px solid ${C.border}`,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  avatar: {
    width: 38, height: 38, borderRadius: '50%',
    background: C.goldLight, color: C.goldDark,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 13, fontWeight: 700, flexShrink: 0,
  },
  authorName: { fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 3 },
  meta: { display: 'flex', alignItems: 'center', gap: 8 },
  regionPill: {
    background: C.goldLight, color: C.goldDark,
    borderRadius: 20, padding: '2px 8px',
    fontSize: 11, fontWeight: 600,
  },
  time: { fontSize: 12, color: C.muted },

  cardBody: {
    fontSize: 15, color: C.text, lineHeight: 1.6,
    marginBottom: 12, whiteSpace: 'pre-wrap' as const,
  },

  mediaGrid: { display: 'flex', gap: 4, marginBottom: 12, borderRadius: 10, overflow: 'hidden' },
  mediaImg: { width: '33%', aspectRatio: '1', objectFit: 'cover' as const },
  mediaImgFull: { width: '100%', aspectRatio: '16/9', borderRadius: 10 },

  placeTag: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: 12, color: C.muted,
    marginBottom: 12,
  },

  cardFooter: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: `1px solid ${C.border}` },
  reactions: { display: 'flex', alignItems: 'center', gap: 4 },
  reactionBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 18, padding: '4px 8px', borderRadius: 8,
    transition: 'background 0.1s',
  },
  reactionActive: { background: C.goldLight },
  reactionCount: { fontSize: 13, color: C.muted, marginLeft: 4 },
  commentBtn: {
    background: 'transparent', border: 'none', cursor: 'pointer',
    fontSize: 13, color: C.muted, padding: '4px 8px', borderRadius: 8,
    display: 'flex', alignItems: 'center',
  },

  // Compose modal
  overlay: {
    position: 'fixed' as const, inset: 0,
    background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    background: C.white, borderRadius: 20, width: '90%', maxWidth: 560,
    boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
  },
  modalHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '20px 24px 0',
  },
  modalTitle: { fontSize: 18, fontWeight: 700, color: C.text },
  closeBtn: {
    background: 'none', border: 'none', fontSize: 18,
    color: C.muted, cursor: 'pointer', padding: 4,
  },
  textarea: {
    width: '100%', minHeight: 120, padding: '16px 24px',
    border: 'none', outline: 'none', resize: 'none' as const,
    fontSize: 15, color: C.text, lineHeight: 1.6,
    fontFamily: "'DM Sans', sans-serif",
    background: 'transparent',
  },
  imagePreviews: {
    display: 'flex', gap: 8, padding: '0 24px 12px', flexWrap: 'wrap' as const,
  },
  previewImg: {
    width: 80, height: 80, objectFit: 'cover' as const,
    borderRadius: 8,
  },
  removeImg: {
    position: 'absolute' as const, top: -6, right: -6,
    background: '#333', color: '#fff', border: 'none',
    borderRadius: '50%', width: 18, height: 18,
    fontSize: 10, cursor: 'pointer', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  },

  // Place tagging
  placeSection: { padding: '0 24px 12px', position: 'relative' as const },
  placeSearchInput: {
    width: '100%', border: `1px solid ${C.border}`, borderRadius: 10,
    padding: '9px 12px', fontSize: 13, outline: 'none',
    background: C.soft, boxSizing: 'border-box' as const,
  },
  placeResultsBox: {
    marginTop: 4, border: `1px solid ${C.border}`, borderRadius: 10,
    background: C.white, boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
    overflow: 'hidden',
  },
  placeResultRow: {
    padding: '9px 12px', fontSize: 13, color: C.text, cursor: 'pointer',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    borderBottom: `1px solid ${C.border}`,
  },
  placeResultCategory: { fontSize: 11, color: C.muted, textTransform: 'capitalize' as const },
  addPlaceLink: {
    background: 'none', border: 'none', color: C.goldDark, fontSize: 12.5,
    fontWeight: 600, cursor: 'pointer', padding: '6px 0 0', textAlign: 'left' as const,
  },
  selectedPlaceChip: {
    display: 'flex', alignItems: 'center', gap: 4,
    background: C.goldLight, color: C.goldDark, borderRadius: 10,
    padding: '9px 12px', fontSize: 13, fontWeight: 600,
  },
  newPlaceBadge: {
    background: C.gold, color: '#fff', fontSize: 10, fontWeight: 700,
    borderRadius: 6, padding: '2px 6px', marginRight: 6,
  },
  clearPlaceBtn: {
    background: 'none', border: 'none', color: C.goldDark, cursor: 'pointer',
    fontSize: 13, padding: 2,
  },
  addPlaceForm: {
    marginTop: 8, display: 'flex', flexDirection: 'column' as const, gap: 6,
    padding: 12, background: C.soft, borderRadius: 10,
  },
  addPlaceInput: {
    border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 10px',
    fontSize: 13, outline: 'none', background: C.white,
    boxSizing: 'border-box' as const, width: '100%',
  },
  findLocationBtn: {
    background: C.gold, color: '#fff', border: 'none', borderRadius: 8,
    padding: '0 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
  },
  geocodeError: { fontSize: 11.5, color: '#C62828' },
  geocodeConfirm: { fontSize: 11.5, color: '#10B981', fontWeight: 600 },

  composeFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 24px 20px', borderTop: `1px solid ${C.border}`,
  },
  composeActions: { display: 'flex', alignItems: 'center', gap: 10 },
  iconBtn: {
    background: 'none', border: 'none', fontSize: 20,
    cursor: 'pointer', padding: 4,
  },
  regionSelect: {
    border: `1px solid ${C.border}`, borderRadius: 8,
    padding: '6px 10px', fontSize: 13, color: C.text,
    background: C.soft, outline: 'none', cursor: 'pointer',
  },
  postBtn: {
    background: C.gold, color: '#fff', border: 'none',
    borderRadius: 10, padding: '10px 24px',
    fontWeight: 600, fontSize: 14, cursor: 'pointer',
  },

  // Comments
  comment: {
    display: 'flex', gap: 10, padding: '8px 24px',
    alignItems: 'flex-start',
  },
  commentInput: {
    display: 'flex', gap: 10, padding: '12px 24px 20px',
    borderTop: `1px solid ${C.border}`,
    alignItems: 'center',
  },
  commentField: {
    flex: 1, border: `1px solid ${C.border}`, borderRadius: 10,
    padding: '10px 14px', fontSize: 14, outline: 'none',
    background: C.soft,
  },
};
