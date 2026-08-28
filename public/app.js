/* Healthcare Expense front-end */
(() => {
  'use strict';

  // Categorical slots from the validated palette, assigned to people in fixed
  // order (order of the persons list), never cycled per-chart.
  const PERSON_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const state = {
    user: null,
    persons: [],
    providerTypes: [],
    expenses: [],
    year: new Date().getFullYear(),
    filters: { year: 'all', person: 'all', type: 'all' },
    editingId: null,
    loaded: false,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];

  const fmtUSD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = (n) => fmtUSD.format(n);

  const parseDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const fmtDate = (iso) => {
    const d = parseDate(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return `${MONTHS[d.getMonth()]} ${d.getDate()}${sameYear ? '' : `, ${d.getFullYear()}`}`;
  };
  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const initialsOf = (name) =>
    name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  const personColor = (name) => {
    const i = state.persons.findIndex((p) => p.toLowerCase() === name.toLowerCase());
    return PERSON_COLORS[(i >= 0 ? i : state.persons.length) % PERSON_COLORS.length];
  };
  const luminance = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const avatarHTML = (name, small = false) => {
    const color = personColor(name);
    const ink = luminance(color) > 0.45 ? '#0b0b0b' : '#ffffff';
    return `<span class="avatar${small ? ' avatar-sm' : ''}" style="background:${color};color:${ink}" aria-hidden="true">${esc(initialsOf(name))}</span>`;
  };

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const res = await fetch(path, {
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
      ...opts,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && path !== '/api/auth/login') {
      showLogin();
      throw new Error('unauthorized');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error || (data.errors || []).join('\n') || 'Something went wrong';
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /* ---------------- Views ---------------- */
  function showLogin() {
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
    setTimeout(() => $('#login-form input[name=username]').focus(), 60);
  }

  async function showApp() {
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#user-chip').textContent = state.user.displayName;
    renderSkeletons();
    await refreshData();
  }

  function setPage(page) {
    $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.page === page));
    $('#page-dashboard').hidden = page !== 'dashboard';
    $('#page-expenses').hidden = page !== 'expenses';
    window.scrollTo({ top: 0 });
  }

  /* ---------------- Data ---------------- */
  async function refreshData() {
    const [settings, expenseData] = await Promise.all([
      api('/api/settings'),
      api('/api/expenses'),
    ]);
    state.persons = settings.persons;
    state.providerTypes = settings.providerTypes;
    state.expenses = expenseData.expenses;
    state.loaded = true;
    renderAll();
  }

  const yearsInData = () => {
    const years = new Set(state.expenses.map((e) => Number(e.date.slice(0, 4))));
    years.add(new Date().getFullYear());
    return [...years].sort((a, b) => b - a);
  };

  const expensesForYear = (year) => state.expenses.filter((e) => Number(e.date.slice(0, 4)) === year);
  const sum = (list) => list.reduce((acc, e) => acc + e.amount, 0);

  /* ---------------- Rendering ---------------- */
  function renderAll() {
    renderYearSelects();
    renderDashboard();
    renderExpensesPage();
  }

  function renderSkeletons() {
    ['#stat-ytd', '#stat-30d', '#stat-count'].forEach((sel) => {
      const el = $(sel);
      el.classList.add('skeleton');
      el.textContent = '0000';
    });
    $('#monthly-chart').innerHTML = '<div class="chart-empty skeleton" style="height:180px"></div>';
    ['#by-person', '#by-type', '#recent-list'].forEach((sel) => {
      $(sel).innerHTML = '<div class="skeleton" style="height:64px"></div>';
    });
  }

  function renderYearSelects() {
    const years = yearsInData();
    if (!years.includes(state.year)) state.year = years[0];

    const yearSel = $('#year-select');
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join('');
    yearSel.value = String(state.year);

    const filterYear = $('#filter-year');
    filterYear.innerHTML =
      `<option value="all">All years</option>` +
      years.map((y) => `<option value="${y}">${y}</option>`).join('');
    filterYear.value = state.filters.year;

    const filterPerson = $('#filter-person');
    filterPerson.innerHTML =
      `<option value="all">All people</option>` +
      state.persons.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('');
    filterPerson.value = state.filters.person;
    if (filterPerson.selectedIndex < 0) { state.filters.person = 'all'; filterPerson.value = 'all'; }

    const filterType = $('#filter-type');
    filterType.innerHTML =
      `<option value="all">All provider types</option>` +
      state.providerTypes.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    filterType.value = state.filters.type;
    if (filterType.selectedIndex < 0) { state.filters.type = 'all'; filterType.value = 'all'; }
  }

  function countUp(el, target, format) {
    el.classList.remove('skeleton');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || target === 0) { el.textContent = format(target); return; }
    const start = performance.now();
    const dur = 450;
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) ** 3;
      el.textContent = format(target * eased);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function renderDashboard() {
    const year = state.year;
    const yearExpenses = expensesForYear(year);
    const now = new Date();
    const currentYear = now.getFullYear();

    // Stat: year total
    const yearTotal = sum(yearExpenses);
    $('#stat-ytd-label').textContent = year === currentYear ? 'Spent this year' : `Spent in ${year}`;
    countUp($('#stat-ytd'), yearTotal, money);
    const monthsElapsed = year === currentYear ? now.getMonth() + 1 : 12;
    $('#stat-ytd-foot').textContent = yearTotal > 0 ? `${money(yearTotal / monthsElapsed)} / month average` : 'Nothing logged yet';

    // Stat: last 30 days (always relative to today)
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const last30 = state.expenses.filter((e) => {
      const d = parseDate(e.date);
      return d >= cutoff && d <= now;
    });
    countUp($('#stat-30d'), sum(last30), money);
    $('#stat-30d-foot').textContent = `${last30.length} ${last30.length === 1 ? 'entry' : 'entries'}`;

    // Stat: entry count
    countUp($('#stat-count'), yearExpenses.length, (n) => String(Math.round(n)));
    const people = new Set(yearExpenses.map((e) => e.person));
    $('#stat-count-foot').textContent = people.size > 0
      ? `across ${people.size} ${people.size === 1 ? 'person' : 'people'}`
      : 'across the family';

    $('#dash-sub').textContent = `Your family's healthcare spending for ${year}`;
    $('#chart-hint').textContent = String(year);

    renderMonthlyChart(yearExpenses);
    renderBreakdown($('#by-person'), groupTotals(yearExpenses, 'person'), yearTotal, (name) => avatarHTML(name), (name) => personColor(name));
    renderBreakdown($('#by-type'), groupTotals(yearExpenses, 'providerType'), yearTotal, () => '', () => 'var(--accent)');
    renderRecent(yearExpenses);
  }

  function groupTotals(list, key) {
    const map = new Map();
    for (const e of list) map.set(e[key], (map.get(e[key]) || 0) + e.amount);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderBreakdown(el, entries, total, leadHTML, colorOf) {
    if (entries.length === 0) {
      el.innerHTML = '<p class="breakdown-empty">Nothing logged for this year yet.</p>';
      return;
    }
    const max = Math.max(...entries.map(([, v]) => v));
    el.innerHTML = entries.map(([name, value]) => `
      <div class="break-row">
        <div class="break-top">
          ${leadHTML(name)}
          <span class="break-name">${esc(name)}</span>
          <span class="break-amount">${money(value)}</span>
          <span class="break-share">${total > 0 ? Math.round((value / total) * 100) : 0}%</span>
        </div>
        <div class="break-meter"><div class="break-fill" style="width:${max > 0 ? (value / max) * 100 : 0}%;background:${colorOf(name)}"></div></div>
      </div>
    `).join('');
  }

  function renderRecent(yearExpenses) {
    const el = $('#recent-list');
    const recent = yearExpenses.slice(0, 8);
    if (recent.length === 0) {
      el.innerHTML = '<p class="breakdown-empty">No entries yet — add the first one and it will show up here.</p>';
      return;
    }
    el.innerHTML = recent.map((e) => `
      <div class="recent-row">
        ${avatarHTML(e.person, true)}
        <div class="recent-main">
          <div class="recent-desc">${esc(e.description)}</div>
          <div class="recent-meta">${esc(e.person)} · ${esc(e.providerType)} · ${fmtDate(e.date)}</div>
        </div>
        <span class="recent-amount">${money(e.amount)}</span>
      </div>
    `).join('');
  }

  /* ---------------- Monthly chart (hand-rolled SVG) ---------------- */
  function niceTicks(maxValue) {
    if (maxValue <= 0) return { max: 100, ticks: [0, 50, 100] };
    const rough = maxValue / 3;
    const pow = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) || 10 * pow;
    const top = Math.ceil(maxValue / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
    return { max: top, ticks };
  }

  function renderMonthlyChart(yearExpenses) {
    const wrap = $('#monthly-chart');
    const totals = Array(12).fill(0);
    for (const e of yearExpenses) totals[Number(e.date.slice(5, 7)) - 1] += e.amount;
    const dataMax = Math.max(...totals);

    if (dataMax === 0) {
      wrap.innerHTML = '<div class="chart-empty">No spending logged for this year yet.</div>';
      return;
    }

    const width = Math.max(wrap.clientWidth || 640, 320);
    const height = 220;
    const pad = { top: 22, right: 6, bottom: 26, left: 46 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const { max, ticks } = niceTicks(dataMax);
    const y = (v) => pad.top + innerH - (v / max) * innerH;
    const band = innerW / 12;
    const barW = Math.min(24, Math.max(6, band - 8));
    const narrow = width < 560;
    const maxIdx = totals.indexOf(dataMax);

    const fmtTick = (v) => (v >= 1000 ? `$${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${v.toLocaleString('en-US')}`);

    let svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`;

    // hairline gridlines + tick labels (skip gridline at baseline, drawn as axis)
    for (const t of ticks) {
      const ty = y(t);
      if (t > 0) svg += `<line x1="${pad.left}" x2="${width - pad.right}" y1="${ty}" y2="${ty}" stroke="var(--gridline)" stroke-width="1"/>`;
      svg += `<text x="${pad.left - 8}" y="${ty + 3.5}" text-anchor="end" font-size="11" fill="var(--ink-muted)" style="font-variant-numeric:tabular-nums">${fmtTick(t)}</text>`;
    }
    // baseline
    svg += `<line x1="${pad.left}" x2="${width - pad.right}" y1="${y(0)}" y2="${y(0)}" stroke="var(--baseline)" stroke-width="1"/>`;

    for (let m = 0; m < 12; m++) {
      const cx = pad.left + band * m + band / 2;
      const value = totals[m];
      // month label
      svg += `<text x="${cx}" y="${height - 8}" text-anchor="middle" font-size="11" fill="var(--ink-muted)">${narrow ? MONTHS[m][0] : MONTHS[m]}</text>`;
      if (value > 0) {
        const top = y(value);
        const h = y(0) - top;
        const r = Math.min(4, h, barW / 2);
        const x0 = cx - barW / 2;
        // rounded data-end, square baseline
        const d = `M${x0},${y(0)} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + barW - r} Q${x0 + barW},${top} ${x0 + barW},${top + r} V${y(0)} Z`;
        svg += `<path class="chart-bar" data-month="${m}" d="${d}" fill="var(--accent)"/>`;
        // direct label on the extreme only
        if (m === maxIdx) {
          svg += `<text x="${cx}" y="${top - 7}" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink-secondary)" style="font-variant-numeric:tabular-nums">${money(value)}</text>`;
        }
      }
      // full-height hit target for hover
      svg += `<rect class="chart-hit" data-month="${m}" x="${pad.left + band * m}" y="${pad.top}" width="${band}" height="${innerH}"/>`;
    }
    svg += '</svg>';
    wrap.innerHTML = svg;

    // hover layer
    const tooltip = $('#chart-tooltip');
    const bars = wrap.querySelectorAll('.chart-bar');
    wrap.querySelectorAll('.chart-hit').forEach((hit) => {
      const m = Number(hit.dataset.month);
      hit.addEventListener('mouseenter', () => {
        const value = totals[m];
        const count = yearExpenses.filter((e) => Number(e.date.slice(5, 7)) - 1 === m).length;
        tooltip.innerHTML = `${MONTHS_FULL[m]} ${state.year}<br><span class="tt-val">${money(value)}</span> <span class="tt-muted">· ${count} ${count === 1 ? 'entry' : 'entries'}</span>`;
        tooltip.hidden = false;
        bars.forEach((b) => { b.style.opacity = Number(b.dataset.month) === m ? '1' : '0.45'; });
        const rect = hit.getBoundingClientRect();
        const barTop = totals[m] > 0 ? y(totals[m]) : y(0);
        const svgRect = wrap.querySelector('svg').getBoundingClientRect();
        const scale = svgRect.height / height;
        tooltip.style.left = `${rect.left + rect.width / 2}px`;
        tooltip.style.top = `${svgRect.top + barTop * scale}px`;
      });
      hit.addEventListener('mouseleave', () => {
        tooltip.hidden = true;
        bars.forEach((b) => { b.style.opacity = '1'; });
      });
    });
  }

  /* ---------------- Expenses page ---------------- */
  function filteredExpenses() {
    const { year, person, type } = state.filters;
    return state.expenses.filter((e) =>
      (year === 'all' || e.date.startsWith(`${year}-`)) &&
      (person === 'all' || e.person === person) &&
      (type === 'all' || e.providerType === type));
  }

  function renderExpensesPage() {
    const list = filteredExpenses();
    const tbody = $('#expense-tbody');
    const anyFilter = Object.values(state.filters).some((v) => v !== 'all');
    $('#clear-filters').hidden = !anyFilter;
    $('#expenses-sub').textContent = `${state.expenses.length} ${state.expenses.length === 1 ? 'entry' : 'entries'} logged all-time`;
    $('#filter-total').innerHTML = list.length > 0
      ? `${list.length} ${list.length === 1 ? 'entry' : 'entries'} · <strong>${money(sum(list))}</strong>`
      : '';

    $('#table-empty').hidden = list.length !== 0;
    $('#expense-table').style.display = list.length === 0 ? 'none' : '';

    tbody.innerHTML = list.map((e) => `
      <tr data-id="${e.id}">
        <td class="td-date">${fmtDate(e.date)}</td>
        <td class="td-person">${avatarHTML(e.person, true)}${esc(e.person)}</td>
        <td class="td-type"><span class="pill">${esc(e.providerType)}</span></td>
        <td class="td-desc">
          <span class="desc-text">${esc(e.description)}</span>
          ${e.notes ? `<span class="desc-notes">${esc(e.notes)}</span>` : ''}
        </td>
        <td class="td-amount">${money(e.amount)}</td>
        <td class="td-actions">
          <button class="icon-btn" data-edit aria-label="Edit">
            <svg viewBox="0 0 16 16"><path d="m11.3 2.7 2 2L6 12l-2.7.7.7-2.7 7.3-7.3Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn btn-danger-ghost" data-delete aria-label="Delete">
            <svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4V3h3v1M4.5 4.5 5 13h6l.5-8.5M6.7 7v3.7M9.3 7v3.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </td>
      </tr>
    `).join('');
  }

  /* ---------------- CSV export ---------------- */
  function exportCSV() {
    const list = filteredExpenses();
    if (list.length === 0) { toast('Nothing to export for these filters'); return; }
    const cols = ['Date', 'Person', 'Provider type', 'Description', 'Amount', 'Notes', 'Logged by'];
    const cell = (v) => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [cols.join(',')].concat(
      list.map((e) => [e.date, e.person, e.providerType, e.description, e.amount.toFixed(2), e.notes, e.createdBy].map(cell).join(',')),
    );
    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const scope = state.filters.year === 'all' ? 'all' : state.filters.year;
    a.download = `healthcare-expense-${scope}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Exported ${list.length} ${list.length === 1 ? 'entry' : 'entries'}`);
  }

  /* ---------------- Slide-over form ---------------- */
  const slideover = $('#slideover');
  const overlay = $('#overlay');
  const form = $('#expense-form');

  function fillSelect(select, options, selected, addLabel) {
    select.innerHTML =
      options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('') +
      `<option value="__add">＋ ${addLabel}</option>`;
    if (selected && options.includes(selected)) select.value = selected;
    else select.selectedIndex = 0;
  }

  function openForm(expense = null) {
    state.editingId = expense ? expense.id : null;
    $('#slideover-title').textContent = expense ? 'Edit expense' : 'Add expense';
    $('#form-save').textContent = expense ? 'Save changes' : 'Save expense';
    $('#form-error').hidden = true;
    $('#person-add').hidden = true;
    $('#type-add').hidden = true;
    resetScanUI(expense !== null);

    form.elements.date.value = expense ? expense.date : todayISO();
    fillSelect(form.elements.person, state.persons, expense?.person ?? state.user.displayName, 'Add someone…');
    fillSelect(form.elements.providerType, state.providerTypes, expense?.providerType, 'Other / add your own…');
    form.elements.description.value = expense?.description ?? '';
    form.elements.amount.value = expense ? expense.amount : '';
    form.elements.notes.value = expense?.notes ?? '';

    overlay.hidden = false;
    slideover.hidden = false;
    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      slideover.classList.add('is-open');
    });
    setTimeout(() => form.elements[expense ? 'description' : 'date'].focus(), 120);
  }

  function closeForm() {
    overlay.classList.remove('is-open');
    slideover.classList.remove('is-open');
    setTimeout(() => { overlay.hidden = true; slideover.hidden = true; }, 250);
  }

  function inlineAdd(kind) {
    // kind: 'person' | 'type'
    const select = kind === 'person' ? form.elements.person : form.elements.providerType;
    const box = $(`#${kind}-add`);
    const input = $(`#${kind}-add-input`);
    const endpoint = kind === 'person' ? '/api/settings/persons' : '/api/settings/provider-types';

    select.addEventListener('change', () => {
      if (select.value === '__add') {
        box.hidden = false;
        input.value = '';
        input.focus();
      } else {
        box.hidden = true;
      }
    });

    const save = async () => {
      const name = input.value.trim();
      if (!name) { input.focus(); return; }
      try {
        const result = await api(endpoint, { method: 'POST', body: { name } });
        const settings = await api('/api/settings');
        state.persons = settings.persons;
        state.providerTypes = settings.providerTypes;
        if (kind === 'person') fillSelect(form.elements.person, state.persons, result.value, 'Add someone…');
        else fillSelect(form.elements.providerType, state.providerTypes, result.value, 'Other / add your own…');
        box.hidden = true;
        renderYearSelects();
        toast(result.existed ? `“${result.value}” already existed — selected it` : `Added “${result.value}”`);
      } catch (err) {
        showFormError(err.message);
      }
    };
    $(`#${kind}-add-save`).addEventListener('click', save);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
    });
    $(`#${kind}-add-cancel`).addEventListener('click', () => {
      box.hidden = true;
      select.selectedIndex = 0;
    });
  }

  function showFormError(message) {
    const el = $('#form-error');
    el.textContent = message;
    el.hidden = false;
  }

  async function submitForm(ev) {
    ev.preventDefault();
    const saveBtn = $('#form-save');
    const payload = {
      date: form.elements.date.value,
      person: form.elements.person.value,
      providerType: form.elements.providerType.value,
      description: form.elements.description.value.trim(),
      amount: Number(form.elements.amount.value),
      notes: form.elements.notes.value.trim(),
    };
    if (payload.person === '__add' || payload.providerType === '__add') {
      showFormError('Finish adding the new entry first (or cancel it).');
      return;
    }
    if (!payload.date || !payload.description || !(payload.amount > 0)) {
      showFormError('Date, description, and a positive amount are required.');
      return;
    }
    saveBtn.disabled = true;
    try {
      if (state.editingId) {
        await api(`/api/expenses/${state.editingId}`, { method: 'PUT', body: payload });
        toast('Expense updated');
      } else {
        await api('/api/expenses', { method: 'POST', body: payload });
        toast('Expense saved');
      }
      closeForm();
      await refreshData();
    } catch (err) {
      showFormError(err.message);
    } finally {
      saveBtn.disabled = false;
    }
  }

  /* ---------------- Receipt scan ---------------- */
  function resetScanUI(isEditing) {
    $('#scan-block').hidden = isEditing;
    $('#receipt-input').value = '';
    const note = $('#scan-note');
    note.hidden = true;
    note.classList.remove('is-error');
    setScanBusy(false);
    for (const el of form.querySelectorAll('.ai-filled')) el.classList.remove('ai-filled');
  }

  function setScanBusy(busy) {
    $('#scan-btn').classList.toggle('is-busy', busy);
    $('#scan-btn-label').textContent = busy ? 'Reading your receipt…' : 'Take photo of receipt';
  }

  function scanNote(html, isError = false) {
    const note = $('#scan-note');
    note.innerHTML = html;
    note.classList.toggle('is-error', isError);
    note.hidden = false;
  }

  function markFilled(el) {
    el.classList.add('ai-filled');
    el.addEventListener('input', () => el.classList.remove('ai-filled'), { once: true });
    el.addEventListener('change', () => el.classList.remove('ai-filled'), { once: true });
  }

  // Downscale/re-encode the photo so uploads stay small and format-safe.
  function prepareImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxSide = 1600;
          const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ imageBase64: dataUrl.split(',')[1], mediaType: 'image/jpeg' });
        } catch (err) {
          reject(err);
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image')); };
      img.src = url;
    });
  }

  async function handleReceiptPhoto(file) {
    if (!file) return;
    setScanBusy(true);
    $('#scan-note').hidden = true;
    try {
      const payload = await prepareImage(file);
      const { extraction } = await api('/api/receipt', { method: 'POST', body: payload });
      await applyExtraction(extraction);
    } catch (err) {
      scanNote(esc(err.message || 'Could not read the receipt — enter the details manually.'), true);
    } finally {
      setScanBusy(false);
      $('#receipt-input').value = '';
    }
  }

  async function applyExtraction(extraction) {
    const filled = [];

    if (extraction.date) {
      form.elements.date.value = extraction.date;
      markFilled(form.elements.date);
      filled.push('date');
    }
    if (extraction.amount != null) {
      form.elements.amount.value = extraction.amount;
      markFilled(form.elements.amount);
      filled.push('amount');
    }
    if (extraction.description) {
      form.elements.description.value = extraction.description;
      markFilled(form.elements.description);
      filled.push('description');
    }
    if (extraction.person) {
      const match = state.persons.find((p) => p.toLowerCase() === extraction.person.toLowerCase());
      if (match) {
        form.elements.person.value = match;
        markFilled(form.elements.person);
        filled.push('person');
      }
    }

    let newTypeSuggested = null;
    if (extraction.providerType) {
      const match = state.providerTypes.find((t) => t.toLowerCase() === extraction.providerType.toLowerCase());
      if (match) {
        form.elements.providerType.value = match;
        markFilled(form.elements.providerType);
        filled.push('provider type');
      } else {
        // Suggest it through the add-your-own flow so the user confirms new types.
        newTypeSuggested = extraction.providerType;
        form.elements.providerType.value = '__add';
        $('#type-add').hidden = false;
        $('#type-add-input').value = newTypeSuggested;
        markFilled($('#type-add-input'));
      }
    }

    if (filled.length === 0 && !newTypeSuggested) {
      scanNote("Couldn't read any details from that photo — try a closer, well-lit shot or enter it manually.", true);
      return;
    }

    let html = `<strong>Filled from your receipt:</strong> ${filled.map(esc).join(', ')}. Double-check everything, fix anything that's off, then save.`;
    if (newTypeSuggested) {
      html += `<br><strong>New provider type suggested:</strong> “${esc(newTypeSuggested)}” — press Add to keep it, or pick an existing type.`;
    }
    if (extraction.note) {
      html += `<br>${esc(extraction.note)}`;
    }
    scanNote(html);
  }

  /* ---------------- Delete (two-tap confirm) ---------------- */
  async function handleTableClick(ev) {
    const editBtn = ev.target.closest('[data-edit]');
    const deleteBtn = ev.target.closest('[data-delete]');
    const confirmBtn = ev.target.closest('.confirm-delete');
    const row = ev.target.closest('tr[data-id]');
    if (!row) return;
    const id = row.dataset.id;

    if (editBtn) {
      const expense = state.expenses.find((e) => e.id === id);
      if (expense) openForm(expense);
      return;
    }
    if (deleteBtn) {
      const cell = deleteBtn.closest('.td-actions');
      cell.dataset.restore = cell.innerHTML;
      cell.innerHTML = '<button class="confirm-delete">Delete?</button> <button class="btn btn-ghost btn-sm" data-cancel-delete>Keep</button>';
      return;
    }
    if (confirmBtn) {
      try {
        await api(`/api/expenses/${id}`, { method: 'DELETE' });
        toast('Expense deleted');
        await refreshData();
      } catch (err) {
        toast(err.message);
      }
      return;
    }
    if (ev.target.closest('[data-cancel-delete]')) {
      const cell = ev.target.closest('.td-actions');
      cell.innerHTML = cell.dataset.restore;
    }
  }

  /* ---------------- Toast ---------------- */
  let toastTimer;
  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-visible');
      setTimeout(() => { el.hidden = true; }, 250);
    }, 2600);
  }

  /* ---------------- Auth ---------------- */
  async function handleLogin(ev) {
    ev.preventDefault();
    const btn = $('#login-btn');
    const errEl = $('#login-error');
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: {
          username: ev.target.elements.username.value,
          password: ev.target.elements.password.value,
        },
      });
      state.user = data.user;
      ev.target.reset();
      await showApp();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  }

  async function handleLogout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    state.user = null;
    showLogin();
  }

  /* ---------------- Wire up ---------------- */
  function init() {
    $('#login-form').addEventListener('submit', handleLogin);
    $('#logout-btn').addEventListener('click', handleLogout);

    $$('.tab').forEach((t) => t.addEventListener('click', () => setPage(t.dataset.page)));
    $$('[data-page-link]').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.pageLink)));
    $$('[data-action=add]').forEach((b) => b.addEventListener('click', () => openForm()));

    $('#year-select').addEventListener('change', (ev) => {
      state.year = Number(ev.target.value);
      renderDashboard();
    });

    for (const [selId, key] of [['#filter-year', 'year'], ['#filter-person', 'person'], ['#filter-type', 'type']]) {
      $(selId).addEventListener('change', (ev) => {
        state.filters[key] = ev.target.value;
        renderExpensesPage();
      });
    }
    $('#clear-filters').addEventListener('click', () => {
      state.filters = { year: 'all', person: 'all', type: 'all' };
      renderYearSelects();
      renderExpensesPage();
    });

    $('#export-btn').addEventListener('click', exportCSV);
    $('#expense-table').addEventListener('click', handleTableClick);

    form.addEventListener('submit', submitForm);
    $('#form-cancel').addEventListener('click', closeForm);
    $('#slideover-close').addEventListener('click', closeForm);
    overlay.addEventListener('click', closeForm);
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !slideover.hidden) closeForm();
    });
    inlineAdd('person');
    inlineAdd('type');

    $('#scan-btn').addEventListener('click', () => $('#receipt-input').click());
    $('#receipt-input').addEventListener('change', (ev) => handleReceiptPhoto(ev.target.files[0]));

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.loaded && !$('#app-view').hidden) renderMonthlyChart(expensesForYear(state.year));
      }, 160);
    });

    // Boot: restore session if the cookie is valid
    api('/api/auth/me')
      .then((data) => { state.user = data.user; return showApp(); })
      .catch(() => showLogin());
  }

  init();
})();
