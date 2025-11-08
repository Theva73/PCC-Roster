
/*! Roster Activity Log Add‑On (auto-updating)
 *  Drop-in module that instruments common actions in your roster app
 *  without modifying existing handlers. Saves to localStorage and,
 *  if Firebase is present and authenticated, also writes to Firestore.
 *  Version: 2025-11-09
 */
(function () {
  'use strict';

  // ---- Helpers -------------------------------------------------------------
  const LS_KEY = 'roster_activity_log_v1';
  const MAX_ENTRIES = 1000; // keep a rolling buffer

  function nowIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2,'0');
    return (
      d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
    );
  }

  function readLS() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn('[Log] Failed to read localStorage', e);
      return [];
    }
  }

  function writeLS(arr) {
    try {
      const kept = (arr || []).slice(-MAX_ENTRIES);
      localStorage.setItem(LS_KEY, JSON.stringify(kept));
    } catch (e) {
      console.warn('[Log] Failed to write localStorage', e);
    }
  }

  function serialize(obj, maxLen = 200) {
    try {
      const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
      return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
    } catch (e) {
      return String(obj);
    }
  }

  // ---- Firebase adapter (optional) -----------------------------------------
  async function writeFirestore(entry) {
    try {
      const hasFirebase = typeof window !== 'undefined'
        && window.firebase && window.firebase.firestore && window.firebase.auth;
      if (!hasFirebase) return;

      const user = window.firebase.auth().currentUser;
      const db = window.firebase.firestore();
      const payload = {
        ts: new Date(),
        ts_iso: entry.ts,
        action: entry.action,
        who: user ? (user.email || user.uid || 'anonymous') : 'anonymous',
        details: entry.details || null,
        meta: entry.meta || null
      };
      await db.collection('roster_activity_log').add(payload);
    } catch (e) {
      console.warn('[Log] Firestore write failed', e);
    }
  }

  // ---- Core logging API ----------------------------------------------------
  function pushEntry(action, details, meta) {
    const entry = {
      ts: nowIso(),
      action: action || 'event',
      details: details || '',
      meta: meta || null
    };
    const arr = readLS();
    arr.push(entry);
    writeLS(arr);
    writeFirestore(entry);
    renderIfOpen(); // live update modal if open
    return entry;
  }

  // Expose a safe global
  window.RosterLog = window.RosterLog || {};
  window.RosterLog.log = pushEntry;
  window.RosterLog.getAll = readLS;
  window.RosterLog.clear = function () { writeLS([]); renderIfOpen(); };
  window.RosterLog.exportJSON = function () {
    const blob = new Blob([JSON.stringify(readLS(), null, 2)], {type:'application/json'});
    triggerDownload(blob, 'roster_activity_log.json');
  };
  window.RosterLog.exportTXT = function () {
    const lines = readLS().map(e => `[${e.ts}] ${e.action} — ${serialize(e.details, 200)}`);
    const blob = new Blob([lines.join('\n')], {type:'text/plain'});
    triggerDownload(blob, 'roster_activity_log.txt');
  };

  function triggerDownload(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  }

  // ---- UI injection: Activity Log modal & Manage-menu item -----------------
  function ensureStyles() {
    if (document.getElementById('activity-log-styles')) return;
    const css = `
      #activity-log-modal .log-table { width:100%; border-collapse: collapse; }
      #activity-log-modal .log-table th, #activity-log-modal .log-table td {
        border: 1px solid #e5e7eb; padding: 6px 8px; font-size: 12px;
        vertical-align: top;
      }
      #activity-log-modal .log-table th { background: #f3f4f6; text-align:left; }
      #activity-log-modal .pill { font-size:10px; padding:2px 6px; border-radius:9999px; background:#eef2ff; }
      #activity-log-modal .controls { display:flex; gap:8px; align-items:center; }
      #activity-log-modal .muted { color:#6b7280; }
      #activity-log-backdrop { position: fixed; inset:0; background: rgba(17,24,39,.6); display:none; z-index: 70; }
      #activity-log-modal { position: fixed; inset: 40px 10px 10px 10px; max-width: 960px; margin: auto; background: #fff; border-radius: 16px; box-shadow: 0 25px 50px rgba(0,0,0,.25); display:none; z-index: 75; padding: 16px; overflow: auto; }
      #activity-log-modal header { display:flex; justify-content: space-between; align-items:center; margin-bottom: 8px; }
      #activity-log-modal h3 { font-size: 18px; font-weight: 700; }
      #activity-log-modal .btn { padding:6px 10px; border-radius:8px; background:#4f46e5; color:#fff; border:none; cursor:pointer; }
      #activity-log-modal .btn.secondary { background:#6b7280; }
      #activity-log-modal .btn.danger { background:#dc2626; }
      @media (max-width: 640px) {
        #activity-log-modal { inset: 20px 6px 6px 6px; }
        #activity-log-modal .log-table th, #activity-log-modal .log-table td { font-size: 11px; }
      }
      @media print {
        #activity-log-backdrop, #activity-log-modal { display: none !important; }
      }
    `;
    const style = document.createElement('style');
    style.id = 'activity-log-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function injectMenuItem() {
    const btnId = 'activity-log-open-btn';
    if (document.getElementById(btnId)) return;
    const manage = document.getElementById('manage-dropdown');
    if (!manage) return;
    const btn = document.createElement('button');
    btn.id = btnId;
    btn.className = 'w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100 transition duration-150';
    btn.textContent = 'Activity Log';
    btn.addEventListener('click', openModal);
    // insert at top
    manage.insertBefore(btn, manage.firstChild);
  }

  function ensureModal() {
    if (document.getElementById('activity-log-modal')) return;
    const backdrop = document.createElement('div');
    backdrop.id = 'activity-log-backdrop';
    backdrop.addEventListener('click', closeModal);

    const modal = document.createElement('div');
    modal.id = 'activity-log-modal';
    modal.innerHTML = `
      <header>
        <h3>Activity Log</h3>
        <div class="controls">
          <label class="muted"><input id="activity-log-autorefresh" type="checkbox" checked> Auto-refresh</label>
          <button class="btn secondary" id="activity-log-download-json">Download JSON</button>
          <button class="btn secondary" id="activity-log-download-txt">Download TXT</button>
          <button class="btn danger" id="activity-log-clear">Clear</button>
          <button class="btn" id="activity-log-close" title="Close">Close</button>
        </div>
      </header>
      <div class="muted" style="margin-bottom:8px">Newest entries at the bottom. Keeping the last ${MAX_ENTRIES.toLocaleString()} events.</div>
      <table class="log-table">
        <thead>
          <tr><th style="width:160px">Time</th><th style="width:180px">Action</th><th>Details</th></tr>
        </thead>
        <tbody id="activity-log-body"></tbody>
      </table>
    `;
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    document.getElementById('activity-log-close').addEventListener('click', closeModal);
    document.getElementById('activity-log-clear').addEventListener('click', () => {
      if (confirm('Clear local activity log?')) window.RosterLog.clear();
    });
    document.getElementById('activity-log-download-json').addEventListener('click', () => window.RosterLog.exportJSON());
    document.getElementById('activity-log-download-txt').addEventListener('click', () => window.RosterLog.exportTXT());
  }

  function openModal() {
    ensureStyles();
    ensureModal();
    render();
    document.getElementById('activity-log-backdrop').style.display = 'block';
    document.getElementById('activity-log-modal').style.display = 'block';
  }
  function closeModal() {
    const b = document.getElementById('activity-log-backdrop');
    const m = document.getElementById('activity-log-modal');
    if (b) b.style.display = 'none';
    if (m) m.style.display = 'none';
  }

  function render() {
    const body = document.getElementById('activity-log-body');
    if (!body) return;
    const rows = readLS().map(e => {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = e.ts;
      const td2 = document.createElement('td');
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.textContent = e.action;
      td2.appendChild(pill);
      const td3 = document.createElement('td');
      td3.textContent = (typeof e.details === 'string') ? e.details : JSON.stringify(e.details);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
      return tr;
    });
    body.replaceChildren(...rows);
  }

  let timer = null;
  function renderIfOpen() {
    const m = document.getElementById('activity-log-modal');
    const auto = document.getElementById('activity-log-autorefresh');
    if (m && m.style.display === 'block') {
      if (!auto || auto.checked) render();
    }
  }

  // ---- Instrumentation (event hooks) ---------------------------------------
  function installHooks() {
    // Add menu item once dropdown exists
    const obs = new MutationObserver(() => injectMenuItem());
    obs.observe(document.body, { childList: true, subtree: true });

    // 1) Add Employee
    const addEmpForm = document.getElementById('add-employee-form');
    if (addEmpForm && !addEmpForm.__logHooked) {
      addEmpForm.__logHooked = true;
      addEmpForm.addEventListener('submit', (ev) => {
        const svc = document.getElementById('emp-service-id')?.value || '';
        const eid = document.getElementById('emp-short-id')?.value || '';
        const name = document.getElementById('emp-name')?.value || '';
        pushEntry('Add Employee', { service_id: svc, emp_id: eid, name });
      }, { capture: true });
    }

    // 2) Delete Employee (single)
    const delConfirm = document.getElementById('confirm-delete-btn');
    if (delConfirm && !delConfirm.__logHooked) {
      delConfirm.__logHooked = true;
      delConfirm.addEventListener('click', () => {
        const name = document.getElementById('delete-modal-name')?.textContent || '';
        const svc  = document.getElementById('delete-modal-id')?.textContent || '';
        pushEntry('Delete Employee', { service_id: svc, name });
      }, { capture: true });
    }

    // 3) Batch Delete
    const batchDel = document.getElementById('confirm-batch-delete-btn');
    if (batchDel && !batchDel.__logHooked) {
      batchDel.__logHooked = true;
      batchDel.addEventListener('click', () => {
        const list = Array.from(document.querySelectorAll('#batch-delete-list li')).map(li => li.textContent.trim());
        pushEntry('Batch Delete Employees', { count: list.length, list });
      }, { capture: true });
    }

    // 4) Manage Labels (create/edit)
    const addLabelForm = document.getElementById('add-label-form');
    if (addLabelForm && !addLabelForm.__logHooked) {
      addLabelForm.__logHooked = true;
      addLabelForm.addEventListener('submit', () => {
        const txt = document.getElementById('new-label-text')?.value || '';
        const hrs = document.getElementById('new-label-hours')?.value || '';
        const color = document.getElementById('new-label-color')?.value || '';
        pushEntry('Create Label', { label: txt, hours: hrs, color });
      }, { capture: true });
    }
    const editLabelForm = document.getElementById('edit-label-form');
    if (editLabelForm && !editLabelForm.__logHooked) {
      editLabelForm.__logHooked = true;
      editLabelForm.addEventListener('submit', () => {
        const key = document.getElementById('edit-label-key')?.value || '';
        const txt = document.getElementById('edit-label-text')?.value || '';
        const hrs = document.getElementById('edit-label-hours')?.value || '';
        const color = document.getElementById('edit-label-color')?.value || '';
        pushEntry('Edit Label', { key, label: txt, hours: hrs, color });
      }, { capture: true });
    }

    // 5) Manage Teams (create/edit)
    const addTeamForm = document.getElementById('add-team-form');
    if (addTeamForm && !addTeamForm.__logHooked) {
      addTeamForm.__logHooked = true;
      addTeamForm.addEventListener('submit', () => {
        const name = document.getElementById('new-team-name')?.value || '';
        pushEntry('Create Team', { team: name });
      }, { capture: true });
    }
    const editTeamForm = document.getElementById('edit-team-form');
    if (editTeamForm && !editTeamForm.__logHooked) {
      editTeamForm.__logHooked = true;
      editTeamForm.addEventListener('submit', () => {
        const id = document.getElementById('edit-team-id')?.value || '';
        const name = document.getElementById('edit-team-name')?.value || '';
        const len = document.getElementById('edit-team-pattern-length')?.value || '';
        const anchor = document.getElementById('edit-team-anchor-date')?.value || '';
        pushEntry('Edit Team', { team_id: id, name, pattern_length: len, anchor_date: anchor });
      }, { capture: true });
    }
    const delTeamBtn = document.getElementById('confirm-delete-team-btn');
    if (delTeamBtn && !delTeamBtn.__logHooked) {
      delTeamBtn.__logHooked = true;
      delTeamBtn.addEventListener('click', () => {
        const tname = document.getElementById('delete-team-modal-name')?.textContent || '';
        pushEntry('Delete Team', { team: tname });
      }, { capture: true });
    }

    // 6) Shift assignments (manual / auto)
    const shiftOptions = document.getElementById('shift-options');
    if (shiftOptions && !shiftOptions.__logHooked) {
      shiftOptions.__logHooked = true;
      shiftOptions.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const label = (btn.textContent || '').trim();
        const date = document.getElementById('modal-date')?.textContent || '';
        const name = document.getElementById('modal-employee-name-input')?.value || '';
        const empId = document.getElementById('modal-employee-id-input')?.value || '';
        pushEntry('Set Shift', { date, employee: name, emp_id: empId, label });
      }, { capture: true });
    }
    const setAutoBtn = document.getElementById('set-auto-shift-btn');
    if (setAutoBtn && !setAutoBtn.__logHooked) {
      setAutoBtn.__logHooked = true;
      setAutoBtn.addEventListener('click', () => {
        const date = document.getElementById('modal-date')?.textContent || '';
        const name = document.getElementById('modal-employee-name-input')?.value || '';
        const empId = document.getElementById('modal-employee-id-input')?.value || '';
        pushEntry('Remove Manual Shift', { date, employee: name, emp_id: empId });
      }, { capture: true });
    }

    // 7) Pattern builder choices
    const patternGrid = document.getElementById('pattern-shift-options');
    if (patternGrid && !patternGrid.__logHooked) {
      patternGrid.__logHooked = true;
      patternGrid.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button');
        if (!btn) return;
        const label = (btn.textContent || '').trim();
        const day = document.getElementById('pattern-modal-day')?.textContent || '';
        pushEntry('Set Pattern Shift', { day, label });
      }, { capture: true });
    }

    // 8) Daily-list changes (unit / start / end / remarks edits)
    const daily = document.getElementById('daily-list-content');
    if (daily && !daily.__logHooked) {
      daily.__logHooked = true;
      daily.addEventListener('change', (ev) => {
        const el = ev.target;
        const row = el.closest('tr');
        if (!row) return;
        const name = row.querySelector('td:nth-child(3)')?.textContent?.trim() || '';
        const unit  = row.querySelector('td:nth-child(6)')?.textContent?.trim() ||
                      row.querySelector('td:nth-child(6) select')?.value || '';
        const colIdx = Array.from(row.children).indexOf(el.closest('td')) + 1;
        pushEntry('Edit Daily List', { name, column: colIdx, value: (el.value ?? el.textContent)?.trim() });
      }, { capture: true });
    }

    // 9) Generic grid edits: fallback via MutationObserver (changes inside #roster-grid)
    const grid = document.getElementById('roster-grid');
    if (grid && !grid.__logWatcher) {
      const mo = new MutationObserver((mutations) => {
        let count = 0;
        mutations.forEach(m => {
          if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) count++;
          if (m.type === 'characterData') count++;
        });
        if (count) pushEntry('Grid Updated', { mutations: count });
      });
      mo.observe(grid, { subtree: true, childList: true, characterData: true });
      grid.__logWatcher = mo;
    }
  }

  // Periodically attempt to (re)install hooks when views change
  setInterval(installHooks, 1200);
  // Ensure styles quickly
  ensureStyles();

  // Seed: first run marker
  if (!localStorage.getItem(LS_KEY)) {
    writeLS([]);
    pushEntry('Log Initialized', location.href);
  }
})();
