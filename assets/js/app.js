(() => {
  'use strict';

  /* =========================================================
     Configuration
     ========================================================= */

  const CONFIG = {
    openMinutes: 11 * 60 + 30,
    closeMinutes: 20 * 60 + 30,
    lastSlotMinutes: 20 * 60,
    slotStep: 30,
    leadMinutes: 30,
    tablesPerSlot: 6,
    maxParty: 8,
    daysAhead: 30,
    quickDays: 7,
    storageKey: 'syxc.reservations.v1',
    profileKey: 'syxc.profile.v1',
    phone: '13234029376',
    phoneDisplay: '132 3402 9376'
  };

  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  /* =========================================================
     Tiny helpers
     ========================================================= */

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const pad2 = (value) => String(value).padStart(2, '0');

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function parseISODate(iso) {
    const [year, month, day] = String(iso).split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  function isoOf(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function addDaysISO(iso, amount) {
    const date = parseISODate(iso);
    date.setDate(date.getDate() + amount);
    return isoOf(date);
  }

  function weekdayOf(iso) {
    return WEEKDAYS[parseISODate(iso).getDay()];
  }

  function monthDayOf(iso) {
    const date = parseISODate(iso);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function fullDateOf(iso) {
    const date = parseISODate(iso);
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekdayOf(iso)}`;
  }

  function relativeDateOf(iso) {
    const now = getShanghaiNow();
    if (iso === now.date) return `今天 · ${monthDayOf(iso)}`;
    if (iso === addDaysISO(now.date, 1)) return `明天 · ${monthDayOf(iso)}`;
    return `${monthDayOf(iso)} · ${weekdayOf(iso)}`;
  }

  function timeToMinutes(time) {
    const [hours, minutes] = String(time).split(':').map(Number);
    return hours * 60 + minutes;
  }

  function minutesToTime(minutes) {
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
  }

  function getShanghaiNow() {
    try {
      const formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      });
      const values = {};
      formatter.formatToParts(new Date()).forEach((part) => {
        if (part.type !== 'literal') values[part.type] = part.value;
      });
      return {
        date: `${values.year}-${values.month}-${values.day}`,
        year: Number(values.year),
        minutes: Number(values.hour) * 60 + Number(values.minute)
      };
    } catch (error) {
      const now = new Date();
      return {
        date: isoOf(now),
        year: now.getFullYear(),
        minutes: now.getHours() * 60 + now.getMinutes()
      };
    }
  }

  function getQuickDates() {
    const today = getShanghaiNow().date;
    return Array.from({ length: CONFIG.quickDays }, (_, index) => addDaysISO(today, index));
  }

  function isValidISODate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
    const date = parseISODate(value);
    return !Number.isNaN(date.getTime()) && isoOf(date) === value;
  }

  function isDateBookable(value) {
    if (!isValidISODate(value)) return false;
    const now = getShanghaiNow();
    return value >= now.date && value <= addDaysISO(now.date, CONFIG.daysAhead);
  }

  function tablesForParty(party) {
    return Number(party) <= 4 ? 1 : 2;
  }

  function showToast(message, duration = 3200) {
    const toast = $('#toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, duration);
  }

  /* =========================================================
     Storage
     ========================================================= */

  let memoryReservations = [];

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function loadReservations() {
    const raw = readStorage(CONFIG.storageKey);
    if (raw === null) return memoryReservations.slice();
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      memoryReservations = parsed.filter((item) => (
        item &&
        typeof item === 'object' &&
        typeof item.date === 'string' &&
        typeof item.time === 'string' &&
        typeof item.phone === 'string' &&
        typeof item.code === 'string'
      ));
      return memoryReservations.slice();
    } catch (error) {
      return memoryReservations.slice();
    }
  }

  function saveReservations(list) {
    memoryReservations = list.slice();
    return writeStorage(CONFIG.storageKey, JSON.stringify(list));
  }

  function loadProfile() {
    const raw = readStorage(CONFIG.profileKey);
    if (!raw) return {};
    try {
      const profile = JSON.parse(raw);
      return profile && typeof profile === 'object' ? profile : {};
    } catch (error) {
      return {};
    }
  }

  function saveProfile(name, phone) {
    writeStorage(CONFIG.profileKey, JSON.stringify({ name, phone }));
  }

  /* =========================================================
     State
     ========================================================= */

  const state = {
    date: null,
    time: null,
    party: 2,
    customDate: null,
    submitting: false,
    lastReservation: null,
    lookupPhone: ''
  };

  let lastDialogTrigger = null;
  let toastTimer = null;
  let mobileCtaObserver = null;
  let reserveSectionVisible = false;

  /* =========================================================
     Slot availability
     ========================================================= */

  function buildSlots() {
    const slots = [];
    for (let minutes = CONFIG.openMinutes; minutes <= CONFIG.lastSlotMinutes; minutes += CONFIG.slotStep) {
      slots.push(minutesToTime(minutes));
    }
    return slots;
  }

  function getSlotInfo(time, date, party, reservations = loadReservations()) {
    const now = getShanghaiNow();
    const minutes = timeToMinutes(time);

    if (date < now.date) return { state: 'past', remaining: 0 };
    if (date === now.date && minutes < now.minutes + CONFIG.leadMinutes) {
      return { state: 'past', remaining: 0 };
    }

    const usedTables = reservations
      .filter((reservation) => reservation.status === 'confirmed' && reservation.date === date && reservation.time === time)
      .reduce((total, reservation) => total + tablesForParty(reservation.party), 0);

    const remaining = Math.max(0, CONFIG.tablesPerSlot - usedTables);
    if (remaining < tablesForParty(party)) return { state: 'full', remaining };

    return { state: 'available', remaining };
  }

  function slotLabel(info) {
    if (info.state === 'full') return '已满';
    if (info.state === 'past') return '已过';
    if (info.remaining <= 1) return '余 1 桌';
    if (info.remaining <= 2) return '余 2 桌';
    return '有位';
  }

  function hasAvailableSlot(date, party) {
    const reservations = loadReservations();
    return buildSlots().some((time) => getSlotInfo(time, date, party, reservations).state === 'available');
  }

  /* =========================================================
     Date rail
     ========================================================= */

  function renderDateRail() {
    const dateRail = $('#dateRail');
    if (!dateRail) return;

    const hadFocus = dateRail.contains(document.activeElement);
    const now = getShanghaiNow();
    const quickDates = getQuickDates();
    const today = now.date;
    const tomorrow = addDaysISO(today, 1);

    const options = quickDates.map((iso) => {
      const isActive = state.date === iso;
      const isToday = iso === today;
      const dow = isToday ? '今天' : iso === tomorrow ? '明天' : weekdayOf(iso);
      return `
        <button
          type="button"
          class="date-option${isActive ? ' is-active' : ''}"
          data-date="${iso}"
          aria-pressed="${isActive}"
          aria-label="${fullDateOf(iso)}${isToday ? '，今天' : ''}"
        >
          <span class="dow">${dow}</span>
          <span class="day">${parseISODate(iso).getDate()}</span>
          <span class="month">${parseISODate(iso).getMonth() + 1}月</span>
          ${isToday ? '<span class="today-dot" aria-hidden="true"></span>' : ''}
        </button>
      `;
    });

    if (state.date && !quickDates.includes(state.date)) {
      const isActive = true;
      options.push(`
        <button
          type="button"
          class="date-option date-option--custom${isActive ? ' is-active' : ''}"
          data-date="${state.date}"
          aria-pressed="true"
          aria-label="${fullDateOf(state.date)}，已选择"
        >
          <span class="dow">已选</span>
          <span class="day">${parseISODate(state.date).getDate()}</span>
          <span class="month">${parseISODate(state.date).getMonth() + 1}月</span>
        </button>
      `);
    }

    dateRail.innerHTML = options.join('');

    const customLabel = $('#customDateLabel');
    if (customLabel) {
      if (state.customDate) {
        customLabel.hidden = false;
        customLabel.textContent = `已选 ${monthDayOf(state.customDate)}`;
      } else {
        customLabel.hidden = true;
        customLabel.textContent = '';
      }
    }

    if (hadFocus) {
      const active = dateRail.querySelector('.date-option.is-active');
      if (active) active.focus({ preventScroll: true });
    }
  }

  function selectDate(iso, { announce = true } = {}) {
    if (!isDateBookable(iso)) {
      showToast('只能预约未来 30 天内的日期');
      return;
    }

    const quickDates = getQuickDates();
    state.date = iso;
    state.customDate = quickDates.includes(iso) ? null : iso;
    state.time = null;

    renderDateRail();
    const availableCount = renderTimes({ announce: false });
    updateSummary();

    if (announce) {
      const dateLive = $('#dateLive');
      if (dateLive) {
        dateLive.textContent = `${fullDateOf(iso)}，${availableCount ? `共 ${availableCount} 个时段可约，请选择到店时段。` : '当天暂无可预约时段，请选择其他日期。'}`;
      }
    }
  }

  /* =========================================================
     Time slots
     ========================================================= */

  function renderTimes({ announce = false } = {}) {
    const timeGroups = $('#timeGroups');
    const slotHint = $('#slotHint');
    const timeLive = $('#timeLive');
    if (!timeGroups) return 0;

    const reservations = loadReservations();
    const slots = buildSlots();
    const infos = slots.map((time) => ({ time, ...getSlotInfo(time, state.date, state.party, reservations) }));
    const available = infos.filter((info) => info.state === 'available');

    if (state.time) {
      const current = infos.find((info) => info.time === state.time);
      if (!current || current.state !== 'available') state.time = null;
    }

    if (!available.length) {
      const allPast = infos.every((info) => info.state === 'past');
      const allFull = infos.every((info) => info.state === 'full');
      let message = '这一天已无可预约时段，请选择其他日期。';
      if (allPast) {
        message = '今天的可预约时段已过，请选择其他日期。';
      } else if (allFull) {
        message = `这一天的座位已约满，请选择其他日期，或致电 <a href="tel:${CONFIG.phone}">${CONFIG.phoneDisplay}</a>。`;
      }
      timeGroups.innerHTML = `<p class="slot-empty-note">${message}</p>`;
      if (slotHint) slotHint.textContent = '暂无可约时段';
      updateSummary();
      if (announce && timeLive) {
        timeLive.textContent = `${monthDayOf(state.date)}暂无可预约时段。`;
      }
      return 0;
    }

    const groups = [
      { name: '午市', range: '11:30–14:00', test: (minutes) => minutes <= 14 * 60 },
      { name: '午后', range: '14:30–16:30', test: (minutes) => minutes >= 14 * 60 + 30 && minutes <= 16 * 60 + 30 },
      { name: '晚市', range: '17:00–20:00', test: (minutes) => minutes >= 17 * 60 }
    ];

    const html = groups.map((group) => {
      const groupInfos = infos.filter((info) => (
        group.test(timeToMinutes(info.time)) && info.state !== 'past'
      ));
      if (!groupInfos.length) return '';

      const slotsHtml = groupInfos.map((info) => {
        const isActive = state.time === info.time;
        const isDisabled = info.state !== 'available';
        const stateClass = info.state === 'full' ? 'is-full' : info.state === 'past' ? 'is-past' : '';
        const label = slotLabel(info);

        return `
          <label class="slot ${stateClass}${isActive ? ' is-active' : ''}" data-state="${info.state}" data-label="${label}">
            <input
              type="radio"
              name="bookingTime"
              value="${info.time}"
              ${isActive ? 'checked' : ''}
              ${isDisabled ? 'disabled' : ''}
            >
            <span class="slot-time">${info.time}</span>
            <span class="slot-state">${isActive ? '已选' : label}</span>
          </label>
        `;
      }).join('');

      return `
        <div class="time-group">
          <div class="time-group-head"><span>${group.name}</span><em>${group.range}</em></div>
          <div class="slots">${slotsHtml}</div>
        </div>
      `;
    }).join('');

    timeGroups.innerHTML = html;

    if (slotHint) {
      const now = getShanghaiNow();
      const prefix = state.date === now.date ? '今天' : monthDayOf(state.date);
      slotHint.textContent = `${prefix} · ${available.length} 个时段可约`;
    }

    updateSummary();

    if (announce && timeLive) {
      timeLive.textContent = `${fullDateOf(state.date)}，可预约时段已更新，共 ${available.length} 个。`;
    }

    return available.length;
  }

  function syncSlotStyles() {
    $$('.slot', $('#timeGroups')).forEach((label) => {
      const input = $('input', label);
      const isActive = Boolean(input && input.checked);
      label.classList.toggle('is-active', isActive);
      const stateLabel = label.dataset.label || '有位';
      const stateEl = $('.slot-state', label);
      if (stateEl) stateEl.textContent = isActive ? '已选' : stateLabel;
    });
  }

  /* =========================================================
     Party size & summary
     ========================================================= */

  function updateParty(newParty) {
    state.party = Math.min(CONFIG.maxParty, Math.max(1, Number(newParty) || 1));

    const partyValue = $('#partyValue');
    const minus = $('#partyMinus');
    const plus = $('#partyPlus');

    if (partyValue) partyValue.innerHTML = `${state.party}<span>位</span>`;
    if (minus) minus.disabled = state.party <= 1;
    if (plus) plus.disabled = state.party >= CONFIG.maxParty;

    if (state.time) {
      const current = getSlotInfo(state.time, state.date, state.party);
      if (current.state !== 'available') state.time = null;
    }

    renderTimes({ announce: true });
    updateSummary();
  }

  function updateSummary() {
    const summaryDate = $('#summaryDate');
    const summaryTime = $('#summaryTime');
    const summaryParty = $('#summaryParty');
    const summaryStatus = $('#summaryStatus');
    const submitBtn = $('#submitBtn');
    if (!summaryDate || !summaryTime || !summaryParty || !summaryStatus || !submitBtn) return;

    summaryDate.textContent = state.date ? relativeDateOf(state.date) : '选择日期';
    summaryTime.textContent = state.time || '—';
    summaryParty.textContent = `${state.party} 位`;
    summaryStatus.classList.remove('is-warning');

    let info = null;
    if (state.date && state.time) {
      info = getSlotInfo(state.time, state.date, state.party);
    }

    const canSubmit = Boolean(info && info.state === 'available');

    if (!state.date) {
      summaryStatus.textContent = '请选择到店日期';
    } else if (!state.time) {
      summaryStatus.textContent = '请选择到店时段';
    } else if (!info || info.state === 'full') {
      summaryStatus.textContent = '该时段刚刚约满，请换一个时段';
      summaryStatus.classList.add('is-warning');
    } else if (info.state === 'past') {
      summaryStatus.textContent = '该时段已不可预约，请换一个时段';
      summaryStatus.classList.add('is-warning');
    } else {
      summaryStatus.textContent = `所选时段尚有余位（余 ${info.remaining} 桌），提交后为你留位`;
    }

    submitBtn.disabled = !canSubmit || state.submitting;
  }

  function resetSubmitButton() {
    const submitBtn = $('#submitBtn');
    if (!submitBtn) return;
    submitBtn.innerHTML = '确认预约 <svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
  }

  /* =========================================================
     Validation
     ========================================================= */

  function setFieldError(fieldId, inputId, errorId, message) {
    const field = document.getElementById(fieldId);
    const input = document.getElementById(inputId);
    const error = document.getElementById(errorId);
    if (!field || !input || !error) return;

    field.classList.toggle('is-invalid', Boolean(message));
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    error.textContent = message || '';
    error.hidden = !message;
  }

  function clearFieldError(fieldId, inputId, errorId) {
    setFieldError(fieldId, inputId, errorId, '');
  }

  function validateName() {
    const value = $('#guestName').value.trim();
    let message = '';
    if (value.length < 2) message = '请填写至少 2 个字的称呼';
    else if (value.length > 20) message = '称呼请保持在 20 个字以内';
    setFieldError('nameField', 'guestName', 'nameError', message);
    return message;
  }

  function validatePhone(value = $('#guestPhone').value.trim()) {
    const message = /^1[3-9]\d{9}$/.test(value) ? '' : '请填写正确的 11 位手机号';
    setFieldError('phoneField', 'guestPhone', 'phoneError', message);
    return message;
  }

  /* =========================================================
     Create reservation
     ========================================================= */

  function generateId() {
    return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function generateCode(date) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const existing = new Set(loadReservations().map((reservation) => reservation.code));
    const prefix = `SY-${date.slice(5, 7)}${date.slice(8, 10)}`;
    let code = '';
    do {
      let suffix = '';
      for (let index = 0; index < 4; index += 1) {
        suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
      }
      code = `${prefix}-${suffix}`;
    } while (existing.has(code));
    return code;
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (state.submitting) return;

    const name = $('#guestName').value.trim().replace(/\s+/g, ' ');
    const phone = $('#guestPhone').value.trim();
    const note = $('#guestNote').value.trim();

    const nameError = validateName();
    const phoneError = validatePhone(phone);

    if (!state.date || !state.time) {
      showToast('请先选择到店日期和时段');
      return;
    }

    if (nameError || phoneError) {
      if (nameError) $('#guestName').focus();
      else $('#guestPhone').focus();
      return;
    }

    const reservations = loadReservations();
    const info = getSlotInfo(state.time, state.date, state.party, reservations);

    if (info.state !== 'available') {
      showToast('这个时段刚刚约满了，请换一个时段');
      state.time = null;
      renderTimes();
      updateSummary();
      return;
    }

    const duplicate = reservations.some((reservation) => (
      reservation.status === 'confirmed' &&
      reservation.phone === phone &&
      reservation.date === state.date &&
      reservation.time === state.time
    ));

    if (duplicate) {
      showToast('这个手机号已经预约过该时段了');
      return;
    }

    state.submitting = true;
    const submitBtn = $('#submitBtn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '正在为你留位…';
    }

    window.setTimeout(() => {
      const latestReservations = loadReservations();

      // Re-check capacity just before writing, in case another tab booked at the same time.
      const latestInfo = getSlotInfo(state.time, state.date, state.party, latestReservations);
      if (latestInfo.state !== 'available') {
        state.submitting = false;
        resetSubmitButton();
        state.time = null;
        renderTimes();
        updateSummary();
        showToast('这个时段刚刚约满了，请换一个时段');
        return;
      }

      const reservation = {
        id: generateId(),
        code: generateCode(state.date),
        date: state.date,
        time: state.time,
        party: state.party,
        name,
        phone,
        note,
        status: 'confirmed',
        createdAt: new Date().toISOString()
      };

      const saved = saveReservations([...latestReservations, reservation]);
      saveProfile(name, phone);

      state.submitting = false;
      state.lastReservation = reservation;
      resetSubmitButton();
      renderTimes();
      updateSummary();
      showSuccess(reservation);

      if (!saved) {
        showToast('预约已生成，但未能保存到本设备，请保留预约号。', 5200);
      }
    }, 560);
  }

  function showSuccess(reservation) {
    const shell = $('#bookingShell');
    const success = $('#bookingSuccess');
    if (!shell || !success) return;

    $('#successCode').textContent = reservation.code;
    $('#successDate').textContent = `${monthDayOf(reservation.date)} · ${weekdayOf(reservation.date)}`;
    $('#successTime').textContent = reservation.time;
    $('#successParty').textContent = `${reservation.party} 位`;
    $('#successName').textContent = reservation.name;

    shell.classList.add('is-success', 'is-in');
    success.hidden = false;
    success.focus({ preventScroll: true });

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    shell.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  }

  function bookAgain() {
    const shell = $('#bookingShell');
    const success = $('#bookingSuccess');
    if (!shell || !success) return;

    shell.classList.remove('is-success');
    success.hidden = true;
    state.time = null;
    state.submitting = false;

    const note = $('#guestNote');
    if (note) {
      note.value = '';
      updateNoteCount();
    }

    resetSubmitButton();
    renderTimes();
    updateSummary();
    shell.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

    window.setTimeout(() => {
      const activeDate = $('#dateRail .date-option.is-active');
      if (activeDate) activeDate.focus({ preventScroll: true });
    }, 420);
  }

  /* =========================================================
     Calendar file
     ========================================================= */

  function escapeICS(value) {
    return String(value == null ? '' : value)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function toICSDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function downloadCalendar() {
    const reservation = state.lastReservation;
    if (!reservation) {
      showToast('暂无可加入日历的预约');
      return;
    }

    const [year, month, day] = reservation.date.split('-').map(Number);
    const [hours, minutes] = reservation.time.split(':').map(Number);
    const start = new Date(Date.UTC(year, month - 1, day, hours, minutes) - 8 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 90 * 60 * 1000);

    const description = [
      `预约号：${reservation.code}`,
      `预约人：${reservation.name}`,
      `人数：${reservation.party} 位`,
      reservation.note ? `备注：${reservation.note}` : '',
      `电话：${CONFIG.phoneDisplay}`
    ].filter(Boolean).join('\n');

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Shan You Xiao Chu//Reservation//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:山有小厨预约',
      'BEGIN:VEVENT',
      `UID:${reservation.id}@shanyouxiaochu.local`,
      `DTSTAMP:${toICSDate(new Date())}`,
      `DTSTART:${toICSDate(start)}`,
      `DTEND:${toICSDate(end)}`,
      `SUMMARY:${escapeICS(`山有小厨 · ${reservation.party} 人用餐`)}`,
      `LOCATION:${escapeICS('辽宁省沈阳市沈河区风雨坛街道北二经街79号')}`,
      `DESCRIPTION:${escapeICS(description)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR'
    ];

    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `山有小厨-${reservation.date}-${reservation.time.replace(':', '')}.ics`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1600);
    showToast('日历文件已生成');
  }

  /* =========================================================
     Bookings dialog
     ========================================================= */

  function showLookupPrompt() {
    const list = $('#bookingsList');
    if (!list) return;
    state.lookupPhone = '';
    list.innerHTML = `
      <div class="empty-state">
        <svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg>
        <p>输入手机号，查看本机的预约记录。</p>
      </div>
    `;
  }

  function openBookings(trigger, options = {}) {
    const dialog = $('#bookingsDialog');
    if (!dialog || typeof dialog.showModal !== 'function') {
      showToast('请使用现代浏览器打开预约查询');
      return;
    }
    if (dialog.open) return;

    lastDialogTrigger = trigger || document.activeElement;
    const profile = loadProfile();
    const phone = options.phone || (state.lastReservation && state.lastReservation.phone) || profile.phone || '';
    const input = $('#lookupPhone');
    const error = $('#lookupError');
    if (input) input.value = phone;
    if (error) {
      error.hidden = true;
      error.textContent = '';
      input && input.setAttribute('aria-invalid', 'false');
    }

    if (phone) {
      renderBookings(phone);
    } else {
      showLookupPrompt();
    }

    document.body.classList.add('no-scroll');
    dialog.showModal();
    updateMobileCta();

    window.setTimeout(() => {
      if (input) input.focus({ preventScroll: true });
    }, 60);
  }

  function closeBookings() {
    const dialog = $('#bookingsDialog');
    if (dialog && dialog.open) dialog.close();
  }

  function isReservationFuture(reservation) {
    const now = getShanghaiNow();
    if (reservation.date > now.date) return true;
    if (reservation.date < now.date) return false;
    return timeToMinutes(reservation.time) > now.minutes;
  }

  function renderBookings(phone) {
    const list = $('#bookingsList');
    if (!list) return;

    state.lookupPhone = phone;
    const all = loadReservations().filter((reservation) => reservation.phone === phone);

    if (!all.length) {
      list.innerHTML = `
        <div class="empty-state">
          <svg class="icon" aria-hidden="true"><use href="#i-calendar"/></svg>
          <p>这个手机号下还没有预约记录。</p>
          <p>可以换一个号码试试，或直接致电 ${CONFIG.phoneDisplay}。</p>
        </div>
      `;
      return;
    }

    all.sort((a, b) => {
      const rank = (reservation) => {
        if (reservation.status === 'cancelled') return 2;
        return isReservationFuture(reservation) ? 0 : 1;
      };
      const rankDifference = rank(a) - rank(b);
      if (rankDifference !== 0) return rankDifference;
      return `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`);
    });

    list.innerHTML = all.map((reservation) => {
      const future = isReservationFuture(reservation);
      const cancelled = reservation.status === 'cancelled';
      let statusText = '已确认';
      let statusClass = '';
      if (cancelled) {
        statusText = '已取消';
        statusClass = 'status-badge--cancelled';
      } else if (!future) {
        statusText = '已结束';
        statusClass = 'status-badge--past';
      }

      let actions = '';
      if (cancelled) {
        actions = '<span class="booking-item-hint">该预约已取消</span>';
      } else if (future) {
        actions = `
          <button class="cancel-btn" type="button" data-cancel-id="${escapeHtml(reservation.id)}">取消预约</button>
          <a class="booking-item-phone" href="tel:${CONFIG.phone}">致电改期</a>
        `;
      } else {
        actions = '<span class="booking-item-hint">预约时间已过</span>';
      }

      return `
        <article class="booking-item" data-id="${escapeHtml(reservation.id)}">
          <div class="booking-item-head">
            <div>
              <div class="booking-item-date">${monthDayOf(reservation.date)} · ${weekdayOf(reservation.date)}</div>
              <div class="booking-item-meta">${escapeHtml(reservation.time)} · ${Number(reservation.party) || 1} 位 · ${escapeHtml(reservation.name)}</div>
            </div>
            <span class="status-badge ${statusClass}">${statusText}</span>
          </div>
          ${reservation.note ? `<p class="booking-item-note">备注：${escapeHtml(reservation.note)}</p>` : ''}
          <div class="booking-item-code">预约号 ${escapeHtml(reservation.code)}</div>
          <div class="booking-item-actions">${actions}</div>
        </article>
      `;
    }).join('');
  }

  function requestCancel(id, button) {
    const item = button.closest('.booking-item');
    if (!item) return;
    const actions = $('.booking-item-actions', item);
    if (!actions) return;
    actions.innerHTML = `
      <div class="confirm-cancel">
        <span>确定要取消这个预约吗？</span>
        <button class="confirm-yes" type="button" data-confirm-cancel-id="${escapeHtml(id)}">确定取消</button>
        <button type="button" data-cancel-abort>保留预约</button>
      </div>
    `;
  }

  function cancelReservation(id) {
    const reservations = loadReservations();
    const index = reservations.findIndex((reservation) => reservation.id === id);
    if (index < 0) {
      showToast('没有找到这个预约');
      return;
    }
    if (reservations[index].status === 'cancelled') {
      renderBookings(state.lookupPhone);
      return;
    }

    const cancellingLast = Boolean(state.lastReservation && state.lastReservation.id === id);
    reservations[index] = {
      ...reservations[index],
      status: 'cancelled',
      cancelledAt: new Date().toISOString()
    };

    const saved = saveReservations(reservations);

    if (cancellingLast) {
      state.lastReservation = null;
      const shell = $('#bookingShell');
      const success = $('#bookingSuccess');
      if (shell && shell.classList.contains('is-success')) {
        shell.classList.remove('is-success');
        if (success) success.hidden = true;
        resetSubmitButton();
        state.time = null;
      }
    }

    renderBookings(state.lookupPhone);
    renderTimes();
    updateSummary();
    showToast(saved ? '预约已取消' : '预约已取消，但本设备未能保存记录');
  }

  /* =========================================================
     Header, menu, scroll
     ========================================================= */

  function setupHeader() {
    const header = $('#siteHeader');
    const onScroll = () => {
      if (!header) return;
      header.classList.toggle('is-scrolled', window.scrollY > 24);
      updateMobileCta();
      if (window.scrollY < 140) {
        $$('.main-nav a').forEach((link) => {
          link.classList.remove('is-active');
          link.removeAttribute('aria-current');
        });
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  function setupScrollSpy() {
    if (!('IntersectionObserver' in window)) return;

    const navLinks = new Map($$('.main-nav a[data-nav]').map((link) => [link.dataset.nav, link]));
    const sections = $$('#about, #menu, #space, #reserve, #visit');
    if (!sections.length) return;

    const clearActive = () => {
      navLinks.forEach((link) => {
        link.classList.remove('is-active');
        link.removeAttribute('aria-current');
      });
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        clearActive();
        if (entry.target.id === 'reserve') return;
        const link = navLinks.get(entry.target.id);
        if (link) {
          link.classList.add('is-active');
          link.setAttribute('aria-current', 'location');
        }
      });
    }, { rootMargin: '-34% 0px -55% 0px', threshold: 0 });

    sections.forEach((section) => observer.observe(section));
  }

  function setupMobileMenu() {
    const toggle = $('#menuToggle');
    const menu = $('#mobileMenu');
    if (!toggle || !menu) return;

    const setMenu = (open, { restoreFocus = true } = {}) => {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单');
      menu.setAttribute('aria-hidden', String(!open));
      menu.classList.toggle('is-open', open);
      document.body.classList.toggle('no-scroll', open);
      updateMobileCta();

      if (open) {
        window.setTimeout(() => {
          const firstLink = $('.mobile-nav a', menu);
          if (firstLink) firstLink.focus({ preventScroll: true });
        }, 220);
      } else if (restoreFocus) {
        toggle.focus({ preventScroll: true });
      }
    };

    toggle.addEventListener('click', () => {
      setMenu(toggle.getAttribute('aria-expanded') !== 'true');
    });

    $$('a', menu).forEach((link) => {
      link.addEventListener('click', () => setMenu(false, { restoreFocus: false }));
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && menu.classList.contains('is-open')) {
        setMenu(false);
      }
    });

    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Tab' || !menu.classList.contains('is-open')) return;
      const focusable = [toggle, ...$$('a, button', menu)].filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && menu.classList.contains('is-open')) {
        setMenu(false, { restoreFocus: false });
      }
      updateMobileCta();
    });
  }

  function setupMobileCta() {
    const cta = $('#mobileCta');
    const reserve = $('#reserve');
    if (!cta) return;

    if (reserve && 'IntersectionObserver' in window) {
      mobileCtaObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          reserveSectionVisible = entry.isIntersecting;
        });
        updateMobileCta();
      }, { threshold: 0.06 });
      mobileCtaObserver.observe(reserve);
    }

    updateMobileCta();
  }

  function updateMobileCta() {
    const cta = $('#mobileCta');
    if (!cta) return;
    const dialog = $('#bookingsDialog');
    const menu = $('#mobileMenu');
    const shouldShow = window.innerWidth <= 700 &&
      window.scrollY > 460 &&
      !document.body.classList.contains('no-scroll') &&
      !(dialog && dialog.open) &&
      !(menu && menu.classList.contains('is-open'));

    cta.classList.toggle('is-visible', shouldShow && !reserveSectionVisible);
  }

  /* =========================================================
     Reveal animations
     ========================================================= */

  function setupReveal() {
    const elements = $$('.reveal');
    if (!elements.length) return;

    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach((element) => element.classList.add('is-in'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -7% 0px' });

    elements.forEach((element) => observer.observe(element));
  }

  /* =========================================================
     Open state
     ========================================================= */

  function updateOpenState() {
    const now = getShanghaiNow();
    const isOpen = now.minutes >= CONFIG.openMinutes && now.minutes < CONFIG.closeMinutes;
    const openState = $('#openState');
    const status = $('#openStatus');
    const hours = $('.open-hours');
    if (!openState || !status || !hours) return;

    openState.dataset.state = isOpen ? 'open' : 'closed';
    status.textContent = isOpen ? '营业中' : '已打烊';

    if (isOpen) {
      hours.textContent = '每日 11:30–20:30';
    } else if (now.minutes < CONFIG.openMinutes) {
      hours.textContent = '今日 11:30 开门';
    } else {
      hours.textContent = '明日 11:30 开门';
    }
  }

  /* =========================================================
     Init
     ========================================================= */

  function updateNoteCount() {
    const note = $('#guestNote');
    const count = $('#noteCount');
    if (note && count) count.textContent = String(note.value.length);
  }

  function initBookingState() {
    const now = getShanghaiNow();

    state.date = now.date;
    if (!hasAvailableSlot(state.date, state.party)) {
      state.date = addDaysISO(now.date, 1);
    }

    const picker = $('#datePicker');
    if (picker) {
      picker.min = now.date;
      picker.max = addDaysISO(now.date, CONFIG.daysAhead);
      picker.value = '';
    }

    renderDateRail();
    renderTimes();
    updateSummary();
  }

  function setupBookingEvents() {
    const dateRail = $('#dateRail');
    if (dateRail) {
      dateRail.addEventListener('click', (event) => {
        const button = event.target.closest('.date-option');
        if (!button) return;
        const date = button.dataset.date;
        if (date && date !== state.date) selectDate(date);
      });
    }

    const moreDateBtn = $('#moreDateBtn');
    const datePicker = $('#datePicker');
    if (moreDateBtn && datePicker) {
      const showNativePicker = () => {
        if (typeof datePicker.showPicker === 'function') {
          try {
            datePicker.showPicker();
            return;
          } catch (error) {
            // Some browsers require the input to be visible before opening the native picker.
          }
        }
        datePicker.classList.add('is-visible');
        datePicker.removeAttribute('aria-hidden');
        datePicker.tabIndex = 0;
        datePicker.focus();
        try {
          datePicker.click();
        } catch (error) {
          // The visible date input is still usable if click() is not allowed.
        }
      };

      moreDateBtn.addEventListener('click', () => {
        datePicker.value = '';
        showNativePicker();
      });

      datePicker.addEventListener('change', () => {
        const value = datePicker.value;
        if (!value) return;
        if (!isDateBookable(value)) {
          showToast('只能预约未来 30 天内的日期');
          datePicker.value = '';
          return;
        }
        selectDate(value);
        datePicker.value = '';
        datePicker.classList.remove('is-visible');
        datePicker.setAttribute('aria-hidden', 'true');
        datePicker.tabIndex = -1;
      });
    }

    const minus = $('#partyMinus');
    const plus = $('#partyPlus');
    if (minus) minus.addEventListener('click', () => updateParty(state.party - 1));
    if (plus) plus.addEventListener('click', () => updateParty(state.party + 1));

    const timeGroups = $('#timeGroups');
    if (timeGroups) {
      timeGroups.addEventListener('change', (event) => {
        if (!event.target.matches('input[name="bookingTime"]')) return;
        state.time = event.target.value;
        syncSlotStyles();
        updateSummary();
        const timeLive = $('#timeLive');
        if (timeLive) {
          timeLive.textContent = `已选择 ${state.time}，${state.party} 位。`;
        }
      });
    }

    const form = $('#bookingForm');
    if (form) form.addEventListener('submit', handleSubmit);

    const name = $('#guestName');
    if (name) {
      name.addEventListener('input', () => clearFieldError('nameField', 'guestName', 'nameError'));
    }

    const phone = $('#guestPhone');
    if (phone) {
      phone.addEventListener('input', () => {
        phone.value = phone.value.replace(/\D/g, '').slice(0, 11);
        clearFieldError('phoneField', 'guestPhone', 'phoneError');
      });
    }

    const note = $('#guestNote');
    if (note) note.addEventListener('input', updateNoteCount);

    const bookAgainBtn = $('#bookAgainBtn');
    if (bookAgainBtn) bookAgainBtn.addEventListener('click', bookAgain);

    const addCalendarBtn = $('#addCalendarBtn');
    if (addCalendarBtn) addCalendarBtn.addEventListener('click', downloadCalendar);

    const viewBookingsBtn = $('#viewBookingsBtn');
    if (viewBookingsBtn) {
      viewBookingsBtn.addEventListener('click', () => {
        openBookings(viewBookingsBtn, { phone: state.lastReservation ? state.lastReservation.phone : '' });
      });
    }

    updateNoteCount();
    updateParty(state.party);
    resetSubmitButton();
    updateSummary();
  }

  function setupBookingsDialog() {
    const dialog = $('#bookingsDialog');
    if (!dialog) return;

    $$('[data-open-bookings]').forEach((button) => {
      button.addEventListener('click', () => openBookings(button));
    });

    const closeButton = $('[data-close-dialog]', dialog);
    if (closeButton) closeButton.addEventListener('click', closeBookings);

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) closeBookings();
    });

    dialog.addEventListener('close', () => {
      document.body.classList.remove('no-scroll');
      updateMobileCta();
      if (lastDialogTrigger && typeof lastDialogTrigger.focus === 'function') {
        lastDialogTrigger.focus({ preventScroll: true });
      }
    });

    const lookupForm = $('#lookupForm');
    if (lookupForm) {
      lookupForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const input = $('#lookupPhone');
        const error = $('#lookupError');
        const phone = input.value.trim();

        if (!/^1[3-9]\d{9}$/.test(phone)) {
          if (error) {
            error.textContent = '请填写正确的 11 位手机号';
            error.hidden = false;
          }
          input.setAttribute('aria-invalid', 'true');
          input.focus();
          return;
        }

        if (error) {
          error.hidden = true;
          error.textContent = '';
        }
        input.setAttribute('aria-invalid', 'false');
        renderBookings(phone);
      });
    }

    const lookupPhone = $('#lookupPhone');
    if (lookupPhone) {
      lookupPhone.addEventListener('input', () => {
        lookupPhone.value = lookupPhone.value.replace(/\D/g, '').slice(0, 11);
        const error = $('#lookupError');
        if (error) {
          error.hidden = true;
          error.textContent = '';
        }
        lookupPhone.setAttribute('aria-invalid', 'false');
      });
    }

    const list = $('#bookingsList');
    if (list) {
      list.addEventListener('click', (event) => {
        const cancelButton = event.target.closest('[data-cancel-id]');
        if (cancelButton) {
          requestCancel(cancelButton.dataset.cancelId, cancelButton);
          return;
        }

        const confirmButton = event.target.closest('[data-confirm-cancel-id]');
        if (confirmButton) {
          cancelReservation(confirmButton.dataset.confirmCancelId);
          return;
        }

        if (event.target.closest('[data-cancel-abort]')) {
          renderBookings(state.lookupPhone);
        }
      });
    }
  }

  function init() {
    const year = $('#year');
    if (year) year.textContent = String(getShanghaiNow().year);

    const profile = loadProfile();
    if (profile.name) {
      const name = $('#guestName');
      if (name) name.value = profile.name;
    }
    if (profile.phone) {
      const phone = $('#guestPhone');
      if (phone) phone.value = profile.phone;
    }

    setupHeader();
    setupScrollSpy();
    setupMobileMenu();
    setupMobileCta();
    setupReveal();
    updateOpenState();
    initBookingState();
    setupBookingEvents();
    setupBookingsDialog();

    updateOpenState();
    window.setInterval(updateOpenState, 60 * 1000);

    window.addEventListener('storage', (event) => {
      if (event.key === CONFIG.storageKey) {
        renderTimes();
        updateSummary();
        if ($('#bookingsDialog').open && state.lookupPhone) {
          renderBookings(state.lookupPhone);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
