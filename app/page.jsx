'use client';
import { useEffect, useState, useRef } from 'react';

export default function MeetingAI() {
  const [meetings, setMeetings] = useState([]);
  const [selectedMeeting, setSelectedMeeting] = useState(null);
  const [view, setView] = useState('overview');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [summary, setSummary] = useState(null);
  const [actionItems, setActionItems] = useState(null);
  const [status, setStatus] = useState('');
  const [realMeetings, setRealMeetings] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [theme, setTheme] = useState('light');
  const [activeSpeakers, setActiveSpeakers] = useState({});
  const [scheduledMeetings, setScheduledMeetings] = useState([]); // [meetingId, ...]
  const chatEndRef = useRef(null);

  useEffect(() => {
    loadMeetings();
    checkLogin();
    loadSchedules();
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);

    // REAL-TIME UX: Poll for active meeting status (speakers)
    const interval = setInterval(pollActiveBots, 3000);
    return () => clearInterval(interval);
  }, []);

  async function pollActiveBots() {
    // Only poll if we have meetings that are in 'bot_joining' state
    const botsToPoll = realMeetings.filter(m => m.access?.status === 'bot_joining' || m.access?.status === 'recording');
    if (botsToPoll.length === 0) return;

    for (const m of botsToPoll) {
      // We'd need the sessionId from the initial response. 
      // For now, let's assume we can query by meetingId if the bot-service supports it, 
      // OR we use the check-access which we'll update to include bot session info.
      try {
        const res = await fetch(`/api/bot/status?meetingId=${m.id}`);
        if (res.ok) {
          const data = await res.json();
          if (data.currentSpeaker) {
            setActiveSpeakers(prev => ({ ...prev, [m.id]: data.currentSpeaker }));
          }
        }
      } catch (e) { }
    }
  }

  useEffect(() => {
    if (view === 'chat' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, view]);

  async function handleDeleteMeeting(id) {
    if (!confirm('Are you sure you want to delete this meeting? This cannot be undone.')) return;

    try {
      const res = await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setMeetings(prev => prev.filter(m => m.meetingId !== id));
        if (selectedMeeting?.meetingId === id) {
          setSelectedMeeting(null);
          setView('welcome');
        }
      } else {
        alert('Failed to delete meeting');
      }
    } catch (e) {
      console.error(e);
      alert('Delete failed');
    }
  }

  async function loadMeetings() {
    const res = await fetch('/api/transcripts');
    const data = await res.json();
    setMeetings(data || []);
  }



  function checkLogin() {
    const hasToken = document.cookie.includes('ms_token');
    setIsLoggedIn(hasToken);
    if (hasToken) loadRealMeetings();
  }

  async function loadRealMeetings() {
    setStatus('Syncing Teams meetings...');
    try {
      const res = await fetch('/api/teams/recent');
      if (res.ok) {
        const data = await res.json();
        const meetingsList = Array.isArray(data) ? data : [];

        // Enrich meetings with access status
        const enriched = await Promise.all(meetingsList.map(async (m) => {
          try {
            const checkRes = await fetch(`/api/check-access?meetingId=${encodeURIComponent(m.id)}&joinUrl=${encodeURIComponent(m.webUrl || '')}`);
            const checkData = await checkRes.json();
            return { ...m, access: checkData };
          } catch (e) {
            return { ...m, access: { status: 'unknown' } };
          }
        }));

        setRealMeetings(enriched);
        setStatus('');
      } else {
        const err = await res.json();
        setStatus('Sync failed: ' + (err.error || res.statusText));
      }
    } catch (e) {
      console.error(e);
      setStatus('Network error syncing meetings.');
    }
  }

  async function loadSchedules() {
    try {
      const res = await fetch('/api/schedule');
      if (res.ok) {
        const data = await res.json();
        setScheduledMeetings(data.map(s => s.id));
      }
    } catch (e) { }
  }

  async function scheduleMeeting(meeting) {
    setStatus('Scheduling skarya.ai Bot...');
    try {
      const isScheduled = scheduledMeetings.includes(meeting.id);
      const res = await fetch(`/api/schedule${isScheduled ? `?id=${meeting.id}` : ''}`, {
        method: isScheduled ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meeting })
      });

      if (res.ok) {
        if (isScheduled) {
          setScheduledMeetings(prev => prev.filter(id => id !== meeting.id));
          setStatus('Auto-record removed.');
        } else {
          setScheduledMeetings(prev => [...prev, meeting.id]);
          setStatus('Bot will join automatically when meeting starts!');
        }
      }
    } catch (e) {
      console.error(e);
      setStatus('Failed to update schedule.');
    }
    setTimeout(() => setStatus(''), 3000);
  }

  async function ingestMeetingHybrid(meeting) {
    setStatus('Initializing Hybrid Processor...');
    try {
      const res = await fetch('/api/process-meeting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: meeting.id,
          joinUrl: meeting.webUrl,
          userEmail: isLoggedIn // Simple check
        })
      });

      const data = await res.json();

      if (data.status === 'success') {
        await loadMeetings();
        setStatus('Analysis complete.');
      } else if (res.status === 429) {
        setStatus('System Busy: All bots are in use. 🤖');
        alert('The system is currently at maximum capacity. Please wait for another meeting to finish before joining.');
      } else if (data.status === 'bot_joining') {
        setStatus('Bot is joining the meeting... 🤖');
        // Refresh list to show bot status
        loadRealMeetings();
      } else if (data.status === 'awaiting_consent') {
        alert('Organizer consent needed for native transcript. Requesting bot fallback...');
      } else {
        setStatus('Processing: ' + (data.message || 'Starting...'));
      }

      setTimeout(() => setStatus(''), 5000);
    } catch (e) {
      console.error(e);
      setStatus('Error starting process.');
    }
  }

  async function doUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setStatus('Uploading file...');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) {
      await loadMeetings();
      setStatus('Uploaded successfully.');
      setTimeout(() => setStatus(''), 3000);
    } else {
      setStatus('Upload error: ' + data.error);
    }
  }

  async function getSummary() {
    if (!summary) {
      setStatus('Generating AI summary...');
      const res = await fetch(`/api/summary/${selectedMeeting.meetingId}`);
      setSummary(await res.json());
      setStatus('');
    }
  }

  async function getActions() {
    if (!actionItems) {
      setStatus('Extracting action items...');
      const res = await fetch(`/api/actions/${selectedMeeting.meetingId}`);
      setActionItems(await res.json());
      setStatus('');
    }
  }

  async function sendChat() {
    if (!chatInput) return;
    const msg = { role: 'user', content: chatInput };
    setChatMessages([...chatMessages, msg]);
    setChatInput('');
    setStatus('AI is thinking...');
    try {
      const res = await fetch(`/api/chat/${selectedMeeting.meetingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: chatInput, chatHistory: chatMessages })
      });
      const data = await res.json();
      if (data.error) {
        setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${data.error}` }]);
      } else {
        setChatMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }]);
      }
    } catch (error) {
      setChatMessages(prev => [...prev, { role: 'assistant', content: `An unexpected error occurred: ${error.message}` }]);
    }
    setStatus('');
  }

  const handleMeetingSelect = (m) => {
    setSelectedMeeting(m);
    setView('overview');
    setChatMessages([]);
    setSummary(null);
    setActionItems(null);
  };

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  };

  return (
    <div className="app-container">
      {/* Top Navigation / Header */}
      <header className="app-header">
        <div className="app-brand">
          <span style={{ fontSize: '20px', color: 'var(--teams-purple)' }}>⌯</span> skarya.ai Assistant
        </div>
        <div className="app-status">
          <button onClick={toggleTheme} className="header-action-btn" title="Toggle Dark/Light Mode">
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
          {status && <span>{status}</span>}
        </div>
      </header>

      <div className="main-layout">
        {/* Left Sidebar */}
        <div className="sidebar">
          {/* Teams Sync Section */}
          <div className="sidebar-section">
            <div className="sidebar-title">Microsoft Teams Sync</div>
            <div style={{ padding: '0 16px' }}>
              {!isLoggedIn ? (
                <button
                  onClick={() => window.location.href = '/api/auth/login'}
                  className="primary"
                  style={{ width: '100%', fontSize: '13px' }}
                >
                  Connect Teams
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '12px' }}>
                    <span style={{ color: 'green' }}>✓ Connected</span>
                    <button
                      onClick={() => { document.cookie = 'ms_token=; Max-Age=0'; setIsLoggedIn(false); }}
                      style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '11px', padding: 0 }}
                    >
                      Disconnect
                    </button>
                  </div>

                  <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #E1DFDD', borderRadius: '4px' }}>
                    {realMeetings.length === 0 ? (
                      <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>No recent meetings found.</div>
                    ) : (
                      realMeetings.map(rm => (
                        <div key={rm.id} style={{
                          padding: '10px 12px',
                          borderBottom: '1px solid #f0f0f0',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          background: rm.access?.canIngest ? 'rgba(0, 128, 0, 0.02)' : 'transparent'
                        }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '160px' }}>
                            <span
                              style={{ fontSize: '13px', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                              title={rm.subject}
                            >
                              {rm.subject}
                            </span>
                            <span style={{ fontSize: '10px', color: '#888' }}>
                              {rm.access?.status === 'accessible' ? '🟢 Native Ready' :
                                rm.access?.status === 'needs_permission' ? '🤖 Bot Required' :
                                  rm.access?.status === 'bot_joining' ? '⏳ Bot Joining...' : '⚪ Check Sync'}
                            </span>
                            {activeSpeakers[rm.id] && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
                                <div className="skarya-avatar active">S</div>
                                <span style={{ fontSize: '11px', color: '#6264A7', fontWeight: '600' }}>
                                  {activeSpeakers[rm.id]} is speaking...
                                </span>
                              </div>
                            )}
                          </div>

                          <div style={{ display: 'flex', gap: '4px' }}>
                            <button
                              onClick={() => scheduleMeeting(rm)}
                              style={{
                                border: '1px solid #6264A7',
                                backgroundColor: scheduledMeetings.includes(rm.id) ? '#6264A7' : 'white',
                                color: scheduledMeetings.includes(rm.id) ? 'white' : '#6264A7',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                padding: '2px 8px',
                                fontWeight: '600'
                              }}
                              title={scheduledMeetings.includes(rm.id) ? 'Cancel Auto-record' : 'Schedule Auto-record'}
                            >
                              {scheduledMeetings.includes(rm.id) ? '⏰ SCHEDULED' : '⏰ SCHEDULE'}
                            </button>

                            <button
                              onClick={() => ingestMeetingHybrid(rm)}
                              disabled={rm.access?.status === 'bot_joining'}
                              style={{
                                border: '1px solid #6264A7',
                                backgroundColor: rm.access?.canIngest ? '#6264A7' : 'white',
                                color: rm.access?.canIngest ? 'white' : '#6264A7',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                padding: '2px 8px',
                                fontWeight: '600'
                              }}
                              title={rm.access?.status === 'needs_permission' ? 'Bot will join and record now' : 'Ingest natively'}
                            >
                              {rm.access?.canIngest ? 'INGEST' : 'BOT JOIN'}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ borderBottom: '1px solid #E1DFDD', margin: '8px 0' }}></div>

          {/* Local / Ingested Meetings List */}
          <div className="sidebar-section" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="sidebar-title">Recorded Meetings</div>
            <div className="meeting-list">
              {meetings.map(m => (
                <div
                  key={m.meetingId}
                  className={`meeting-item ${selectedMeeting?.meetingId === m.meetingId ? 'active' : ''}`}
                  onClick={() => handleMeetingSelect(m)}
                >
                  <div className="meeting-item-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="meeting-item-title">{m.meetingId}</div>
                    <button
                      className="delete-btn"
                      onClick={(e) => { e.stopPropagation(); handleDeleteMeeting(m.meetingId); }}
                      style={{ background: 'none', border: 'none', color: '#dc3545', cursor: 'pointer', fontSize: '14px', position: 'absolute', right: '10px', top: '10px' }}
                      title="Delete Meeting"
                    >
                      ✘
                    </button>
                  </div>
                  <div className="meeting-item-meta">
                    {m.entries?.length || 0} segments • {new Date(m.importedAt || Date.now()).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ padding: '16px', borderTop: '1px solid #E1DFDD' }}>
              <button
                className="secondary"
                style={{ width: '100%', marginBottom: '8px', fontSize: '12px' }}
                onClick={() => document.getElementById('file-upload').click()}
              >
                Upload Transcript
              </button>
              <input id="file-upload" type="file" onChange={doUpload} style={{ display: 'none' }} />


            </div>
          </div>
        </div>

        {/* Main Content Stage */}
        <div className="content-stage">
          {selectedMeeting ? (
            <>
              <div className="stage-header">
                <div className="stage-title">{selectedMeeting.meetingId}</div>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '16px' }}>
                  Source: {selectedMeeting.source} | Duration: {selectedMeeting.durationSeconds || 'Unknown'}s
                </div>

                <div className="tabs">
                  <button className={`tab-btn ${view === 'overview' ? 'active' : ''}`} onClick={() => setView('overview')}>Transcript</button>
                  <button className={`tab-btn ${view === 'summary' ? 'active' : ''}`} onClick={() => { setView('summary'); getSummary(); }}>AI Summary</button>
                  <button className={`tab-btn ${view === 'actions' ? 'active' : ''}`} onClick={() => { setView('actions'); getActions(); }}>Action Items</button>
                  <button className={`tab-btn ${view === 'chat' ? 'active' : ''}`} onClick={() => setView('chat')}>☕︎ Chat</button>
                </div>
              </div>

              <div className="stage-content">
                {view === 'overview' && (
                  <div>
                    {selectedMeeting.recordingUrl && (
                      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <video controls width="100%" src={selectedMeeting.recordingUrl} style={{ display: 'block' }}>
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    )}

                    <div className="card">
                      <h4 style={{ marginBottom: '16px' }}>Transcript Preview</h4>
                      <div style={{ fontFamily: 'Segoe UI, sans-serif', fontSize: '13px', lineHeight: '1.6' }}>
                        {selectedMeeting.entries?.slice(0, 50).map((e, i) => (
                          <div key={i} style={{ marginBottom: '12px', display: 'flex', gap: '8px' }}>
                            <div className="transcript-speaker" style={{ fontWeight: '600', minWidth: '80px', color: 'var(--teams-purple)' }}>{e.speaker}</div>
                            <div style={{ color: 'var(--text-primary)' }}>{e.text}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '11px', minWidth: '40px', textAlign: 'right' }}>{e.start}</div>
                          </div>
                        ))}
                        {selectedMeeting.entries?.length > 50 && <div style={{ textAlign: 'center', padding: '10px', color: '#666', fontStyle: 'italic' }}>... {selectedMeeting.entries.length - 50} more entries ...</div>}
                      </div>
                    </div>
                  </div>
                )}

                {view === 'summary' && (
                  <div className="card">
                    {summary?.error ? (
                      <p style={{ color: '#a80000' }}>Error: {summary.error}</p>
                    ) : (
                      <div style={{ lineHeight: '1.6' }}>
                        {summary ? (
                          <div dangerouslySetInnerHTML={{ __html: summary.summary.replace(/\n/g, '<br/>') }} />
                        ) :
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div className="spinner"></div> Generating summary...
                          </div>
                        }
                      </div>
                    )}
                  </div>
                )}

                {view === 'actions' && (
                  <div className="card">
                    {actionItems?.error ? (
                      <p style={{ color: '#a80000' }}>Error: {actionItems.error}</p>
                    ) : (
                      <div style={{ width: '100%' }}>
                        {!actionItems ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>Generating action items...</div>
                        ) : (
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                            <thead>
                              <tr style={{ borderBottom: '2px solid #f0f0f0', textAlign: 'left' }}>
                                <th style={{ padding: '8px' }}>Task</th>
                                <th style={{ padding: '8px', width: '150px' }}>Owner</th>
                                <th style={{ padding: '8px', width: '100px' }}>Priority</th>
                              </tr>
                            </thead>
                            <tbody>
                              {actionItems.actionItems?.map((item, i) => (
                                <tr key={i} style={{ borderBottom: '1px solid #f9f9f9' }}>
                                  <td style={{ padding: '12px 8px' }}>{item.task}</td>
                                  <td style={{ padding: '12px 8px' }}>
                                    <span style={{ background: '#f0f0f0', padding: '2px 8px', borderRadius: '12px', fontSize: '11px' }}>{item.owner}</span>
                                  </td>
                                  <td style={{ padding: '12px 8px' }}>
                                    <span style={{
                                      color: item.priority?.toLowerCase().includes('high') ? '#d13438' : '#605e5c',
                                      fontWeight: item.priority?.toLowerCase().includes('high') ? '600' : '400'
                                    }}>
                                      {item.priority}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {view === 'chat' && (
                  <div className="chat-container">
                    <div className="chat-history">
                      {chatMessages.length === 0 && (
                        <div style={{ textAlign: 'center', color: '#666', marginTop: '40px' }}>
                          <p>Ask questions about this meeting transcript.</p>
                          <p style={{ fontSize: '12px' }}>Examples: "What did John say about the deadline?", "Summarize the budget discussion."</p>
                        </div>
                      )}

                      {chatMessages.map((m, i) => (
                        <div key={i} className={`chat-message ${m.role}`}>
                          <div className="message-role">{m.role === 'user' ? 'You' : 'MeetingAI'}</div>
                          <div className="message-bubble">
                            {m.content}
                            {m.sources && (
                              <div style={{ marginTop: '8px' }}>
                                {m.sources.map((s, si) => (
                                  <div key={si} className="source-citation">
                                    <div style={{ fontWeight: '600', marginBottom: '2px' }}>Source {si + 1}</div>
                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.text}</div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      <div ref={chatEndRef} />
                    </div>

                    <div className="chat-input-area">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={e => setChatInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && sendChat()}
                        placeholder="Type a message..."
                      />
                      <button className="primary" onClick={sendChat} style={{ padding: '8px 20px' }}>
                        Send
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="welcome-state">
              <div style={{ fontSize: '48px', color: '#E1DFDD', marginBottom: '16px' }}>☕︎</div>
              <h3>Select a meeting to begin</h3>
              <p>Choose a meeting from the sidebar or upload a new transcript.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
