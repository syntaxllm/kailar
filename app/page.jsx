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
  const chatEndRef = useRef(null);

  useEffect(() => {
    loadMeetings();
    checkLogin();
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
  }, []);

  useEffect(() => {
    if (view === 'chat' && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, view]);

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
        setRealMeetings(Array.isArray(data) ? data : []);
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

  async function ingestMeeting(teamsId) {
    setStatus('Ingesting meeting transcript...');
    const token = document.cookie.split('; ').find(row => row.startsWith('ms_token='))?.split('=')[1];

    const res = await fetch('/api/ingest/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, teamsMeetingId: teamsId })
    });

    if (res.ok) {
      await loadMeetings();
      setStatus('Ingest complete.');
      setTimeout(() => setStatus(''), 3000);
    } else {
      const err = await res.json();
      setStatus('Ingest failed: ' + err.error);
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
          <span style={{ fontSize: '20px' }}>⌯</span> MeetingAI Assistant
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

                  <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid #E1DFDD', borderRadius: '4px' }}>
                    {realMeetings.length === 0 ? (
                      <div style={{ padding: '8px', fontSize: '12px', color: '#666' }}>No recent meetings found.</div>
                    ) : (
                      realMeetings.map(rm => (
                        <div key={rm.id} style={{ padding: '8px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }} title={rm.subject}>{rm.subject}</span>
                          <button
                            onClick={() => ingestMeeting(rm.id)}
                            style={{ border: 'none', background: 'transparent', color: '#6264A7', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}
                            title="Ingest Transcript"
                          >
                            ⇓
                          </button>
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
                  <div className="meeting-item-title">{m.meetingId}</div>
                  <div className="meeting-item-meta">
                    {m.entries?.length || 0} segments • {new Date().toLocaleDateString()}
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
