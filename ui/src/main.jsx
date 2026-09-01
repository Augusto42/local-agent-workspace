import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const toolLabels = {
  web_search: 'Web search',
  web_fetch: 'Page fetched',
  list_files: 'Files listed',
  read_file: 'File read',
  create_directory: 'Directory created',
  create_file: 'File created',
  edit_file: 'File edited',
};

function Icon({ name, size = 18 }) {
  const props = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  const paths = {
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    refresh: <><path d="M20 11a8.1 8.1 0 1 0 .1 3" /><path d="M20 4v7h-7" /></>,
    folder: <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v8A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5z" /></>,
    file: <><path d="M6 2h8l4 4v16H6z" /><path d="M14 2v5h5M9 13h6M9 17h5" /></>,
    send: <><path d="m22 2-7 20-4-9-9-4z" /><path d="M22 2 11 13" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    error: <><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" /></>,
    chevron: <><path d="m9 6 6 6-6 6" /></>,
    terminal: <><path d="m4 7 5 5-5 5M11 17h8" /></>,
  };
  return <svg {...props}>{paths[name]}</svg>;
}

function FileNode({ node, onOpen, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const isFolder = node.type === 'directory';
  return (
    <div>
      <button
        className="file-row"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        onClick={() => isFolder ? setExpanded(!expanded) : onOpen(node)}
        title={node.path}
      >
        <span className={`disclosure ${isFolder && expanded ? 'open' : ''}`}>{isFolder ? <Icon name="chevron" size={13} /> : null}</span>
        <Icon name={isFolder ? 'folder' : 'file'} size={17} />
        <span>{node.name}</span>
      </button>
      {isFolder && expanded && node.children?.map((child) => <FileNode key={child.path} node={child} onOpen={onOpen} depth={depth + 1} />)}
    </div>
  );
}

function MessageContent({ text }) {
  const parts = useMemo(() => text.split(/(https?:\/\/[^\s)\]]+)/g), [text]);
  return <div className="message-content">{parts.map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer">{part}</a> : <React.Fragment key={index}>{part}</React.Fragment>)}</div>;
}

function App() {
  const [files, setFiles] = useState([]);
  const [config, setConfig] = useState({ app_name: 'Local Agent Workspace', tagline: 'Research the web and work inside one approved folder.', model_label: 'Local model' });
  const [workspace, setWorkspace] = useState('Loading workspace...');
  const [messages, setMessages] = useState([]);
  const [trace, setTrace] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [leftOpen, setLeftOpen] = useState(() => window.innerWidth > 720);
  const [rightOpen, setRightOpen] = useState(() => window.innerWidth > 1050);
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const workspaceLabel = workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace;

  const refreshFiles = async () => {
    try {
      const response = await fetch('/api/files');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not list files.');
      setFiles(data.entries || []);
      setWorkspace(data.workspace || 'Workspace unavailable');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    const load = async () => {
      const [configResponse, filesResponse] = await Promise.all([fetch('/api/config'), fetch('/api/files')]);
      const [configData, filesData] = await Promise.all([configResponse.json(), filesResponse.json()]);
      if (!configResponse.ok) throw new Error(configData.error || 'Could not load configuration.');
      if (!filesResponse.ok) throw new Error(filesData.error || 'Could not list files.');
      setConfig(configData);
      setFiles(filesData.entries || []);
      setWorkspace(filesData.workspace || 'Workspace unavailable');
      document.title = configData.app_name || 'Local Agent Workspace';
    };
    load().catch((err) => setError(err.message));
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const openFile = async (node) => {
    try {
      const response = await fetch(`/api/file?path=${encodeURIComponent(node.path)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not open the file.');
      setPreview(data);
    } catch (err) {
      setError(err.message);
    }
  };

  const send = async () => {
    const value = prompt.trim();
    if (!value || busy) return;
    const nextMessages = [...messages, { role: 'user', content: value }];
    setMessages(nextMessages);
    setPrompt('');
    setBusy(true);
    setError('');
    textareaRef.current?.focus();
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: nextMessages.map(({ role, content }) => ({ role, content })) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The agent request failed.');
      setMessages((current) => [...current, { role: 'assistant', content: data.content }]);
      setTrace((current) => [...current, ...(data.trace || []).map((item) => ({ ...item, time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }))]);
      if ((data.trace || []).some((item) => ['create_file', 'edit_file', 'create_directory'].includes(item.name))) refreshFiles();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  const startNewChat = () => {
    if (busy) return;
    setMessages([]);
    setTrace([]);
    setPrompt('');
    setError('');
    setPreview(null);
    textareaRef.current?.focus();
  };

  return (
    <div className={`app-shell ${leftOpen ? '' : 'left-closed'} ${rightOpen ? '' : 'right-closed'}`}>
      <header className="topbar">
        <button className="icon-button" onClick={() => setLeftOpen(!leftOpen)} aria-label="Toggle files"><Icon name="menu" size={20} /></button>
        <strong>{config.app_name}</strong>
        <span className="local-status"><span />Local</span>
        <span className="top-separator" />
        <span className="model-label">{config.model_label}</span>
        <button className="new-chat-button" onClick={startNewChat} disabled={busy} aria-label="New chat" title="Clear the context and start a new chat"><Icon name="plus" size={17} /><span>New chat</span></button>
        <button className="activity-toggle" onClick={() => setRightOpen(!rightOpen)}>Activity</button>
      </header>

      <aside className="files-panel">
        <div className="panel-heading">
          <div><h2>Files</h2><p title={workspace}>{workspaceLabel}</p></div>
          <button className="icon-button" onClick={refreshFiles} aria-label="Refresh files"><Icon name="refresh" /></button>
        </div>
        <div className="file-tree">
          {files.length ? files.map((node) => <FileNode key={node.path} node={node} onOpen={openFile} />) : <p className="empty-note">The workspace is empty.</p>}
        </div>
        <div className="panel-footer"><Icon name="folder" size={16} /> {files.length} items</div>
      </aside>

      <main className="chat-panel">
        <div className="conversation">
          {messages.length === 0 && (
            <section className="welcome">
              <Icon name="terminal" size={48} />
              <h1>{config.tagline}</h1>
              <p>File changes stay inside the approved workspace.</p>
            </section>
          )}
          {messages.map((message, index) => (
            <article key={index} className={`message ${message.role}`}>
              <div className="message-meta"><strong>{message.role === 'user' ? 'You' : config.app_name}</strong></div>
              <MessageContent text={message.content} />
            </article>
          ))}
          {busy && <article className="message assistant thinking"><div className="message-meta"><strong>{config.app_name}</strong></div><div className="thinking-line"><span /><span /><span /> Researching and working...</div></article>}
          <div ref={endRef} />
        </div>
        {error && <div className="error-banner"><Icon name="error" /><span>{error}</span><button onClick={() => setError('')}><Icon name="close" size={16} /></button></div>}
        <div className="composer-wrap">
          <textarea ref={textareaRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKeyDown} placeholder="Ask for research or a file change..." rows={3} disabled={busy} />
          <div className="composer-actions">
            <span className="permission-note">Public web + approved workspace</span>
            <button className="send-button" onClick={send} disabled={busy || !prompt.trim()} aria-label="Send"><Icon name="send" size={21} /></button>
          </div>
        </div>
      </main>

      <aside className="activity-panel">
        <div className="panel-heading"><div><h2>Activity</h2><p>Tools used by the model</p></div></div>
        <div className="activity-list">
          {trace.length ? [...trace].reverse().map((item, index) => (
            <div className={`activity-item ${item.status}`} key={`${item.time}-${index}`}>
              <span className="activity-mark"><Icon name={item.status === 'success' ? 'check' : 'error'} size={15} /></span>
              <div><div className="activity-title"><strong>{toolLabels[item.name] || item.name}</strong><time>{item.time}</time></div><p>{item.detail}</p></div>
            </div>
          )) : <p className="empty-note">Research and file changes will appear here.</p>}
        </div>
        <button className="clear-activity" onClick={() => setTrace([])} disabled={!trace.length}><Icon name="trash" size={16} /> Clear activity</button>
      </aside>

      {preview && (
        <div className="modal-backdrop" onMouseDown={() => setPreview(null)}>
          <section className="file-preview" onMouseDown={(event) => event.stopPropagation()}>
            <header><div><strong>{preview.path}</strong><span>Read-only preview</span></div><button className="icon-button" onClick={() => setPreview(null)} aria-label="Close preview"><Icon name="close" /></button></header>
            <pre>{preview.content}</pre>
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
