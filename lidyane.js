/* ============================================================
   LIDYANE.JS — Seabra Bakery Income Tracker
   Standalone — does NOT import or modify app.js
   Uses lidSupabase (not window.supabase) to avoid conflicts
   All Supabase queries scoped to lid_* tables only
   ============================================================ */

(function () {
  'use strict';

  // ── Supabase config (same project, isolated client) ─────────
  // These are the same credentials used by app.js — safe to reuse
  // since Supabase JS handles multiple clients gracefully
  const SUPA_URL = 'https://icatgbqspkbwzjqtaaoz.supabase.co';
  const SUPA_KEY = (function () {
    // Read anon key from the existing app.js global if available,
    // otherwise use the hardcoded value (same key, public anon)
    if (window._LID_SUPA_KEY) return window._LID_SUPA_KEY;
    // Fallback: key is injected by Netlify or hardcoded in index.html
    // Replace the placeholder below with your actual anon key
    return 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljYXRnYnFzcGtid3pqcXRhYW96Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgyNDMzNTAsImV4cCI6MjA5MzgxOTM1MH0.3NQA6ui4n19yDT5aAkCArluKpTg0VXjb5bjvyvPW7Oc';
  })();

  const lidSupabase = supabase.createClient(SUPA_URL, SUPA_KEY);

  // ── App state ────────────────────────────────────────────────
  const state = {
    periods: [],
    currentPeriodIndex: 0,
    currentPeriod: null,
    entries: [],
    tips: [],
    summary: null,
  };

  // ── Helpers ──────────────────────────────────────────────────

  function fmt$(val) {
    if (val === null || val === undefined) return '$0.00';
    return '$' + Number(val).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtMinutes(min) {
    if (!min) return '0h 00m';
    const h = Math.floor(min / 60);
    const m = min % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateShort(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function dayName(dateStr) {
    if (!dateStr) return '—';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return days[new Date(dateStr + 'T12:00:00').getDay()];
  }

  function nextSunday(fromDate) {
    const d = fromDate ? new Date(fromDate + 'T12:00:00') : new Date();
    const day = d.getDay();
    const diff = (7 - day) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Calculate hours between two time strings, minus break
  function calcHours(clockIn, clockOut, breakOut, breakIn) {
    if (!clockIn || !clockOut) return 0;
    const toMin = t => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    let worked = toMin(clockOut) - toMin(clockIn);
    if (breakOut && breakIn) {
      worked -= (toMin(breakIn) - toMin(breakOut));
    }
    return Math.max(0, worked);
  }

  function toast(msg, type = 'success') {
    const el = document.getElementById('lid-toast');
    el.textContent = msg;
    el.className = `lid-toast ${type} show`;
    setTimeout(() => { el.className = 'lid-toast'; }, 2800);
  }

  function setStatus(connected) {
    const dot = document.getElementById('lid-status-dot');
    const txt = document.getElementById('lid-status-text');
    if (connected) {
      dot.classList.add('connected');
      txt.textContent = 'connected · Seabra Bakery';
    } else {
      dot.classList.remove('connected');
      txt.textContent = 'connection error';
    }
  }

  // ── Tab navigation ───────────────────────────────────────────

  function switchTab(name) {
    document.querySelectorAll('.lid-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.lid-section').forEach(s => s.classList.remove('active'));
    document.querySelector(`[data-tab="${name}"]`).classList.add('active');
    document.getElementById(`tab-${name}`).classList.add('active');
    if (name === 'entry')   renderEntryTab();
    if (name === 'tips')    renderTipsTab();
    if (name === 'history') renderHistory();
  }

  document.querySelectorAll('.lid-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // ── Modal helpers ────────────────────────────────────────────

  function openModal(id) {
    document.getElementById(id).classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
  }

  // Close modal on overlay click
  document.querySelectorAll('.lid-modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  // ── Periods ──────────────────────────────────────────────────

  async function loadPeriods() {
    const { data, error } = await lidSupabase
      .from('lid_biweekly_periods')
      .select('*')
      .order('start_date', { ascending: false });

    if (error) { setStatus(false); return; }
    setStatus(true);
    state.periods = data || [];

    if (state.periods.length > 0) {
      state.currentPeriodIndex = 0;
      state.currentPeriod = state.periods[0];
      await loadPeriodData();
    }

    renderDashboard();
    renderHistory();
  }

  async function loadPeriodData() {
    if (!state.currentPeriod) return;
    const pid = state.currentPeriod.id;

    const [entriesRes, tipsRes, summaryRes] = await Promise.all([
      lidSupabase.from('lid_daily_entries').select('*')
        .eq('period_id', pid).order('work_date'),
      lidSupabase.from('lid_weekly_tips').select('*')
        .eq('period_id', pid).order('week_start'),
      lidSupabase.from('lid_period_summary').select('*')
        .eq('id', pid).single(),
    ]);

    state.entries = entriesRes.data || [];
    state.tips    = tipsRes.data   || [];
    state.summary = summaryRes.data || null;
  }

  function openNewPeriodModal() {
    // Suggest next Sunday after last period or today
    const lastPeriod = state.periods[0];
    const suggestedStart = lastPeriod
      ? nextSunday(lastPeriod.end_date)
      : nextSunday(null);

    document.getElementById('lid-new-period-start').value = suggestedStart;
    document.getElementById('lid-new-period-rate').value = '15';
    document.getElementById('lid-new-period-notes').value = '';
    openModal('lid-modal-period');
  }

  async function savePeriod() {
    const startDate = document.getElementById('lid-new-period-start').value;
    const rate      = parseFloat(document.getElementById('lid-new-period-rate').value);
    const notes     = document.getElementById('lid-new-period-notes').value.trim();

    if (!startDate) { toast('Selecione a data de início', 'error'); return; }

    const d = new Date(startDate + 'T12:00:00');
    if (d.getDay() !== 0) { toast('A data de início deve ser um domingo', 'error'); return; }

    const endDate = addDays(startDate, 13);

    const { error } = await lidSupabase.from('lid_biweekly_periods').insert({
      start_date:   startDate,
      end_date:     endDate,
      hourly_rate:  rate || 15,
      notes:        notes || null,
    });

    if (error) { toast('Erro ao criar quinzena: ' + error.message, 'error'); return; }

    toast('Quinzena criada!');
    closeModal('lid-modal-period');
    await loadPeriods();
  }

  async function confirmDeletePeriod() {
    if (!state.currentPeriod) return;
    const p = state.currentPeriod;
    const label = `${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}`;
    if (!confirm(`Excluir a quinzena ${label}?\n\nTodos os registros diários e tips serão excluídos.`)) return;

    const { error } = await lidSupabase
      .from('lid_biweekly_periods')
      .delete()
      .eq('id', p.id);

    if (error) { toast('Erro ao excluir: ' + error.message, 'error'); return; }
    toast('Quinzena excluída');
    state.currentPeriodIndex = 0;
    await loadPeriods();
  }

  function navigatePeriod(dir) {
    const max = state.periods.length - 1;
    state.currentPeriodIndex = Math.min(max, Math.max(0, state.currentPeriodIndex + dir));
    state.currentPeriod = state.periods[state.currentPeriodIndex];
    loadPeriodData().then(renderDashboard);
  }

  // ── Dashboard render ─────────────────────────────────────────

  function renderDashboard() {
    const hasPeriods = state.periods.length > 0;

    document.getElementById('lid-no-period').style.display       = hasPeriods ? 'none' : '';
    document.getElementById('lid-dashboard-content').style.display = hasPeriods ? '' : 'none';
    document.getElementById('lid-period-bar').style.display      = hasPeriods ? '' : 'none';

    if (!hasPeriods) return;

    const p = state.currentPeriod;
    const s = state.summary;

    // Period label
    document.getElementById('lid-period-label').textContent =
      `${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}`;

    // Nav buttons
    document.getElementById('lid-prev-period').disabled = state.currentPeriodIndex >= state.periods.length - 1;
    document.getElementById('lid-next-period').disabled = state.currentPeriodIndex <= 0;

    // Stats
    const hours = s ? fmtMinutes(s.total_minutes_worked) : '0h 00m';
    const days  = s ? s.days_worked : 0;
    const base  = s ? fmt$(s.base_salary)   : '$0.00';
    const tips  = s ? fmt$(s.total_tips)    : '$0.00';
    const total = s ? fmt$(s.total_with_tips) : '$0.00';

    document.getElementById('lid-stat-hours').innerHTML = hours.replace('h', '<span>h</span> ').replace('m', '<span>m</span>');
    document.getElementById('lid-stat-days').innerHTML  = `${days}<span>/14</span>`;
    document.getElementById('lid-stat-base').textContent  = base;
    document.getElementById('lid-stat-tips').textContent  = tips;
    document.getElementById('lid-stat-total').textContent = total;

    // Weekly breakdown
    renderWeekBreakdown();

    // Paycheck
    renderPaycheckInfo();
  }

  function renderWeekBreakdown() {
    const p = state.currentPeriod;
    const el = document.getElementById('lid-weeks-breakdown');
    if (!p) { el.innerHTML = ''; return; }

    const week1Start = p.start_date;
    const week1End   = addDays(week1Start, 6);
    const week2Start = addDays(week1Start, 7);
    const week2End   = p.end_date;

    const weeks = [
      { label: 'Semana 1', start: week1Start, end: week1End },
      { label: 'Semana 2', start: week2Start, end: week2End },
    ];

    el.innerHTML = weeks.map(w => {
      const wEntries = state.entries.filter(e =>
        e.work_date >= w.start && e.work_date <= w.end && !e.is_day_off && e.clock_in
      );
      const wMins  = wEntries.reduce((acc, e) =>
        acc + calcHours(e.clock_in, e.clock_out, e.break_out, e.break_in), 0);
      const wBase  = wMins / 60 * (state.currentPeriod.hourly_rate || 15);
      const wTip   = state.tips.find(t => t.week_start === w.start);
      const wTipAmt = wTip ? Number(wTip.amount) : 0;

      return `
        <div class="lid-week-block">
          <div class="lid-week-title">${w.label} · ${fmtDateShort(w.start)} → ${fmtDateShort(w.end)}</div>
          <div class="lid-week-row"><span>Horas</span><span>${fmtMinutes(wMins)}</span></div>
          <div class="lid-week-row"><span>Salário base</span><span>${fmt$(wBase)}</span></div>
          <div class="lid-week-row"><span>Tips ${wTip ? '✓' : '(pendente)'}</span><span>${fmt$(wTipAmt)}</span></div>
          <div class="lid-week-row"><span>Subtotal</span><span>${fmt$(wBase + wTipAmt)}</span></div>
        </div>`;
    }).join('');
  }

  function renderPaycheckInfo() {
    const p = state.currentPeriod;
    const s = state.summary;
    const el = document.getElementById('lid-paycheck-info');

    if (!p.paycheck_amount) {
      el.innerHTML = `<p style="font-family:var(--lid-mono);font-size:12px;color:var(--lid-muted)">
        Paycheck não registrado ainda.<br>
        Data prevista: <strong style="color:var(--lid-text)">${fmtDate(p.end_date)}</strong>
      </p>`;
      return;
    }

    const diff = s ? Number(s.paycheck_vs_calculated) : null;
    const diffColor = diff === null ? '' :
      diff > 0 ? 'color:var(--lid-accent)' :
      diff < 0 ? 'color:var(--lid-danger)' : 'color:var(--lid-muted)';

    el.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:6px;font-family:var(--lid-mono);font-size:12px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--lid-muted)">Recebido em</span>
          <span>${fmtDate(p.paycheck_date)}</span>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--lid-muted)">Valor oficial</span>
          <span style="color:var(--lid-accent);font-size:16px;font-weight:700">${fmt$(p.paycheck_amount)}</span>
        </div>
        ${diff !== null ? `
        <div style="display:flex;justify-content:space-between;border-top:1px solid var(--lid-border);padding-top:6px;margin-top:2px">
          <span style="color:var(--lid-muted)">vs calculado</span>
          <span style="${diffColor}">${diff >= 0 ? '+' : ''}${fmt$(diff)}</span>
        </div>` : ''}
      </div>`;
  }

  // ── Paycheck modal ───────────────────────────────────────────

  function openPaycheckModal() {
    const p = state.currentPeriod;
    if (!p) return;
    document.getElementById('lid-paycheck-date').value   = p.paycheck_date || p.end_date;
    document.getElementById('lid-paycheck-amount').value = p.paycheck_amount || '';
    openModal('lid-modal-paycheck');
  }

  async function savePaycheck() {
    const date   = document.getElementById('lid-paycheck-date').value;
    const amount = parseFloat(document.getElementById('lid-paycheck-amount').value);
    if (!date || isNaN(amount)) { toast('Preencha data e valor', 'error'); return; }

    const { error } = await lidSupabase
      .from('lid_biweekly_periods')
      .update({ paycheck_date: date, paycheck_amount: amount })
      .eq('id', state.currentPeriod.id);

    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    toast('Paycheck salvo!');
    closeModal('lid-modal-paycheck');
    await loadPeriodData();
    renderDashboard();
    // Update local state
    const idx = state.periods.findIndex(x => x.id === state.currentPeriod.id);
    if (idx >= 0) {
      state.periods[idx].paycheck_date   = date;
      state.periods[idx].paycheck_amount = amount;
      state.currentPeriod = state.periods[idx];
    }
  }

  // ── Daily entries ────────────────────────────────────────────

  function renderEntryTab() {
    const hasPeriod = !!state.currentPeriod;
    document.getElementById('lid-entry-no-period').style.display  = hasPeriod ? 'none' : '';
    document.getElementById('lid-entry-form-wrap').style.display  = hasPeriod ? '' : 'none';
    if (!hasPeriod) return;

    // Default date to today if within current period
    const today = new Date().toISOString().slice(0, 10);
    const p = state.currentPeriod;
    const inRange = today >= p.start_date && today <= p.end_date;
    const dateEl = document.getElementById('lid-entry-date');
    if (!dateEl.value) dateEl.value = inRange ? today : p.start_date;

    renderEntryMiniList();
  }

  function renderEntryMiniList() {
    const el = document.getElementById('lid-entry-mini-list');
    if (!state.entries.length) {
      el.innerHTML = `<div class="lid-empty"><div class="lid-empty-icon">📅</div>Nenhum registro ainda</div>`;
      return;
    }

    el.innerHTML = state.entries.map(e => {
      const mins = e.is_day_off ? 0 : calcHours(e.clock_in, e.clock_out, e.break_out, e.break_in);
      const pay  = mins / 60 * (state.currentPeriod.hourly_rate || 15);
      const timesStr = e.is_day_off ? 'Day off' :
        `${e.clock_in?.slice(0,5) || '--:--'} → ${e.clock_out?.slice(0,5) || '--:--'}` +
        (e.break_out ? ` (break ${e.break_out?.slice(0,5)}–${e.break_in?.slice(0,5)})` : '');

      return `
        <div class="lid-entry-item ${e.is_day_off ? 'day-off' : ''}">
          <div class="lid-entry-day">${dayName(e.work_date)}</div>
          <div class="lid-entry-info">
            <div class="lid-entry-date">${fmtDateShort(e.work_date)}</div>
            <div class="lid-entry-times">${timesStr}</div>
          </div>
          ${!e.is_day_off ? `
          <div class="lid-entry-right">
            <div class="lid-entry-hours">${fmtMinutes(mins)}</div>
            <div class="lid-entry-pay">${fmt$(pay)}</div>
          </div>` : ''}
          <div class="lid-entry-actions">
            <button class="lid-icon-btn" onclick="LID.editEntry('${e.id}')" title="Editar">✏️</button>
            <button class="lid-icon-btn delete" onclick="LID.deleteEntry('${e.id}')" title="Excluir">🗑</button>
          </div>
        </div>`;
    }).join('');
  }

  // Live calc preview
  function updateCalcPreview() {
    const dayOff  = document.getElementById('lid-day-off').checked;
    const clockIn = document.getElementById('lid-clock-in').value;
    const clockOut= document.getElementById('lid-clock-out').value;
    const breakOut= document.getElementById('lid-break-out').value;
    const breakIn = document.getElementById('lid-break-in').value;
    const preview = document.getElementById('lid-calc-preview');
    const text    = document.getElementById('lid-calc-text');

    if (dayOff || !clockIn || !clockOut) { preview.classList.remove('visible'); return; }

    const mins = calcHours(clockIn, clockOut, breakOut, breakIn);
    const pay  = (mins / 60) * (state.currentPeriod?.hourly_rate || 15);
    text.innerHTML = `${fmtMinutes(mins)} trabalhadas → <span class="value">${fmt$(pay)}</span>`;
    preview.classList.add('visible');
  }

  ['lid-clock-in','lid-clock-out','lid-break-out','lid-break-in'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateCalcPreview);
  });

  document.getElementById('lid-day-off').addEventListener('change', function () {
    document.getElementById('lid-clock-fields').style.display = this.checked ? 'none' : '';
    updateCalcPreview();
  });

  async function saveEntry() {
    if (!state.currentPeriod) return;
    const pid     = state.currentPeriod.id;
    const editId  = document.getElementById('lid-entry-editing-id').value;
    const date    = document.getElementById('lid-entry-date').value;
    const dayOff  = document.getElementById('lid-day-off').checked;
    const clockIn = document.getElementById('lid-clock-in').value || null;
    const breakOut= document.getElementById('lid-break-out').value || null;
    const breakIn = document.getElementById('lid-break-in').value || null;
    const clockOut= document.getElementById('lid-clock-out').value || null;
    const notes   = document.getElementById('lid-entry-notes').value.trim() || null;

    if (!date) { toast('Selecione a data', 'error'); return; }
    if (!dayOff && (!clockIn || !clockOut)) { toast('Informe clock in e clock out', 'error'); return; }

    const payload = {
      period_id:  pid,
      work_date:  date,
      is_day_off: dayOff,
      clock_in:   dayOff ? null : clockIn,
      break_out:  dayOff ? null : breakOut,
      break_in:   dayOff ? null : breakIn,
      clock_out:  dayOff ? null : clockOut,
      notes,
    };

    let error;
    if (editId) {
      ({ error } = await lidSupabase.from('lid_daily_entries').update(payload).eq('id', editId));
    } else {
      ({ error } = await lidSupabase.from('lid_daily_entries').insert(payload));
    }

    if (error) { toast('Erro: ' + error.message, 'error'); return; }

    toast(editId ? 'Registro atualizado!' : 'Registro salvo!');
    cancelEditEntry();
    await loadPeriodData();
    renderEntryMiniList();
    renderDashboard();
  }

  function editEntry(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return;

    document.getElementById('lid-entry-editing-id').value = id;
    document.getElementById('lid-entry-date').value       = e.work_date;
    document.getElementById('lid-day-off').checked        = e.is_day_off;
    document.getElementById('lid-clock-in').value         = e.clock_in  ? e.clock_in.slice(0,5)  : '';
    document.getElementById('lid-break-out').value        = e.break_out ? e.break_out.slice(0,5) : '';
    document.getElementById('lid-break-in').value         = e.break_in  ? e.break_in.slice(0,5)  : '';
    document.getElementById('lid-clock-out').value        = e.clock_out ? e.clock_out.slice(0,5) : '';
    document.getElementById('lid-entry-notes').value      = e.notes || '';
    document.getElementById('lid-clock-fields').style.display = e.is_day_off ? 'none' : '';
    document.getElementById('lid-entry-form-title').textContent = 'Editando registro';
    document.getElementById('lid-cancel-edit-btn').style.display = '';
    updateCalcPreview();
    document.getElementById('lid-entry-date').scrollIntoView({ behavior: 'smooth' });
  }

  function cancelEditEntry() {
    document.getElementById('lid-entry-editing-id').value  = '';
    document.getElementById('lid-entry-date').value        = '';
    document.getElementById('lid-day-off').checked         = false;
    document.getElementById('lid-clock-in').value          = '';
    document.getElementById('lid-break-out').value         = '';
    document.getElementById('lid-break-in').value          = '';
    document.getElementById('lid-clock-out').value         = '';
    document.getElementById('lid-entry-notes').value       = '';
    document.getElementById('lid-clock-fields').style.display = '';
    document.getElementById('lid-entry-form-title').textContent = 'Registrar dia de trabalho';
    document.getElementById('lid-cancel-edit-btn').style.display = 'none';
    document.getElementById('lid-calc-preview').classList.remove('visible');
  }

  async function deleteEntry(id) {
    if (!confirm('Excluir este registro?')) return;
    const { error } = await lidSupabase.from('lid_daily_entries').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    toast('Registro excluído');
    await loadPeriodData();
    renderEntryMiniList();
    renderDashboard();
  }

  // ── Weekly tips ──────────────────────────────────────────────

  function renderTipsTab() {
    const hasPeriod = !!state.currentPeriod;
    document.getElementById('lid-tips-no-period').style.display  = hasPeriod ? 'none' : '';
    document.getElementById('lid-tips-form-wrap').style.display  = hasPeriod ? '' : 'none';
    if (!hasPeriod) return;

    // Populate week selector
    const p = state.currentPeriod;
    const week1Start = p.start_date;
    const week2Start = addDays(p.start_date, 7);
    const sel = document.getElementById('lid-tip-week-select');
    sel.innerHTML = [
      { start: week1Start, end: addDays(week1Start, 6), label: `Semana 1: ${fmtDateShort(week1Start)} → ${fmtDateShort(addDays(week1Start, 6))}` },
      { start: week2Start, end: addDays(week2Start, 6), label: `Semana 2: ${fmtDateShort(week2Start)} → ${fmtDateShort(addDays(week2Start, 6))}` },
    ].map(w => `<option value="${w.start}|${w.end}">${w.label}</option>`).join('');

    // Default received_on to next Monday after week start
    sel.addEventListener('change', updateTipReceivedDefault);
    updateTipReceivedDefault();

    renderTipsList();
  }

  function updateTipReceivedDefault() {
    const val = document.getElementById('lid-tip-week-select').value;
    if (!val) return;
    const weekStart = val.split('|')[0];
    // Monday after week end (week end = weekStart + 6, monday = +7)
    const monday = addDays(weekStart, 8);
    if (!document.getElementById('lid-tip-editing-id').value) {
      document.getElementById('lid-tip-received-on').value = monday;
    }
  }

  function renderTipsList() {
    const el = document.getElementById('lid-tips-list');
    if (!state.tips.length) {
      el.innerHTML = `<div class="lid-empty"><div class="lid-empty-icon">💵</div>Nenhum tip registrado ainda</div>`;
      return;
    }

    el.innerHTML = state.tips.map(t => `
      <div class="lid-tip-item">
        <div class="lid-tip-week">
          <div style="font-weight:600;color:var(--lid-text)">${fmtDateShort(t.week_start)} → ${fmtDateShort(t.week_end)}</div>
          <div style="margin-top:2px">Recebido em ${fmtDate(t.received_on)}</div>
          ${t.notes ? `<div style="margin-top:2px;color:var(--lid-muted);font-size:10px">${t.notes}</div>` : ''}
        </div>
        <div class="lid-tip-amount">${fmt$(t.amount)}</div>
        <div class="lid-entry-actions">
          <button class="lid-icon-btn" onclick="LID.editTip('${t.id}')" title="Editar">✏️</button>
          <button class="lid-icon-btn delete" onclick="LID.deleteTip('${t.id}')" title="Excluir">🗑</button>
        </div>
      </div>`).join('');
  }

  async function saveTip() {
    if (!state.currentPeriod) return;
    const editId     = document.getElementById('lid-tip-editing-id').value;
    const weekVal    = document.getElementById('lid-tip-week-select').value;
    const receivedOn = document.getElementById('lid-tip-received-on').value;
    const amount     = parseFloat(document.getElementById('lid-tip-amount').value);
    const notes      = document.getElementById('lid-tip-notes').value.trim() || null;

    if (!weekVal)           { toast('Selecione a semana', 'error'); return; }
    if (!receivedOn)        { toast('Informe a data de recebimento', 'error'); return; }
    if (isNaN(amount) || amount < 0) { toast('Informe o valor', 'error'); return; }

    const [weekStart, weekEnd] = weekVal.split('|');

    const recDay = new Date(receivedOn + 'T12:00:00').getDay();
    if (recDay !== 1) { toast('Tips são recebidos na segunda-feira', 'error'); return; }

    const payload = {
      period_id:   state.currentPeriod.id,
      week_start:  weekStart,
      week_end:    weekEnd,
      received_on: receivedOn,
      amount,
      notes,
    };

    let error;
    if (editId) {
      ({ error } = await lidSupabase.from('lid_weekly_tips').update(payload).eq('id', editId));
    } else {
      ({ error } = await lidSupabase.from('lid_weekly_tips').insert(payload));
    }

    if (error) { toast('Erro: ' + error.message, 'error'); return; }

    toast(editId ? 'Tips atualizados!' : 'Tips salvos!');
    cancelEditTip();
    await loadPeriodData();
    renderTipsList();
    renderDashboard();
    renderWeekBreakdown();
  }

  function editTip(id) {
    const t = state.tips.find(x => x.id === id);
    if (!t) return;
    document.getElementById('lid-tip-editing-id').value    = id;
    document.getElementById('lid-tip-week-select').value   = `${t.week_start}|${t.week_end}`;
    document.getElementById('lid-tip-received-on').value   = t.received_on;
    document.getElementById('lid-tip-amount').value        = t.amount;
    document.getElementById('lid-tip-notes').value         = t.notes || '';
    document.getElementById('lid-cancel-tip-btn').style.display = '';
    document.getElementById('lid-tip-amount').scrollIntoView({ behavior: 'smooth' });
  }

  function cancelEditTip() {
    document.getElementById('lid-tip-editing-id').value    = '';
    document.getElementById('lid-tip-week-select').selectedIndex = 0;
    document.getElementById('lid-tip-received-on').value   = '';
    document.getElementById('lid-tip-amount').value        = '';
    document.getElementById('lid-tip-notes').value         = '';
    document.getElementById('lid-cancel-tip-btn').style.display = 'none';
    updateTipReceivedDefault();
  }

  async function deleteTip(id) {
    if (!confirm('Excluir este registro de tips?')) return;
    const { error } = await lidSupabase.from('lid_weekly_tips').delete().eq('id', id);
    if (error) { toast('Erro: ' + error.message, 'error'); return; }
    toast('Tips excluídos');
    await loadPeriodData();
    renderTipsList();
    renderDashboard();
  }

  // ── History ──────────────────────────────────────────────────

  async function renderHistory() {
    const el = document.getElementById('lid-history-list');
    if (!state.periods.length) {
      el.innerHTML = `<div class="lid-empty"><div class="lid-empty-icon">📋</div>Nenhuma quinzena ainda</div>`;
      return;
    }

    // Fetch all summaries at once
    const ids = state.periods.map(p => p.id);
    const { data: summaries } = await lidSupabase
      .from('lid_period_summary')
      .select('*')
      .in('id', ids)
      .order('start_date', { ascending: false });

    const summaryMap = {};
    (summaries || []).forEach(s => { summaryMap[s.id] = s; });

    el.innerHTML = state.periods.map(p => {
      const s = summaryMap[p.id];
      const isActive = state.currentPeriod && p.id === state.currentPeriod.id;
      return `
        <div class="lid-card" style="${isActive ? 'border-color:var(--lid-accent)' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <div>
              <div style="font-family:var(--lid-mono);font-size:12px;font-weight:700;color:var(--lid-text)">
                ${fmtDate(p.start_date)} – ${fmtDate(p.end_date)}
              </div>
              ${isActive ? '<div style="font-family:var(--lid-mono);font-size:9px;color:var(--lid-accent);margin-top:2px">QUINZENA ATUAL</div>' : ''}
            </div>
            ${p.paycheck_amount ?
              `<div style="font-family:var(--lid-mono);font-size:16px;font-weight:700;color:var(--lid-accent)">${fmt$(p.paycheck_amount)}</div>` :
              `<div style="font-family:var(--lid-mono);font-size:10px;color:var(--lid-muted)">sem paycheck</div>`
            }
          </div>
          ${s ? `
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-family:var(--lid-mono);font-size:10px">
            <div style="background:var(--lid-surface2);border:1px solid var(--lid-border);border-radius:6px;padding:8px;text-align:center">
              <div style="color:var(--lid-muted);margin-bottom:3px">Horas</div>
              <div style="color:var(--lid-accent3);font-weight:700">${fmtMinutes(s.total_minutes_worked)}</div>
            </div>
            <div style="background:var(--lid-surface2);border:1px solid var(--lid-border);border-radius:6px;padding:8px;text-align:center">
              <div style="color:var(--lid-muted);margin-bottom:3px">Tips</div>
              <div style="color:var(--lid-accent2);font-weight:700">${fmt$(s.total_tips)}</div>
            </div>
            <div style="background:var(--lid-surface2);border:1px solid var(--lid-border);border-radius:6px;padding:8px;text-align:center">
              <div style="color:var(--lid-muted);margin-bottom:3px">Total</div>
              <div style="color:var(--lid-accent);font-weight:700">${fmt$(s.total_with_tips)}</div>
            </div>
          </div>` : ''}
        </div>`;
    }).join('');
  }

  // ── Period nav buttons ───────────────────────────────────────
  document.getElementById('lid-prev-period').addEventListener('click', () => navigatePeriod(1));
  document.getElementById('lid-next-period').addEventListener('click', () => navigatePeriod(-1));

  // ── Public API (called from HTML onclick) ────────────────────
  window.LID = {
    switchTab,
    openModal,
    closeModal,
    openNewPeriodModal,
    savePeriod,
    confirmDeletePeriod,
    openPaycheckModal,
    savePaycheck,
    saveEntry,
    editEntry,
    cancelEditEntry,
    deleteEntry,
    saveTip,
    editTip,
    cancelEditTip,
    deleteTip,
  };

  // ── Init ─────────────────────────────────────────────────────
  async function init() {
    try {
      await loadPeriods();
    } catch (e) {
      setStatus(false);
      console.error('[LID] init error:', e);
    }
  }

  init();

})();
