#!/usr/bin/env python3
"""
Seed realistic interactions between Drift test members.
Reactions and comments on existing posts.
"""

import urllib.request
import urllib.parse
import json
import time

BASE = 'http://localhost/api/v1'

MEMBERS = [
    ('sarah.chen@drifttest.com',    'DriftTest2026!'),
    ('jake.morrison@drifttest.com', 'DriftTest2026!'),
    ('emma.jones@drifttest.com',    'DriftTest2026!'),
    ('marcus.lee@drifttest.com',    'DriftTest2026!'),
    ('priya.sharma@drifttest.com',  'DriftTest2026!'),
    ('tom.walsh@drifttest.com',     'DriftTest2026!'),
    ('lisa.nakamura@drifttest.com', 'DriftTest2026!'),
    ('ben.carter@drifttest.com',    'DriftTest2026!'),
]

def api(method, path, data=None, token=None):
    url = BASE + path
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return None

def login(email, password):
    result = api('POST', '/auth/login', {'email': email, 'password': password})
    return result['accessToken'] if result and 'accessToken' in result else None

print("▶ Logging in all members...")
tokens = {}
for email, password in MEMBERS:
    token = login(email, password)
    if token:
        name = email.split('@')[0].replace('.', ' ').title()
        tokens[email] = token
        print(f"  ✓ {name}")
    else:
        print(f"  ✗ Failed: {email}")

if not tokens:
    print("No tokens — aborting")
    exit(1)

print(f"\n▶ Fetching existing posts...")
token_list = list(tokens.values())
posts_resp = api('GET', '/community/discover', token=token_list[0])
posts = posts_resp if isinstance(posts_resp, list) else []
print(f"  Found {len(posts)} posts")

if not posts:
    print("No posts to react to")
    exit(0)

# ─── ADD REACTIONS ────────────────────────────────────────────────────────────

print("\n▶ Adding reactions...")

reaction_plan = [
    # (member_email, post_index, reaction)
    ('jake.morrison@drifttest.com',   0, 'fire'),
    ('emma.jones@drifttest.com',      0, 'heart'),
    ('priya.sharma@drifttest.com',    0, 'wave'),
    ('tom.walsh@drifttest.com',       0, 'like'),
    ('sarah.chen@drifttest.com',      1, 'fire'),
    ('marcus.lee@drifttest.com',      1, 'heart'),
    ('ben.carter@drifttest.com',      1, 'like'),
    ('lisa.nakamura@drifttest.com',   1, 'wave'),
    ('sarah.chen@drifttest.com',      2, 'fire'),
    ('jake.morrison@drifttest.com',   2, 'like'),
    ('tom.walsh@drifttest.com',       2, 'wave'),
    ('emma.jones@drifttest.com',      3, 'heart'),
    ('marcus.lee@drifttest.com',      3, 'fire'),
    ('priya.sharma@drifttest.com',    3, 'like'),
    ('ben.carter@drifttest.com',      4, 'wave'),
    ('lisa.nakamura@drifttest.com',   4, 'heart'),
    ('jake.morrison@drifttest.com',   4, 'fire'),
]

for email, post_idx, reaction in reaction_plan:
    if email not in tokens or post_idx >= len(posts):
        continue
    post_id = posts[post_idx]['id']
    token = tokens[email]
    result = api('POST', f'/community/posts/{post_id}/react', {'reaction': reaction}, token)
    name = email.split('@')[0].replace('.', ' ').title()
    print(f"  {name} → {reaction} on post {post_idx}")
    time.sleep(0.1)

# ─── ADD COMMENTS ────────────────────────────────────────────────────────────

print("\n▶ Adding comments...")

comment_plan = [
    ('jake.morrison@drifttest.com',   0, "Kelingking is unreal — did you do the hike down to the beach? Brutal but worth it."),
    ('emma.jones@drifttest.com',      0, "100% agree. We went at 6am to beat the crowds and had the viewpoint almost to ourselves."),
    ('sarah.chen@drifttest.com',      0, "Adding this to my list for next week 🙌"),
    ('marcus.lee@drifttest.com',      1, "The Liberty wreck is one of the best shore dives in the world. Did you see the bumphead parrotfish?"),
    ('priya.sharma@drifttest.com',    1, "Going to Tulamben next month — which dive operator did you use?"),
    ('emma.jones@drifttest.com',      1, "Used a small local operator, not one of the big ones. Happy to DM you the details!"),
    ('sarah.chen@drifttest.com',      2, "Ubud really does reveal itself slowly. Which part of town are you staying in?"),
    ('tom.walsh@drifttest.com',       2, "The rice terraces at Tegallalang are overrun but there are smaller ones near Sidemen that are incredible."),
    ('ben.carter@drifttest.com',      3, "That warung sounds exactly like what I've been looking for. Any chance you remember where it was?"),
    ('sarah.chen@drifttest.com',      3, "It was down a small gang off the main road heading north out of Amed — no signage, just follow the locals!"),
    ('lisa.nakamura@drifttest.com',   4, "The Seminyak sunset strip is beautiful but I found even better sunsets at Tanah Lot — less crowded too."),
    ('jake.morrison@drifttest.com',   4, "Totally agree on Tanah Lot. The temple at sunset is one of those moments you don't forget."),
]

for email, post_idx, comment in comment_plan:
    if email not in tokens or post_idx >= len(posts):
        continue
    post_id = posts[post_idx]['id']
    token = tokens[email]
    result = api('POST', f'/community/posts/{post_id}/comments', {'body': comment}, token)
    name = email.split('@')[0].replace('.', ' ').title()
    print(f"  {name} → comment on post {post_idx}")
    time.sleep(0.15)

# ─── ADD MORE POSTS ───────────────────────────────────────────────────────────

print("\n▶ Adding more posts from other members...")

more_posts = [
    ('priya.sharma@drifttest.com', {
        'body': 'Just finished a week of yoga and meditation in Ubud. My nervous system has never felt so calm. If you haven't done a proper retreat here, put it on your list.',
        'region': 'Ubud',
    }),
    ('tom.walsh@drifttest.com', {
        'body': 'Surfed Uluwatu for the first time today. The cave entrance, the lineup, the backdrop — I've surfed a lot of places but this is something else.',
        'region': 'Uluwatu',
    }),
    ('lisa.nakamura@drifttest.com', {
        'body': 'Spent the day exploring the back roads of Sidemen valley on a scooter. No tourists, beautiful terraced rice fields, and the most welcoming locals I've met anywhere.',
        'region': 'Sidemen',
    }),
    ('ben.carter@drifttest.com', {
        'body': 'Three months in Canggu and I still can't get bored of it. The food scene here is genuinely world class — you could eat somewhere new every day for a year.',
        'region': 'Canggu',
    }),
]

for email, post_data in more_posts:
    if email not in tokens:
        continue
    token = tokens[email]
    result = api('POST', '/community/posts', {**post_data, 'visibility': 'public'}, token)
    name = email.split('@')[0].replace('.', ' ').title()
    if result and 'postId' in result:
        print(f"  ✓ {name} posted about {post_data['region']}")
    else:
        print(f"  ✗ Failed for {name}")
    time.sleep(0.2)

print("\n✅ Seeding complete!")
print("Refresh the discover feed to see all interactions.")
