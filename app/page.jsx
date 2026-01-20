'use client';
import { useEffect, useState } from 'react';

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

  useEffect(() => {
    loadMeetings();
    checkLogin();
  }, []);

  async function loadMeetings() {
    const res = await fetch('/api/transcripts');
    const data = await res.json();
    setMeetings(data || []);
  }

  async function doImport() {
    setStatus('Importing...');
    await fetch('/api/import-mock', { method: 'POST' });
    await loadMeetings();
    setStatus('Imported samples.');
  }

  function checkLogin() {
    const hasToken = document.cookie.includes('ms_token');
    setIsLoggedIn(hasToken);
    if (hasToken) loadRealMeetings();
  }

  async function loadRealMeetings() {
    setStatus('Loading recent meetings...');
    try {
      const res = await fetch('/api/teams/recent');
      if (res.ok) {
        const data = await res.json();
        setRealMeetings(Array.isArray(data) ? data : []);
        setStatus('');
      } else {
        const err = await res.json();
        setStatus('Failed to load Teams meetings: ' + (err.error || res.statusText));
      }
    } catch (e) {
      console.error(e);
      setStatus('Network error loading meetings.');
    }
  }

  async function ingestMeeting(teamsId) {
    setStatus('Ingesting from Teams...');
    const token = document.cookie.split('; ').find(row => row.startsWith('ms_token='))?.split('=')[1];

    const res = await fetch('/api/ingest/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: token, teamsMeetingId: teamsId })
    });

    if (res.ok) {
      await loadMeetings();
      setStatus('Success! Meeting ingested.');
    } else {
      const err = await res.json();
      setStatus('Failed: ' + err.error);
    }
  }


  async function doUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setStatus('Uploading...');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.success) {
      await loadMeetings();
      setStatus('Uploaded: ' + data.meetingId);
    } else {
      setStatus('Error: ' + data.error);
    }
  }

  async function getSummary() {
    setStatus('Generating summary...');
    const res = await fetch(`/api/summary/${selectedMeeting.meetingId}`);
    setSummary(await res.json());
    setStatus('');
  }

  async function getActions() {
    setStatus('Extracting actions...');
    const res = await fetch(`/api/actions/${selectedMeeting.meetingId}`);
    setActionItems(await res.json());
    setStatus('');
  }

  async function sendChat() {
    if (!chatInput) return;
    const msg = { role: 'user', content: chatInput };
    setChatMessages([...chatMessages, msg]);
    setChatInput('');
    setStatus('Thinking...');
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

  return (
    <div>
      <h1>MeetingAI (First Shell)</h1>
      <p>Status: {status || 'Ready'}</p>

      <div style={{ display: 'flex', gap: '20px' }}>
        {/* Sidebar */}
        <div style={{ width: '350px' }}>
          <h3>Real-World Sync</h3>
          {!isLoggedIn ? (
            <button onClick={() => window.location.href = '/api/auth/login'} style={{ background: '#0078d4', color: 'white', border: 'none', padding: '10px' }}>
              Login with Microsoft
            </button>
          ) : (
            <div>
              <p>Connected to Teams</p>
              <button onClick={() => { document.cookie = 'ms_token=; Max-Age=0'; setIsLoggedIn(false); }}>Logout</button>
              <h4>Recent Meetings</h4>
              <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid #eee', padding: '5px' }}>
                {realMeetings.length === 0 ? <p style={{ padding: '10px', color: '#666', fontStyle: 'italic' }}>No recent online meetings found (Last 7 Days).</p> : realMeetings.map(rm => (
                  <div key={rm.id} style={{ fontSize: '0.8em', marginBottom: '10px', borderBottom: '1px solid #fafafa' }}>
                    <strong>{rm.subject}</strong><br />
                    <button onClick={() => ingestMeeting(rm.id)}>Ingest This Meeting</button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <hr />
          <h3>Local Controls</h3>
          <button onClick={doImport}>Import Mock Data</button>

          <input type="file" onChange={doUpload} />
          <hr />
          <h3>Meetings</h3>
          {meetings.map(m => (
            <div
              key={m.meetingId}
              className={`meeting-item ${selectedMeeting?.meetingId === m.meetingId ? 'active-meeting' : ''}`}
              onClick={() => { setSelectedMeeting(m); setView('overview'); setChatMessages([]); setSummary(null); setActionItems(null); }}
            >
              <strong>{m.meetingId}</strong><br />
              <small>{m.entries?.length || 0} entries | {m.source}</small>
            </div>
          ))}
        </div>

        {/* Main */}
        <div style={{ flex: 1 }}>
          {selectedMeeting ? (
            <>
              <h2>Meeting: {selectedMeeting.meetingId}</h2>
              <div className="tabs">
                <button onClick={() => setView('overview')}>Overview</button>
                <button onClick={() => { setView('summary'); if (!summary) getSummary(); }}>Summary</button>
                <button onClick={() => { setView('actions'); if (!actionItems) getActions(); }}>Actions</button>
                <button onClick={() => setView('chat')}>Chat</button>
              </div>

              <div className="tab-content">
                {view === 'overview' && (
                  <div>
                    <p><strong>Source:</strong> {selectedMeeting.source}</p>
                    <p><strong>Duration:</strong> {selectedMeeting.durationSeconds}s</p>

                    {selectedMeeting.recordingUrl && (
                      <div style={{ margin: '20px 0', background: '#000', padding: '10px', borderRadius: '8px' }}>
                        <h4 style={{ color: '#fff', marginTop: 0 }}>Meeting Recording</h4>
                        <video controls width="100%" src={selectedMeeting.recordingUrl}>
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    )}

                    <h3>Transcript (First 20)</h3>
                    {selectedMeeting.entries?.slice(0, 20).map((e, i) => (
                      <div key={i} style={{ marginBottom: '5px' }}>
                        <code>[{e.start}] <strong>{e.speaker}</strong>:</code> {e.text}
                      </div>
                    ))}
                  </div>
                )}

                {view === 'summary' && (
                  <div>
                    {summary?.error ? <p style={{ color: 'red' }}>{summary.error}</p> : <pre>{summary?.summary || 'No summary yet.'}</pre>}
                  </div>
                )}

                {view === 'actions' && (
                  <div>
                    {actionItems?.error ? <p style={{ color: 'red' }}>{actionItems.error}</p> : (
                      <ul>
                        {actionItems?.actionItems?.map((item, i) => (
                          <li key={i}>
                            <strong>{item.task}</strong> ({item.owner}) - <em>{item.priority}</em>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {view === 'chat' && (
                  <div>
                    <div style={{ height: '400px', overflowY: 'auto', border: '1px solid #ddd', padding: '10px', marginBottom: '10px', background: '#fff' }}>
                      {chatMessages.map((m, i) => (
                        <div key={i} style={{ marginBottom: '15px' }}>
                          <div><strong>{m.role}:</strong> {m.content}</div>
                          {m.sources && (
                            <div style={{ fontSize: '0.8em', color: '#666', marginTop: '5px', paddingLeft: '10px', borderLeft: '2px solid #ddd' }}>
                              <strong>RAG Sources:</strong> {m.sources.map((s, si) => (
                                <div key={si} style={{ marginBottom: '3px' }}>• {s.text.substring(0, 100)}...</div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <input style={{ width: '80%' }} value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask about meeting..." />
                    <button onClick={sendChat}>Send</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p>Select a meeting from the sidebar.</p>
          )}
        </div>
      </div>
    </div>
  );
}
