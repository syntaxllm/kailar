'use client';
import { useEffect, useState, useRef } from 'react';

export default function SkaryaAI() {
  // State
  const [tab, setTab] = useState('bot');
  const [recordings, setRecordings] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('transcript');

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [scheduled, setScheduled] = useState([]);
  const [botStatus, setBotStatus] = useState({});

  // Bot Operations State
  const [manualUrl, setManualUrl] = useState('');
  const [activeSessions, setActiveSessions] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);

  const [summary, setSummary] = useState(null);
  const [actions, setActions] = useState(null);
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState('');

  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState('light');
  const [participantsModal, setParticipantsModal] = useState(null);

  const chatEnd = useRef(null);

  // Init
  useEffect(() => {
    const t = localStorage.getItem('theme') || 'light';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);

    checkAuth();
    loadRecordings();
    loadScheduled();
    loadActiveSessions();

    // Poll active sessions every 5 seconds
    const interval = setInterval(loadActiveSessions, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  // Auth
  async function checkAuth() {
    const hasToken = document.cookie.includes('ms_token');
    setIsLoggedIn(hasToken);
    if (hasToken) {
      loadUpcoming();
      try {
        const res = await fetch('/api/user/profile');
        if (res.ok) setUser(await res.json());
      } catch (e) { }
    }
  }

  function logout() {
    document.cookie = 'ms_token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    window.location.reload();
  }

  // Data Loading
  async function loadRecordings() {
    try {
      const res = await fetch('/api/transcripts');
      const data = await res.json() || [];
      setRecordings(data);
      // Use recordings as recent activity for now
      setRecentActivity(data.slice(0, 5).map(r => ({
        id: r.meetingId,
        title: r.meetingId,
        timestamp: r.importedAt,
        status: 'completed',
        segments: r.entries?.length || 0
      })));
    } catch (e) { }
  }

  async function loadUpcoming() {
    setLoading(true);
    try {
      const res = await fetch('/api/teams/recent');
      if (res.ok) setUpcoming(await res.json() || []);
    } catch (e) { }
    setLoading(false);
  }

  async function loadScheduled() {
    try {
      const res = await fetch('/api/schedule');
      if (res.ok) {
        const data = await res.json();
        setScheduled(data.map(s => s.id));
      }
    } catch (e) { }
  }

  async function loadActiveSessions() {
    try {
      const res = await fetch('/api/bot/status');
      if (res.ok) {
        const data = await res.json();
        if (data.sessions) {
          setActiveSessions(data.sessions);
        }
      }
    } catch (e) { }
  }

  // Bot Operations
  async function launchManualBot() {
    if (!manualUrl.trim()) return;

    setStatus('Launching bot...');
    const meetingId = `manual_${Date.now()}`;

    try {
      const res = await fetch('/api/process-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId, joinUrl: manualUrl })
      });
      const data = await res.json();

      if (data.status === 'bot_joining') {
        setActiveSessions(prev => [...prev, {
          id: meetingId,
          url: manualUrl,
          status: 'joining',
          startedAt: new Date().toISOString()
        }]);
        setManualUrl('');
        setStatus('Bot joining meeting...');
      } else if (data.error) {
        setStatus('Error: ' + data.error);
      }
    } catch (e) {
      setStatus('Failed to launch bot');
    }

    setTimeout(() => setStatus(''), 4000);
  }

  async function launchBotForMeeting(meeting) {
    setStatus('Launching bot...');
    setBotStatus(p => ({ ...p, [meeting.id]: { status: 'joining' } }));

    try {
      const res = await fetch('/api/process-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingId: meeting.id, joinUrl: meeting.webUrl || meeting.joinUrl })
      });
      const data = await res.json();
      if (data.status === 'bot_joining') {
        setBotStatus(p => ({ ...p, [meeting.id]: { status: 'joining', logs: ['Connecting...'] } }));
        setActiveSessions(prev => [...prev, {
          id: meeting.id,
          title: meeting.subject,
          status: 'joining',
          startedAt: new Date().toISOString()
        }]);
      }
    } catch (e) { }

    setTimeout(() => setStatus(''), 3000);
  }

  async function stopBot(sessionId) {
    if (!confirm('Stop this recording session?')) return;
    try {
      await fetch(`/api/bot/stop?sessionId=${sessionId}`, { method: 'POST' });
      setActiveSessions(prev => prev.filter(s => s.id !== sessionId));
    } catch (e) { }
  }

  async function toggleSchedule(meeting) {
    const isOn = scheduled.includes(meeting.id);
    try {
      await fetch(`/api/schedule${isOn ? `?id=${meeting.id}` : ''}`, {
        method: isOn ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting })
      });
      setScheduled(p => isOn ? p.filter(id => id !== meeting.id) : [...p, meeting.id]);
    } catch (e) { }
  }

  async function upload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setStatus('Uploading...');
    const fd = new FormData();
    fd.append('file', file);
    try {
      await fetch('/api/upload', { method: 'POST', body: fd });
      await loadRecordings();
    } catch (e) { }
    setStatus('');
  }

  async function deleteMeeting(id) {
    if (!confirm('Delete this recording?')) return;
    try {
      await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
      setRecordings(p => p.filter(m => m.meetingId !== id));
      if (selected?.meetingId === id) setSelected(null);
    } catch (e) { }
  }

  // AI Features
  async function loadSummary() {
    if (!selected || summary) return;
    setStatus('Generating summary...');
    try {
      const res = await fetch(`/api/summary/${selected.meetingId}`);
      setSummary(await res.json());
    } catch (e) { }
    setStatus('');
  }

  async function loadActions() {
    if (!selected || actions) return;
    setStatus('Extracting actions...');
    try {
      const res = await fetch(`/api/actions/${selected.meetingId}`);
      setActions(await res.json());
    } catch (e) { }
    setStatus('');
  }

  async function sendMessage() {
    if (!input.trim() || !selected) return;
    const msg = input;
    setChat(p => [...p, { role: 'user', content: msg }]);
    setInput('');

    try {
      const res = await fetch(`/api/chat/${selected.meetingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: msg, chatHistory: chat })
      });
      const data = await res.json();
      setChat(p => [...p, { role: 'assistant', content: data.answer || 'No response' }]);
    } catch (e) {
      setChat(p => [...p, { role: 'assistant', content: 'Error occurred' }]);
    }
  }

  function selectRecording(m) {
    setSelected(m);
    setTab('assistant');
    setView('transcript');
    setSummary(null);
    setActions(null);
    setChat([]);
  }

  function toggleTheme() {
    const t = theme === 'light' ? 'dark' : 'light';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
  }

  // Helpers
  function formatDate(str) {
    if (!str) return '—';
    return new Date(str).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatTime(str) {
    if (!str) return '—';
    return new Date(str).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function formatDuration(start, end) {
    if (!start || !end) return '';
    const mins = Math.round((new Date(end) - new Date(start)) / 60000);
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  }

  function isLive(m) {
    const now = new Date();
    return now >= new Date(m.startLocal || m.start) && now <= new Date(m.endLocal || m.end);
  }

  function getTimeUntil(str) {
    if (!str) return '';
    const diff = new Date(str) - new Date();
    if (diff < 0) return 'Now';
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `In ${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `In ${hrs}h`;
    return `In ${Math.floor(hrs / 24)}d`;
  }

  function getMeetingStatus(m) {
    if (botStatus[m.id]?.status === 'recording') return 'recording';
    if (botStatus[m.id]?.status === 'joining') return 'joining';
    if (isLive(m)) return 'live';
    if (scheduled.includes(m.id)) return 'scheduled';
    return 'upcoming';
  }

  function formatTimeAgo(str) {
    if (!str) return '';
    const diff = Date.now() - new Date(str).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  // Icons
  const Icons = {
    bot: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><line x1="12" y1="7" x2="12" y2="11" /><circle cx="8" cy="16" r="1" /><circle cx="16" cy="16" r="1" /></svg>,
    sparkle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" /></svg>,
    calendar: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
    clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><polyline points="12,6 12,12 16,14" /></svg>,
    user: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
    users: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>,
    link: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
    folder: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>,
    file: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14,2 14,8 20,8" /></svg>,
    check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20,6 9,17 4,12" /></svg>,
    message: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>,
    refresh: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23,4 23,10 17,10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>,
    moon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>,
    sun: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>,
    x: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>,
    play: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5,3 19,12 5,21" /></svg>,
    stop: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="6" y="6" width="12" height="12" /></svg>,
    activity: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12" /></svg>,
    zap: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10" /></svg>,
  };

  return (
    <div className="app-container">
      {/* Participants Modal */}
      {participantsModal && (
        <div className="modal-overlay" onClick={() => setParticipantsModal(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Participants</h3>
              <button className="modal-close" onClick={() => setParticipantsModal(null)}>{Icons.x}</button>
            </div>
            <div className="modal-body">
              {participantsModal.attendees?.length > 0 ? (
                <ul className="participants-list">
                  {participantsModal.attendees.map((p, i) => (
                    <li key={i} className="participant-item">
                      <div className="participant-avatar">{p.name.charAt(0).toUpperCase()}</div>
                      <div className="participant-info">
                        <span className="participant-name">{p.name}</span>
                        <span className="participant-email">{p.email}</span>
                      </div>
                      <span className={`participant-status ${p.status}`}>
                        {p.status === 'accepted' ? 'Accepted' : p.status === 'declined' ? 'Declined' : 'Pending'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="no-participants">No participants</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="brand" onClick={() => { setSelected(null); setTab('bot'); }}>
            <div className="brand-icon">S</div>
            <span className="brand-name">Skarya.AI</span>
          </div>

          <nav className="main-nav">
            <button className={`nav-tab ${tab === 'bot' ? 'active' : ''}`} onClick={() => setTab('bot')}>
              {Icons.bot}<span>Bot Operations</span>
            </button>
            <button className={`nav-tab ${tab === 'assistant' ? 'active' : ''}`} onClick={() => setTab('assistant')}>
              {Icons.sparkle}<span>AI Assistant</span>
            </button>
          </nav>
        </div>

        <div className="header-right">
          {status && <span className="status-badge">{status}</span>}
          <button onClick={toggleTheme} className="icon-btn">{theme === 'light' ? Icons.moon : Icons.sun}</button>

          {!isLoggedIn ? (
            <button className="primary" onClick={() => window.location.href = '/api/auth/login'}>Connect Teams</button>
          ) : (
            <div className="user-pill">
              <div className="user-info">
                <span className="user-name">{user?.displayName || 'User'}</span>
              </div>
              <button onClick={logout} className="logout-btn">Logout</button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content">
        {/* ============ BOT OPERATIONS ============ */}
        {tab === 'bot' && (
          <div className="bot-operations">
            {/* Quick Actions Bar */}
            <div className="quick-actions">
              <div className="quick-join">
                <h3>{Icons.zap} Quick Join</h3>
                <p>Paste a Teams meeting link to launch the bot instantly</p>
                <div className="join-input-group">
                  <input
                    type="text"
                    value={manualUrl}
                    onChange={e => setManualUrl(e.target.value)}
                    placeholder="https://teams.microsoft.com/l/meetup-join/..."
                    onKeyDown={e => e.key === 'Enter' && launchManualBot()}
                  />
                  <button className="primary" onClick={launchManualBot} disabled={!manualUrl.trim()}>
                    {Icons.play} Launch Bot
                  </button>
                </div>
              </div>
            </div>

            {/* Active Sessions */}
            <section className="bot-section">
              <div className="section-header">
                <h2>{Icons.activity} Active Sessions</h2>
                <span className="session-count">{activeSessions.length} running</span>
              </div>

              {activeSessions.length === 0 ? (
                <div className="empty-section">
                  <p>No active recording sessions</p>
                </div>
              ) : (
                <div className="sessions-list">
                  {activeSessions.map(session => (
                    <div key={session.id} className="session-card">
                      <div className="session-status">
                        <span className="pulse"></span>
                        {session.status === 'joining' ? 'Joining...' : 'Recording'}
                      </div>
                      <div className="session-info">
                        <span className="session-title">{session.title || session.id}</span>
                        <span className="session-time">Started {formatTimeAgo(session.startedAt)}</span>
                      </div>
                      <button className="stop-btn" onClick={() => stopBot(session.id)}>
                        {Icons.stop} Stop
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Upcoming Meetings */}
            <section className="bot-section">
              <div className="section-header">
                <h2>{Icons.calendar} Upcoming Meetings</h2>
                {isLoggedIn && (
                  <button className="secondary" onClick={loadUpcoming} disabled={loading}>
                    {Icons.refresh}<span>{loading ? 'Syncing...' : 'Refresh'}</span>
                  </button>
                )}
              </div>

              {!isLoggedIn ? (
                <div className="connect-prompt">
                  <div className="prompt-icon">{Icons.link}</div>
                  <h2>Connect Microsoft Teams</h2>
                  <p>Link your account to see upcoming meetings and auto-schedule recordings</p>
                  <button className="primary large" onClick={() => window.location.href = '/api/auth/login'}>
                    Connect Teams
                  </button>
                </div>
              ) : upcoming.length === 0 ? (
                <div className="empty-section">
                  <p>No upcoming meetings in the next 7 days</p>
                </div>
              ) : (
                <div className="meeting-grid">
                  {upcoming.map(m => {
                    const s = getMeetingStatus(m);
                    const live = isLive(m);
                    const startTime = m.startLocal || m.start;
                    const endTime = m.endLocal || m.end;

                    return (
                      <div key={m.id} className={`meeting-card ${s}`}>
                        <div className="card-top">
                          <div className={`card-status ${s}`}>
                            {s === 'recording' && <><span className="pulse" />Recording</>}
                            {s === 'joining' && <><span className="spinner-small" />Joining</>}
                            {s === 'live' && <><span className="pulse" />Live</>}
                            {s === 'scheduled' && <>{Icons.check} Auto</>}
                            {s === 'upcoming' && getTimeUntil(startTime)}
                          </div>
                        </div>

                        <h3 className="meeting-title">{m.subject}</h3>

                        <div className="meeting-meta">
                          <div className="meta-row">{Icons.calendar}<span>{formatDate(startTime)}</span></div>
                          <div className="meta-row">
                            {Icons.clock}
                            <span>{formatTime(startTime)} – {formatTime(endTime)}</span>
                            <span className="duration">({formatDuration(startTime, endTime)})</span>
                          </div>
                          <div className="meta-row">
                            {Icons.user}
                            <span>{m.isOrganizer ? 'You (Organizer)' : m.organizerName || 'Unknown'}</span>
                          </div>
                        </div>

                        {m.attendees?.length > 0 && (
                          <button className="participants-btn" onClick={() => setParticipantsModal(m)}>
                            {Icons.users}<span>{m.attendeeCount || m.attendees.length} participants</span>
                          </button>
                        )}

                        <div className="card-actions">
                          {live ? (
                            <button className="primary full-width" onClick={() => launchBotForMeeting(m)} disabled={s === 'joining' || s === 'recording'}>
                              {s === 'recording' ? 'Recording...' : s === 'joining' ? 'Joining...' : 'Launch Bot Now'}
                            </button>
                          ) : (
                            <button className={`${scheduled.includes(m.id) ? 'scheduled' : 'secondary'} full-width`} onClick={() => toggleSchedule(m)}>
                              {scheduled.includes(m.id) ? 'Auto-Record On' : 'Enable Auto-Record'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Recent Activity */}
            <section className="bot-section">
              <div className="section-header">
                <h2>{Icons.folder} Recent Recordings</h2>
              </div>

              {recentActivity.length === 0 ? (
                <div className="empty-section">
                  <p>No recent recordings</p>
                </div>
              ) : (
                <div className="activity-list">
                  {recentActivity.map(item => (
                    <div key={item.id} className="activity-item" onClick={() => {
                      const rec = recordings.find(r => r.meetingId === item.id);
                      if (rec) selectRecording(rec);
                    }}>
                      <div className="activity-icon">{Icons.file}</div>
                      <div className="activity-info">
                        <span className="activity-title">{item.title}</span>
                        <span className="activity-meta">{item.segments} segments · {formatTimeAgo(item.timestamp)}</span>
                      </div>
                      <span className="activity-status completed">{Icons.check}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ============ AI ASSISTANT ============ */}
        {tab === 'assistant' && (
          <div className="assistant-layout">
            <aside className="recordings-sidebar">
              <div className="sidebar-header">
                <h2>Recordings</h2>
                <button className="icon-btn small" onClick={() => document.getElementById('upload').click()}>{Icons.folder}</button>
                <input id="upload" type="file" onChange={upload} style={{ display: 'none' }} />
              </div>
              <div className="recordings-list">
                {recordings.length === 0 ? (
                  <div className="empty-sidebar">
                    <p>No recordings</p>
                    <p className="hint">Bot recordings will appear here</p>
                  </div>
                ) : (
                  recordings.map(m => (
                    <div key={m.meetingId} className={`recording-item ${selected?.meetingId === m.meetingId ? 'active' : ''}`} onClick={() => selectRecording(m)}>
                      <div className="recording-title">{m.meetingId}</div>
                      <div className="recording-meta">{m.entries?.length || 0} segments</div>
                      <button className="delete-btn" onClick={e => { e.stopPropagation(); deleteMeeting(m.meetingId); }}>{Icons.x}</button>
                    </div>
                  ))
                )}
              </div>
            </aside>

            <div className="analysis-main">
              {!selected ? (
                <div className="select-prompt">
                  <div className="prompt-icon">{Icons.file}</div>
                  <h2>Select a Recording</h2>
                  <p>Choose a meeting from the sidebar to analyze</p>
                </div>
              ) : (
                <>
                  <div className="analysis-header">
                    <h1>{selected.meetingId}</h1>
                    <p className="subtitle">{selected.entries?.length || 0} segments · {selected.source || 'Upload'}</p>
                  </div>

                  <div className="analysis-tabs">
                    <button className={`tab ${view === 'transcript' ? 'active' : ''}`} onClick={() => setView('transcript')}>{Icons.file} Transcript</button>
                    <button className={`tab ${view === 'summary' ? 'active' : ''}`} onClick={() => { setView('summary'); loadSummary(); }}>{Icons.sparkle} Summary</button>
                    <button className={`tab ${view === 'actions' ? 'active' : ''}`} onClick={() => { setView('actions'); loadActions(); }}>{Icons.check} Actions</button>
                    <button className={`tab ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>{Icons.message} Ask AI</button>
                  </div>

                  <div className="analysis-content">
                    {view === 'transcript' && (
                      <div className="transcript-view">
                        {selected.entries?.length > 0 ? selected.entries.map((e, i) => (
                          <div key={i} className="transcript-entry">
                            <span className="speaker">{e.speaker}</span>
                            <span className="text">{e.text}</span>
                            <span className="time">{e.start}</span>
                          </div>
                        )) : <p className="no-data">No transcript data</p>}
                      </div>
                    )}

                    {view === 'summary' && (
                      <div className="summary-view">
                        {summary?.error ? <p className="error">{summary.error}</p> : summary?.summary ? (
                          <div className="summary-content" dangerouslySetInnerHTML={{ __html: summary.summary.replace(/\n/g, '<br/>') }} />
                        ) : <div className="loading"><span className="spinner" />Generating...</div>}
                      </div>
                    )}

                    {view === 'actions' && (
                      <div className="actions-view">
                        {actions?.error ? <p className="error">{actions.error}</p> : actions?.actionItems ? (
                          <table className="actions-table">
                            <thead><tr><th>Task</th><th>Owner</th><th>Priority</th></tr></thead>
                            <tbody>
                              {actions.actionItems.map((item, i) => (
                                <tr key={i}>
                                  <td>{item.task}</td>
                                  <td><span className="owner-tag">{item.owner}</span></td>
                                  <td><span className={`priority ${item.priority?.toLowerCase()}`}>{item.priority}</span></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : <div className="loading"><span className="spinner" />Extracting...</div>}
                      </div>
                    )}

                    {view === 'chat' && (
                      <div className="chat-view">
                        <div className="chat-messages">
                          {chat.length === 0 ? (
                            <div className="chat-empty">
                              <p><strong>Ask about this meeting</strong></p>
                              <p>Example: "What decisions were made?"</p>
                            </div>
                          ) : chat.map((msg, i) => (
                            <div key={i} className={`chat-msg ${msg.role}`}>
                              <div className="msg-bubble">{msg.content}</div>
                            </div>
                          ))}
                          <div ref={chatEnd} />
                        </div>
                        <div className="chat-input-area">
                          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()} placeholder="Ask a question..." />
                          <button className="primary" onClick={sendMessage}>Send</button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
