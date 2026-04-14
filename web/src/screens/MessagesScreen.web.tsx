import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../store';
import api from '../services/api.web';

function Avatar({ name, avatar, size = 36 }: { name: string; avatar?: string; size?: number }) {
  if (avatar) return <img src={avatar} alt={name} style={{ width: size, height: size, borderRadius: size/2, objectFit: 'cover', flexShrink: 0 }} />;
  return (
    <div style={{ width: size, height: size, borderRadius: size/2, background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, flexShrink: 0 }}>
      {name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  );
}

function ConversationList({ conversations, onSelect, selectedId }: any) {
  if (conversations.length === 0) {
    return (
      <div style={s.emptyConv}>
        <p style={s.emptyTitle}>No messages yet</p>
        <p style={s.emptySub}>Connect with members and start a conversation</p>
      </div>
    );
  }
  return (
    <div style={s.convList}>
      {conversations.map((c: any) => (
        <div key={c.partner_id} style={{ ...s.convItem, ...(selectedId === c.partner_id ? s.convItemActive : {}) }}
          onClick={() => onSelect(c)}>
          <Avatar name={c.other_name} avatar={c.other_avatar} />
          <div style={s.convInfo}>
            <div style={s.convTop}>
              <span style={s.convName}>{c.other_name}</span>
              <span style={s.convTime}>{new Date(c.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span>
            </div>
            <div style={s.convBottom}>
              <span style={{ ...s.convPreview, fontWeight: parseInt(c.unread_count) > 0 ? 600 : 400 }}>
                {c.sender_id !== c.partner_id ? 'You: ' : ''}{c.body.slice(0, 50)}{c.body.length > 50 ? '...' : ''}
              </span>
              {parseInt(c.unread_count) > 0 && (
                <span style={s.unreadBadge}>{c.unread_count}</span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MessageThread({ conversation, currentUserId, onBack }: any) {
  const [messages, setMessages] = useState<any[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await api.get(`/messages/${conversation.partner_id}`);
      setMessages(res.data.messages || []);
      setOtherUser(res.data.other_user);
    } catch (err) { console.error(err); }
  }, [conversation.partner_id]);

  useEffect(() => {
    fetchMessages();
    // Poll for new messages every 8 seconds
    const interval = setInterval(fetchMessages, 8000);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || sending) return;
    setSending(true);
    try {
      const res = await api.post('/messages', {
        recipient_id: conversation.partner_id,
        body: input.trim(),
      });
      setMessages(prev => [...prev, { ...res.data, sender_name: 'You', sender_avatar: null }]);
      setInput('');
    } catch (err) { console.error(err); }
    finally { setSending(false); }
  };

  const fmt = (d: string) => new Date(d).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });

  let lastDate = '';

  return (
    <div style={s.thread}>
      <div style={s.threadHeader}>
        <button style={s.backBtn} onClick={onBack}>←</button>
        <Avatar name={conversation.other_name} avatar={conversation.other_avatar} />
        <div style={s.threadHeaderInfo}>
          <p style={s.threadName}>{conversation.other_name}</p>
        </div>
      </div>

      <div style={s.messages}>
        {messages.map((m: any) => {
          const isMe = m.sender_id === currentUserId;
          const msgDate = fmtDate(m.created_at);
          const showDate = msgDate !== lastDate;
          lastDate = msgDate;
          return (
            <React.Fragment key={m.id}>
              {showDate && <div style={s.dateSep}>{msgDate}</div>}
              <div style={{ ...s.msgRow, justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
                {!isMe && <Avatar name={m.sender_name} avatar={m.sender_avatar} size={28} />}
                <div style={{ ...s.bubble, ...(isMe ? s.bubbleMe : s.bubbleThem) }}>
                  <p style={s.bubbleText}>{m.body}</p>
                  <p style={s.bubbleTime}>{fmt(m.created_at)}</p>
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={s.inputRow}>
        <input
          style={s.msgInput}
          placeholder="Type a message..."
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          maxLength={2000}
        />
        <button style={{ ...s.sendBtn, opacity: (!input.trim() || sending) ? 0.5 : 1 }}
          onClick={handleSend} disabled={!input.trim() || sending}>
          {sending ? '...' : '↑'}
        </button>
      </div>
    </div>
  );
}

export default function MessagesScreen() {
  const { user } = useSelector((s: RootState) => s.auth);
  const [conversations, setConversations] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [connections, setConnections] = useState<any[]>([]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await api.get('/messages');
      setConversations(res.data || []);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await api.get('/members/my/connections');
      setConnections((res.data || []).filter((c: any) => c.status === 'accepted'));
    } catch (err) { console.error(err); }
  }, []);

  useEffect(() => {
    fetchConversations();
    fetchConnections();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, [fetchConversations, fetchConnections]);

  const handleSelect = (conv: any) => {
    setSelected(conv);
    setShowNewMsg(false);
    setConversations(prev => prev.map(c =>
      c.partner_id === conv.partner_id ? { ...c, unread_count: 0 } : c
    ));
  };

  const startNewConversation = (conn: any) => {
    setSelected({ partner_id: conn.other_user_id, other_name: conn.other_display_name, other_avatar: conn.other_avatar });
    setShowNewMsg(false);
  };

  if (loading) return <div style={s.loading}>Loading messages...</div>;

  if (showNewMsg) {
    return (
      <div style={s.container}>
        <div style={s.listPane}>
          <div style={s.listHeader}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#555' }} onClick={() => setShowNewMsg(false)}>←</button>
              <h2 style={s.listTitle}>New message</h2>
            </div>
          </div>
          <div style={s.convList}>
            {connections.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#888' }}>
                <p>No connections yet.</p>
                <p style={{ fontSize: 13, color: '#bbb', marginTop: 8 }}>Accept connection requests in the Members tab first.</p>
              </div>
            ) : connections.map((c: any) => (
              <div key={c.other_user_id} style={s.convItem} onClick={() => startNewConversation(c)}>
                <Avatar name={c.other_display_name} avatar={c.other_avatar} />
                <div style={s.convInfo}>
                  <p style={{ fontSize: 15, fontWeight: 600, color: '#1a1a1a' }}>{c.other_display_name}</p>
                  <p style={{ fontSize: 12, color: '#888' }}>
                    {c.other_regions?.slice(0,2).map((r: string) => r.replace(/_/g,' ')).join(' · ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.container}>
      {selected ? (
        <MessageThread
          conversation={selected}
          currentUserId={user?.id}
          onBack={() => { setSelected(null); fetchConversations(); }}
        />
      ) : (
        <div style={s.listPane}>
          <div style={s.listHeader}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h2 style={s.listTitle}>Messages</h2>
              <button
                style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setShowNewMsg(true)}>
                + New
              </button>
            </div>
          </div>
          <ConversationList
            conversations={conversations}
            onSelect={handleSelect}
            selectedId={selected?.partner_id}
          />
          {conversations.length === 0 && (
            <div style={{ padding: '40px 20px', textAlign: 'center', color: '#888' }}>
              <p style={{ marginBottom: 8 }}>No messages yet.</p>
              <p style={{ fontSize: 13, color: '#bbb', marginBottom: 16 }}>Start a conversation with a connected member.</p>
              <button
                style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: 14, cursor: 'pointer' }}
                onClick={() => setShowNewMsg(true)}>
                Start a conversation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { height: '100%', display: 'flex', overflow: 'hidden', background: '#f8f8f6' },
  loading: { padding: 60, textAlign: 'center', color: '#999' },
  listPane: { width: '100%', display: 'flex', flexDirection: 'column', background: '#fff' },
  listHeader: { padding: '20px 20px 12px', borderBottom: '1px solid #f0f0f0' },
  listTitle: { fontSize: 22, fontWeight: 700, color: '#1a1a1a' },
  convList: { flex: 1, overflowY: 'auto' },
  convItem: { display: 'flex', gap: 12, padding: '14px 20px', cursor: 'pointer', alignItems: 'center', borderBottom: '1px solid #f8f8f6' },
  convItemActive: { background: '#f0f7f0' },
  convInfo: { flex: 1, minWidth: 0 },
  convTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 },
  convName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a' },
  convTime: { fontSize: 11, color: '#bbb', flexShrink: 0 },
  convBottom: { display: 'flex', alignItems: 'center', gap: 6 },
  convPreview: { fontSize: 13, color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  unreadBadge: { background: '#1a1a1a', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 10, fontWeight: 700, flexShrink: 0 },
  emptyConv: { padding: '60px 24px', textAlign: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 },
  emptySub: { fontSize: 14, color: '#888' },
  thread: { flex: 1, display: 'flex', flexDirection: 'column', height: '100%' },
  threadHeader: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f0f0f0', background: '#fff' },
  backBtn: { background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#555', padding: '0 8px 0 0' },
  threadHeaderInfo: { flex: 1 },
  threadName: { fontSize: 16, fontWeight: 600, color: '#1a1a1a' },
  messages: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 4, background: '#f8f8f6' },
  dateSep: { textAlign: 'center', fontSize: 11, color: '#bbb', margin: '8px 0', fontWeight: 500 },
  msgRow: { display: 'flex', gap: 8, alignItems: 'flex-end' },
  bubble: { maxWidth: '70%', borderRadius: 16, padding: '10px 14px' },
  bubbleMe: { background: '#1a1a1a', color: '#fff', borderBottomRightRadius: 4 },
  bubbleThem: { background: '#fff', color: '#1a1a1a', borderBottomLeftRadius: 4, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  bubbleText: { fontSize: 15, lineHeight: 1.5, wordBreak: 'break-word' },
  bubbleTime: { fontSize: 10, opacity: 0.6, marginTop: 4, textAlign: 'right' },
  inputRow: { display: 'flex', gap: 8, padding: '12px 16px', background: '#fff', borderTop: '1px solid #f0f0f0' },
  msgInput: { flex: 1, padding: '10px 14px', border: '1.5px solid #e0e0e0', borderRadius: 24, fontSize: 15, outline: 'none', background: '#f8f8f6' },
  sendBtn: { width: 44, height: 44, borderRadius: 22, background: '#1a1a1a', color: '#fff', border: 'none', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
};
