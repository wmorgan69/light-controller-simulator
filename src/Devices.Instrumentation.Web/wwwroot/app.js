let refreshInProgress = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function getTotals(controllers) {
  return controllers.reduce((totals, controller) => {
    const rooms = controller.rooms ?? [];
    totals.controllers += 1;
    const status = String(controller.status).toLowerCase();
    totals.online += status !== 'offline' ? 1 : 0;
    totals.faulted += status === 'faulted' ? 1 : 0;
    totals.faults += (controller.faults ?? []).length;
    totals.rooms += rooms.length;
    totals.presence += rooms.filter(room => room.presence).length;
    for (const room of rooms) {
      for (const strip of room.lightStrips ?? []) {
        totals.strips += 1;
        totals.lightsOn += strip.isOn && !strip.isFaulted ? 1 : 0;
        totals.stripsFaulted += strip.isFaulted ? 1 : 0;
      }
    }
    return totals;
  }, {
    controllers: 0,
    online: 0,
    faulted: 0,
    faults: 0,
    rooms: 0,
    presence: 0,
    strips: 0,
    lightsOn: 0,
    stripsFaulted: 0
  });
}

function renderSummary(totals) {
  const cards = [
    { label: 'Controllers online', value: totals.online, note: `of ${totals.controllers} total`, accent: 'teal' },
    { label: 'Active faults', value: totals.faults, note: `${totals.faulted} controller${totals.faulted === 1 ? '' : 's'} affected`, accent: totals.faults ? 'red' : 'green' },
    { label: 'Lights on', value: totals.lightsOn, note: `of ${totals.strips} fixtures`, accent: 'amber' },
    { label: 'Occupied rooms', value: totals.presence, note: `of ${totals.rooms} monitored`, accent: 'blue' }
  ];

  document.querySelector('#summaryCards').innerHTML = cards.map(card => `
    <article class="summary-card accent-${card.accent}">
      <p class="summary-label">${card.label}</p>
      <div class="summary-value">${card.value}</div>
      <p class="summary-note">${card.note}</p>
    </article>`).join('');
}

function renderLightingSummary(totals) {
  const off = Math.max(0, totals.strips - totals.lightsOn - totals.stripsFaulted);
  const denominator = totals.strips || 1;
  const onWidth = totals.lightsOn / denominator * 100;
  const offWidth = off / denominator * 100;
  const faultWidth = totals.stripsFaulted / denominator * 100;

  document.querySelector('#activityCaption').textContent =
    `${totals.lightsOn} of ${totals.strips} fixtures currently on`;
  document.querySelector('#lightingSummary').innerHTML = totals.strips
    ? `<div class="activity-bar" role="img" aria-label="${totals.lightsOn} lights on, ${off} off, ${totals.stripsFaulted} faulted">
        <span class="activity-segment segment-on" style="width:${onWidth}%"></span>
        <span class="activity-segment segment-off" style="width:${offWidth}%"></span>
        <span class="activity-segment segment-fault" style="width:${faultWidth}%"></span>
      </div>
      <div class="activity-legend">
        <span><i class="legend-dot dot-on"></i><strong>${totals.lightsOn}</strong> On</span>
        <span><i class="legend-dot dot-off"></i><strong>${off}</strong> Off</span>
        <span><i class="legend-dot dot-fault"></i><strong>${totals.stripsFaulted}</strong> Faulted</span>
      </div>`
    : '<p class="empty-state">Lighting data will appear when controllers report.</p>';
}

function renderRoom(room) {
  const strips = room.lightStrips ?? [];
  const onCount = strips.filter(strip => strip.isOn && !strip.isFaulted).length;
  const presence = room.presence
    ? '<span class="room-presence present"><i></i>Occupied</span>'
    : '<span class="room-presence"><i></i>Vacant</span>';
  const stripVisual = strips.length
    ? `<div class="fixture-row" role="img" aria-label="${onCount} of ${strips.length} lights on">
        <span class="fixture-markers">${strips.map(strip => {
          const state = strip.isFaulted ? 'fixture-fault' : strip.isOn ? 'fixture-on' : 'fixture-off';
          const description = strip.isFaulted ? 'faulted' : strip.isOn ? 'on' : 'off';
          return `<i class="fixture-marker ${state}" title="${escapeHtml(strip.id)}: ${description}" aria-hidden="true"></i>`;
        }).join('')}</span>
        <span class="fixture-count">${onCount}/${strips.length}</span>
      </div>`
    : '<span class="fixture-count">No fixtures</span>';

  return `<div class="room-row">
    <div class="room-info">
      <span class="room-name">${escapeHtml(room.name)}</span>
      ${presence}
    </div>
    ${stripVisual}
  </div>`;
}

function renderControllers(controllers) {
  document.querySelector('#controllerCount').textContent =
    `${controllers.length} FLOOR${controllers.length === 1 ? '' : 'S'}`;
  document.querySelector('#controllers').innerHTML = controllers.length
    ? controllers.map(controller => {
      const state = String(controller.status ?? 'unknown').toLowerCase();
      const statusClass = ['healthy', 'faulted', 'offline'].includes(state) ? state : 'unknown';
      const faults = controller.faults ?? [];
      const rooms = controller.rooms ?? [];
      const lightsOn = rooms.reduce((count, room) =>
        count + (room.lightStrips ?? []).filter(strip => strip.isOn && !strip.isFaulted).length, 0);
      const lightTotal = rooms.reduce((count, room) => count + (room.lightStrips ?? []).length, 0);
      const roomContent = rooms.length
        ? rooms.map(renderRoom).join('')
        : '<p class="empty-state compact">No room data reported.</p>';

      return `<article class="controller-card status-${statusClass}">
        <div class="controller-header">
          <div class="floor-badge" aria-hidden="true">${escapeHtml(controller.floor)}</div>
          <div class="controller-title">
            <p class="floor-label">FLOOR ${escapeHtml(controller.floor)}</p>
            <h3>${escapeHtml(controller.id)}</h3>
          </div>
          <span class="status-pill status-pill-${statusClass}"><i></i>${escapeHtml(controller.status)}</span>
        </div>
        <div class="controller-light-summary">
          <span>Lighting load</span>
          <strong>${lightsOn}<small> / ${lightTotal} on</small></strong>
        </div>
        <div class="room-list">${roomContent}</div>
        ${faults.length ? `<div class="fault-callout">
          <strong>${faults.length} active fault${faults.length === 1 ? '' : 's'}</strong>
          <ul>${faults.map(fault => `<li>${escapeHtml(fault.description)}</li>`).join('')}</ul>
        </div>` : ''}
      </article>`;
    }).join('')
    : '<p class="empty-state">Waiting for telemetry or simulator connection.</p>';
}

function renderEvents(events) {
  const visibleEvents = events.slice(0, 12);
  document.querySelector('#eventCount').textContent = events.length ? `${events.length} TOTAL` : '';
  document.querySelector('#events').innerHTML = visibleEvents.length
    ? visibleEvents.map(event => {
      const timestamp = new Date(event.timestamp);
      const time = Number.isNaN(timestamp.getTime())
        ? 'Unknown time'
        : `${timestamp.toLocaleDateString()} · ${timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      const eventType = String(event.eventType ?? 'event');
      const eventClass = eventType.toLowerCase().includes('fault') ? 'event-fault' : 'event-state';
      return `<article class="event-item">
        <span class="event-marker ${eventClass}" aria-hidden="true"></span>
        <div class="event-content">
          <div class="event-title-row">
            <strong>${escapeHtml(eventType.replaceAll('.', ' '))}</strong>
            <time datetime="${escapeHtml(event.timestamp)}">${escapeHtml(time)}</time>
          </div>
          <span class="event-controller">${escapeHtml(event.controllerId)}</span>
        </div>
      </article>`;
    }).join('')
    : '<p class="empty-state">No events recorded yet.</p>';
}

async function refresh() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  try {
    const [snapshotResponse, eventsResponse, statusResponse] = await Promise.all([
      fetch('/api/telemetry'),
      fetch('/api/events'),
      fetch('/api/status')
    ]);
    if (!snapshotResponse.ok || !eventsResponse.ok || !statusResponse.ok)
      throw new Error('Instrumentation API request failed');
    const controllers = await snapshotResponse.json();
    const events = await eventsResponse.json();
    const transport = await statusResponse.json();
    const totals = getTotals(controllers);

    renderSummary(totals);
    renderLightingSummary(totals);
    renderControllers(controllers);
    renderEvents(events);

    const status = document.querySelector('#connectionStatus');
    status.classList.toggle('is-connected', controllers.length > 0);
    status.classList.toggle('is-error', false);
    status.lastChild.textContent = controllers.length
      ? `${controllers.length} controller${controllers.length === 1 ? '' : 's'} reporting · ${transport.mqttConnected ? 'MQTT' : transport.httpAvailable ? 'HTTP fallback' : 'No live transport'}`
      : 'Waiting for simulator telemetry';
  } catch (error) {
    const status = document.querySelector('#connectionStatus');
    status.classList.remove('is-connected');
    status.classList.add('is-error');
    status.lastChild.textContent = 'Instrumentation API unavailable';
    document.querySelector('#summaryCards').innerHTML =
      '<p class="empty-state">Live summary unavailable.</p>';
    document.querySelector('#lightingSummary').innerHTML =
      '<p class="empty-state">Lighting activity unavailable.</p>';
    document.querySelector('#controllers').innerHTML =
      '<p class="empty-state">Could not load controller state. Check the instrumentation service.</p>';
    document.querySelector('#events').innerHTML =
      '<p class="empty-state">Recent events unavailable.</p>';
  } finally {
    refreshInProgress = false;
  }
}

refresh();
setInterval(refresh, 1000);
