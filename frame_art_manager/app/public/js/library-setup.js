// First-run library setup: connect an empty library folder to a GitHub repo.
// Talks to routes/setup.js. Shown on its own only when the library folder is not a
// git repo and holds nothing but the app's startup skeleton; a folder that is already
// a repo never sees it. "Set up later" hides it; Advanced > Settings reopens it.
(function () {
  const SETUP_API = 'api/setup';
  const DISMISS_KEY = 'frameArt.librarySetupDismissed';
  const REPO_PATTERN = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  const POLL_MS = 2000;

  let status = null;
  let testedRepo = null; // repo the last successful test was for
  let polling = null;

  const el = (id) => document.getElementById(id);

  function normalizeRepo(value) {
    return String(value || '').trim().replace(/\.git$/, '');
  }

  function isValidRepo(repo) {
    if (!REPO_PATTERN.test(repo) || repo.includes('..')) return false;
    const name = repo.split('/')[1];
    return !name.startsWith('.') && !name.startsWith('-');
  }

  function isDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  }

  function setDismissed(value) {
    try {
      if (value) localStorage.setItem(DISMISS_KEY, '1');
      else localStorage.removeItem(DISMISS_KEY);
    } catch { /* storage unavailable: the screen just shows again next time */ }
  }

  function setResult(target, kind, message, detail) {
    target.className = `library-setup-result ${kind ? `library-setup-result-${kind}` : ''}`;
    target.textContent = '';
    if (!message) return;
    const text = document.createElement('div');
    text.textContent = message;
    target.appendChild(text);
    if (detail) {
      const pre = document.createElement('pre');
      pre.textContent = detail;
      target.appendChild(pre);
    }
  }

  function openOverlay() {
    el('library-setup').classList.remove('hidden');
    document.body.classList.add('library-setup-open');
  }

  function closeOverlay() {
    el('library-setup').classList.add('hidden');
    document.body.classList.remove('library-setup-open');
  }

  function updateRepoDependentUi() {
    const repo = normalizeRepo(el('library-setup-repo').value);
    const valid = isValidRepo(repo);
    const link = el('library-setup-keys-link');
    if (valid) {
      const [owner, name] = repo.split('/');
      link.href = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/settings/keys/new`;
      link.classList.remove('disabled');
      link.removeAttribute('aria-disabled');
    } else {
      link.removeAttribute('href');
      link.classList.add('disabled');
      link.setAttribute('aria-disabled', 'true');
    }
    el('library-setup-repo-error').textContent =
      repo && !valid ? 'Use the form owner/name, for example your-user/frame_art.' : '';
    el('library-setup-test').disabled = !valid || isJobRunning();
    const canConnect = Boolean(status && status.canConnect) && testedRepo === repo && !isJobRunning();
    el('library-setup-connect').disabled = !canConnect;
  }

  function isJobRunning() {
    return Boolean(status && status.connectJob && status.connectJob.status === 'running');
  }

  function renderKey() {
    const keyBox = el('library-setup-key-box');
    const note = el('library-setup-key-note');
    if (status.publicKey) {
      el('library-setup-key').value = status.publicKey;
      keyBox.classList.remove('hidden');
      note.textContent = '';
    } else {
      keyBox.classList.add('hidden');
      note.textContent = status.keySource === 'config'
        ? 'This add-on uses the SSH key from its configuration (ssh_private_key). Add the public half of that key as the deploy key.'
        : 'No SSH key is available. Restart the add-on to generate one, then reopen this screen.';
    }
  }

  function render() {
    el('library-setup-path').textContent = status.frameArtPath || '';
    const blocked = el('library-setup-blocked');
    if (status.canConnect) {
      blocked.classList.add('hidden');
      blocked.textContent = '';
    } else {
      blocked.classList.remove('hidden');
      blocked.textContent = status.reason || 'This library folder cannot be connected automatically.';
      if (status.userFiles && status.userFiles.length) {
        const list = document.createElement('code');
        list.textContent = ` Found: ${status.userFiles.join(', ')}`;
        blocked.appendChild(list);
      }
    }
    renderKey();
    renderJob();
    updateRepoDependentUi();
  }

  function renderJob() {
    const job = status.connectJob;
    const progress = el('library-setup-progress');
    if (!job) return;
    if (job.repo && !el('library-setup-repo').value) {
      el('library-setup-repo').value = job.repo;
    }
    if (job.status === 'running') {
      setResult(progress, 'pending', `${job.step || 'Working'}…`);
    } else if (job.status === 'failed') {
      setResult(progress, 'error', 'Connecting the library failed.', job.message);
    } else if (job.status === 'succeeded') {
      setResult(progress, job.warning ? 'warning' : 'success',
        job.warning ? `${job.message} ${job.warning}` : `${job.message} Reloading…`);
    }
  }

  async function fetchStatus() {
    const response = await fetch(`${SETUP_API}/status`);
    if (!response.ok) throw new Error(`Setup status failed (${response.status})`);
    status = await response.json();
    return status;
  }

  async function postJson(path, body) {
    const response = await fetch(`${SETUP_API}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch { /* non-JSON error page */ }
    return { response, data };
  }

  async function testConnection() {
    const repo = normalizeRepo(el('library-setup-repo').value);
    const result = el('library-setup-test-result');
    testedRepo = null;
    el('library-setup-test').disabled = true;
    updateRepoDependentUi();
    setResult(result, 'pending', 'Testing…');
    try {
      const { data } = await postJson('test', { repo });
      if (data.success) {
        testedRepo = repo;
        setResult(result, 'success', data.message);
        el('library-setup-connect-hint').textContent = data.state === 'empty'
          ? 'The repository is empty: a new library will be created in it.'
          : 'The repository has a library: it will be downloaded into this add-on.';
      } else {
        setResult(result, 'error', data.message || 'The test failed.', data.detail);
      }
    } catch (error) {
      setResult(result, 'error', `The test failed: ${error.message}`);
    } finally {
      updateRepoDependentUi();
    }
  }

  async function connectLibrary() {
    const repo = normalizeRepo(el('library-setup-repo').value);
    const progress = el('library-setup-progress');
    el('library-setup-connect').disabled = true;
    el('library-setup-test').disabled = true;
    setResult(progress, 'pending', 'Starting…');
    try {
      const { response, data } = await postJson('connect', { repo });
      if (response.status !== 202) {
        setResult(progress, 'error', data.message || 'Connecting the library failed.', data.detail);
        testedRepo = null;
        updateRepoDependentUi();
        return;
      }
      status.connectJob = data.connectJob;
      startPolling();
    } catch (error) {
      setResult(progress, 'error', `Connecting the library failed: ${error.message}`);
      updateRepoDependentUi();
    }
  }

  function startPolling() {
    if (polling) return;
    polling = setInterval(async () => {
      try {
        await fetchStatus();
      } catch {
        return; // transient; try again on the next tick
      }
      render();
      const job = status.connectJob;
      if (!job || job.status === 'running') return;
      clearInterval(polling);
      polling = null;
      if (job.status === 'succeeded') {
        setDismissed(false);
        if (job.warning) {
          el('library-setup-reload').classList.remove('hidden');
        } else {
          setTimeout(() => window.location.reload(), 1500);
        }
      } else {
        testedRepo = null;
        updateRepoDependentUi();
      }
    }, POLL_MS);
  }

  async function copyKey() {
    const textarea = el('library-setup-key');
    const button = el('library-setup-copy');
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(textarea.value);
        copied = true;
      }
    } catch { /* fall back below */ }
    if (!copied) {
      textarea.focus();
      textarea.select();
      try { copied = document.execCommand('copy'); } catch { copied = false; }
    }
    button.textContent = copied ? 'Copied' : 'Select and copy';
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  }

  function renderSettingsEntry() {
    const section = el('library-sync-setup-section');
    if (!section) return;
    section.classList.toggle('hidden', !status.needsSetup);
  }

  function bind() {
    el('library-setup-repo').addEventListener('input', () => {
      testedRepo = null;
      setResult(el('library-setup-test-result'), '', '');
      el('library-setup-connect-hint').textContent = 'Test the connection first.';
      updateRepoDependentUi();
    });
    el('library-setup-repo').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !el('library-setup-test').disabled) testConnection();
    });
    el('library-setup-test').addEventListener('click', testConnection);
    el('library-setup-connect').addEventListener('click', connectLibrary);
    el('library-setup-copy').addEventListener('click', copyKey);
    el('library-setup-keys-link').addEventListener('click', (event) => {
      if (el('library-setup-keys-link').classList.contains('disabled')) event.preventDefault();
    });
    el('library-setup-reload').addEventListener('click', () => window.location.reload());
    const later = () => {
      setDismissed(true);
      closeOverlay();
    };
    el('library-setup-later').addEventListener('click', later);
    el('library-setup-close').addEventListener('click', later);
    const openBtn = el('open-library-setup-btn');
    if (openBtn) {
      openBtn.addEventListener('click', async () => {
        try { await fetchStatus(); } catch { /* keep the last status */ }
        if (!status) return;
        render();
        openOverlay();
      });
    }
  }

  async function init() {
    if (!el('library-setup')) return;
    bind();
    try {
      await fetchStatus();
    } catch (error) {
      console.warn('Library setup status unavailable:', error.message);
      return;
    }
    renderSettingsEntry();
    if (!status.needsSetup) return;
    render();
    if (isJobRunning()) {
      openOverlay();
      startPolling();
    } else if (status.canConnect && !isDismissed()) {
      openOverlay();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
