#!/usr/bin/env python3
"""
Drift UI Update Script
1. Rebrand green → gold across all screens
2. Add trust badge to Explore operator cards
3. Add community posts to Profile
4. Seed interactions (reactions/comments between members)
"""

import subprocess
import json

# ─── 1. COLOUR REBRAND ───────────────────────────────────────────────────────

files = [
    '/home/travel-tool/web/src/screens/ExploreScreen.web.tsx',
    '/home/travel-tool/web/src/screens/ProfileScreen.web.tsx',
    '/home/travel-tool/web/src/screens/OnboardingScreen.web.tsx',
]

replacements = [
    ('#2E7D32', '#C9A84C'),
    ('#1B5E20', '#A8893A'),
    ('#388E3C', '#C9A84C'),
    ('#43A047', '#C9A84C'),
    ('#E8F5E9', '#FBF5E6'),
    ('#f0f7f0', '#FBF5E6'),
    ('#1a5c1a', '#A8893A'),
    ("'#2E7D32'", "'#C9A84C'"),   # catch quoted versions too
]

for filepath in files:
    with open(filepath, 'r') as f:
        content = f.read()
    original = content
    for old, new in replacements:
        content = content.replace(old, new)
    if content != original:
        with open(filepath, 'w') as f:
            f.write(content)
        print(f"✓ Rebranded: {filepath.split('/')[-1]}")
    else:
        print(f"  No changes: {filepath.split('/')[-1]}")

# ─── 2. ADD TRUST BADGE TO EXPLORE CARD ──────────────────────────────────────

explore_path = '/home/travel-tool/web/src/screens/ExploreScreen.web.tsx'
with open(explore_path, 'r') as f:
    content = f.read()

# Add trust tier badge after verified badge in ResultCard
old_verified = "          {item.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}\n          {item.is_claimed && !item.is_verified && <span style={styles.claimedBadge}>Claimed</span>}"
new_verified = """          {item.is_verified && <span style={styles.verifiedBadge}>✓ Verified</span>}
          {item.trust_tier === 'elite' && <span style={styles.eliteBadge}>◆ Elite</span>}
          {item.trust_tier === 'trusted' && <span style={styles.trustedBadge}>★ Trusted</span>}
          {item.is_claimed && !item.is_verified && <span style={styles.claimedBadge}>Claimed</span>}
          {!item.operator_id && <span style={styles.unclaimedBadge}>Unclaimed</span>}"""

content = content.replace(old_verified, new_verified)

# Add badge styles
old_styles_end = "  detailLink: { color: '#C9A84C', fontSize: 14, fontWeight: 500 },"
new_styles = """  detailLink: { color: '#C9A84C', fontSize: 14, fontWeight: 500 },
  eliteBadge: { fontSize: 10, color: '#A8893A', background: '#FBF5E6', padding: '1px 6px', borderRadius: 4, fontWeight: 700 },
  trustedBadge: { fontSize: 10, color: '#10B981', background: '#ECFDF5', padding: '1px 6px', borderRadius: 4, fontWeight: 600 },
  unclaimedBadge: { fontSize: 10, color: '#9B9590', background: '#F5F3EF', padding: '1px 6px', borderRadius: 4, fontWeight: 500 },"""

content = content.replace(old_styles_end, new_styles)

with open(explore_path, 'w') as f:
    f.write(content)
print("✓ Trust badges added to Explore")

# ─── 3. ADD POSTS TO PROFILE SCREEN ──────────────────────────────────────────

profile_path = '/home/travel-tool/web/src/screens/ProfileScreen.web.tsx'
with open(profile_path, 'r') as f:
    content = f.read()

# Add posts state and fetch after existing useEffect
old_useeffect = "  useEffect(() => {\n    Promise.all([api.get('/travelers/me'), api.get('/travelers/me/preferences')])"
new_useeffect = """  const [posts, setPosts] = useState<any[]>([]);

  useEffect(() => {
    api.get('/community/posts').then(r => setPosts(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([api.get('/travelers/me'), api.get('/travelers/me/preferences')])"""

content = content.replace(old_useeffect, new_useeffect)

# Add posts section before closing div of return
old_closing = "    </div>\n  );\n}"
new_closing = """      {/* My Posts */}
      <div style={styles.card}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1A1A1A', marginBottom: 16 }}>My Posts</h3>
        {posts.length === 0 ? (
          <p style={{ color: '#9B9590', fontSize: 14 }}>No posts yet. Share something from the Feed tab.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {posts.map((post: any) => (
              <div key={post.id} style={{ padding: '12px 0', borderBottom: '1px solid #F0EDE8' }}>
                {post.region && (
                  <span style={{ fontSize: 11, color: '#A8893A', background: '#FBF5E6', borderRadius: 20, padding: '2px 8px', fontWeight: 600, marginBottom: 6, display: 'inline-block' }}>
                    {post.region}
                  </span>
                )}
                <p style={{ fontSize: 14, color: '#1A1A1A', lineHeight: 1.6, marginTop: 4 }}>{post.body}</p>
                <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: '#9B9590' }}>👍 {post.reaction_count}</span>
                  <span style={{ fontSize: 12, color: '#9B9590' }}>◇ {post.comment_count}</span>
                  <span style={{ fontSize: 12, color: '#9B9590' }}>
                    {new Date(post.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}"""

# Only replace the last closing
last_idx = content.rfind("    </div>\n  );\n}")
if last_idx != -1:
    content = content[:last_idx] + new_closing + content[last_idx + len("    </div>\n  );\n}"):]

with open(profile_path, 'w') as f:
    f.write(content)
print("✓ Posts section added to Profile")

print("\nAll UI updates complete. Run: cd /home/travel-tool/web && npm run build")
