import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Box, Paper } from '@mui/material';
import { controllerStatusLabel, eventTypeLabel, localize as t } from './localization.en.js';
import { getTotals, startTelemetryPolling } from './telemetry';
import type {
  ControllerDto,
  DeviceTelemetryDto,
  RoomDto,
  TelemetrySnapshot,
  TelemetryTotals
} from './types';

type DashboardState =
  | { kind: 'waiting' }
  | { kind: 'ready'; snapshot: TelemetrySnapshot }
  | { kind: 'error' };

interface EmptyProps {
  children: ReactNode;
  compact?: boolean;
}

interface SummaryProps {
  totals: TelemetryTotals;
  stale: boolean;
}

interface ActivityProps {
  totals: TelemetryTotals;
}

interface RoomProps {
  room: RoomDto;
}

interface ControllerProps {
  controller: ControllerDto;
  stale: boolean;
}

interface EventsProps {
  events: DeviceTelemetryDto[];
}

function Empty({ children, compact = false }: EmptyProps): ReactElement {
  return <p className={`empty-state${compact ? ' compact' : ''}`}>{children}</p>;
}

function Summary({ totals, stale }: SummaryProps): ReactElement {
  const cards = [
    { key: 'controllersOnline', value: totals.online, note: t('totalControllers', { count: totals.controllers }), accent: 'teal' },
    { key: 'activeFaults', value: totals.faults, note: t('affectedControllers', { count: totals.faulted }), accent: totals.faults ? 'red' : 'green' },
    { key: 'lightsOn', value: totals.lightsOn, note: t('fixtureTotal', { count: totals.strips }), accent: 'amber' },
    { key: 'occupiedRooms', value: totals.presence, note: t('monitoredRooms', { count: totals.rooms }), accent: 'blue' }
  ];
  return <>{cards.map(card => <Paper component="article" elevation={0} className={`summary-card accent-${card.accent}`} key={card.key}>
    <p className="summary-label">{t(stale && card.key === 'controllersOnline' ? 'controllersLastObservedOnline' : card.key)}</p>
    <div className="summary-value">{card.value}</div>
    <p className="summary-note">{card.note}</p>
  </Paper>)}</>;
}

function Activity({ totals }: ActivityProps): ReactElement {
  if (!totals.strips) return <Empty>{t('noLightingData')}</Empty>;
  const off = Math.max(0, totals.strips - totals.lightsOn - totals.stripsFaulted);
  const segments: { key: string; value: number; label?: string }[] = [
    { key: 'on', value: totals.lightsOn },
    { key: 'off', value: off },
    { key: 'fault', value: totals.stripsFaulted, label: 'faulted' }
  ];
  return <>
    <div className="activity-bar" role="img" aria-label={t('activityAriaLabel', { on: totals.lightsOn, off, faulted: totals.stripsFaulted })}>
      {segments.map(segment => <span key={segment.key} className={`activity-segment segment-${segment.key}`} style={{ width: `${segment.value / totals.strips * 100}%` }} />)}
    </div>
    <div className="activity-legend">{segments.map(segment => <span key={segment.key}><i className={`legend-dot dot-${segment.key}`} aria-hidden="true" /><strong>{segment.value}</strong> {t(segment.label ?? segment.key)}</span>)}</div>
  </>;
}

function Room({ room }: RoomProps): ReactElement {
  const strips = room.lightStrips;
  const on = strips.filter(strip => strip.isOn && !strip.isFaulted).length;
  const faulted = strips.filter(strip => strip.isFaulted);
  return <div className="room-row">
    <div className="room-info">
      <span className="room-name">{room.name}</span>
      <span className={`room-presence${room.presence ? ' present' : ''}`}><i aria-hidden="true" />{t(room.presence ? 'occupied' : 'vacant')}</span>
    </div>
    {strips.length ? <div className="fixture-row" role="img" aria-label={t('fixtureRowAriaLabel', { on, total: strips.length, faulted: faulted.length }) + (faulted.length ? `; ${t('faultedFixtureIdentities', { ids: faulted.map(strip => strip.id).join(', ') })}` : '')}>
      <span className="fixture-markers">{strips.map(strip => {
        const state = strip.isFaulted ? 'fault' : strip.isOn ? 'on' : 'off';
        const description = t(strip.isFaulted ? 'fixtureFaulted' : strip.isOn ? 'fixtureOn' : 'fixtureOff');
        return <i key={strip.id} className={`fixture-marker fixture-${state}`} title={t('fixtureTitle', { id: strip.id, state: description })} aria-hidden="true" />;
      })}</span>
      <span className="fixture-count">{on}/{strips.length}{faulted.length > 0 && <> · {t('faultedFixtureCount', { count: faulted.length })}</>}</span>
    </div> : <span className="fixture-count">{t('noFixtures')}</span>}
    {faulted.length > 0 && <p className="fixture-fault-identities">{t('faultedFixtureIdentities', { ids: faulted.map(strip => strip.id).join(', ') })}</p>}
  </div>;
}

function Controller({ controller, stale }: ControllerProps): ReactElement {
  const state = controller.status.toLowerCase();
  const statusClass = !stale && ['healthy', 'faulted', 'offline'].includes(state) ? state : 'unknown';
  const rooms = controller.rooms;
  const faults = controller.faults;
  const strips = rooms.flatMap(room => room.lightStrips);
  const on = strips.filter(strip => strip.isOn && !strip.isFaulted).length;
  return <Paper component="article" elevation={0} className={`controller-card status-${statusClass}`}>
    <div className="controller-header">
      <div className="floor-badge" aria-hidden="true">{controller.floor}</div>
      <div className="controller-title"><h3>{t('floorLabel', { floor: controller.floor })}</h3><p className="controller-id">{t('controllerId', { id: controller.id })}</p></div>
      <span className={`status-pill status-pill-${statusClass}`}><i aria-hidden="true" />{stale ? t('lastObservedStatus', { status: controllerStatusLabel(controller.status) }) : controllerStatusLabel(controller.status)}</span>
    </div>
    <div className="controller-light-summary"><span>{t('controllerLightingLoad')}</span><strong>{on}<small>{t('lightsOnTotal', { count: strips.length })}</small></strong></div>
    <div className="room-list">{rooms.length ? rooms.map(room => <Room key={room.id} room={room} />) : <Empty compact>{t('noRoomData')}</Empty>}</div>
    {faults.length > 0 && <div className="fault-callout"><strong>{t('activeFaultCount', { count: faults.length })}</strong><ul>{faults.map(fault => <li key={fault.id}>{fault.description}</li>)}</ul></div>}
  </Paper>;
}

function Events({ events }: EventsProps): ReactElement {
  if (!events.length) return <Empty>{t('noEvents')}</Empty>;
  return <>{events.map((event, index) => {
    const timestamp = new Date(event.timestamp);
    const time = Number.isNaN(timestamp.getTime()) ? t('unknownTime') : t('eventTime', {
      date: timestamp.toLocaleDateString(),
      time: timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    });
    const eventType = event.eventType || t('defaultEvent');
    return <article className="event-item" key={event.eventId || `${event.timestamp}-${event.controllerId}-${eventType}-${index}`}>
      <span className={`event-marker ${eventType.toLowerCase().includes('fault') ? 'event-fault' : 'event-state'}`} aria-hidden="true" />
      <div className="event-content"><div className="event-title-row"><strong>{eventTypeLabel(eventType)}</strong><time dateTime={event.timestamp}>{time}</time></div><span className="event-controller">{event.controllerId}</span></div>
    </article>;
  })}</>;
}

export default function Dashboard(): ReactElement {
  const [state, setState] = useState<DashboardState>({ kind: 'waiting' });
  const [showAllEvents, setShowAllEvents] = useState(false);
  useEffect(() => startTelemetryPolling({
    fetcher: (input, init) => fetch(input, init),
    onSnapshot: snapshot => setState({ kind: 'ready', snapshot }),
    onError: () => setState({ kind: 'error' }),
    schedule: (callback, delay) => window.setInterval(callback, delay),
    cancel: timer => window.clearInterval(timer)
  }), []);
  const readyState = state.kind === 'ready' ? state : null;
  const error = state.kind === 'error';
  const controllers = readyState?.snapshot.controllers ?? [];
  const events = readyState?.snapshot.events ?? [];
  const visibleEvents = showAllEvents ? events : events.slice(0, 12);
  const totals = readyState ? getTotals(controllers) : null;
  const stale = !!readyState && !readyState.snapshot.transport.mqttConnected && !readyState.snapshot.transport.httpAvailable;
  const status = error ? t('apiUnavailable') : !readyState ? t('connectionWaiting') : stale ? t('telemetryUnavailable') : controllers.length
    ? t('reportingStatus', { count: controllers.length, transport: t(readyState.snapshot.transport.mqttConnected && readyState.snapshot.transport.httpAvailable ? 'mqttAndHttpTransport' : readyState.snapshot.transport.mqttConnected ? 'mqttTransport' : readyState.snapshot.transport.httpAvailable ? 'httpFallbackTransport' : 'noLiveTransport') })
    : t('waitingForSimulatorTelemetry');

  return <>
    <Box component="header" className="topbar">
      <a className="brand" href="/" aria-label={t('brandLabel')}><span className="brand-mark" aria-hidden="true">L</span><span className="brand-copy"><span className="brand-parent">{t('brandParent')} <span className="brand-divider">/</span></span> {t('brandName')}</span></a>
      <p id="connectionStatus" className={`connection-status${error || stale ? ' is-error' : readyState && controllers.length ? ' is-connected' : ''}`} role="status"><span className="status-dot" aria-hidden="true" /><span id="connectionStatusText">{status}</span></p>
    </Box>
    <Box component="main">
      <section className="page-heading" aria-labelledby="pageTitle"><div><p className="eyebrow">{t('liveMonitoring')}</p><h1 id="pageTitle">{t('pageTitle')}</h1><p className="page-intro">{t('pageIntro')}</p></div><p className={`updated-label${stale || error ? ' is-unavailable' : ''}`}><span className="live-pulse" aria-hidden="true" /> {t('updatesAutomatically')}</p></section>
      {(readyState || error) && <p className="http-polling-details">{readyState ? t('httpPollingDetails', {
        state: t(readyState.snapshot.transport.httpAvailable ? 'httpPollingAvailable' : 'httpPollingUnavailable'),
        source: readyState.snapshot.transport.simulatorHttpSource
          ? t('httpPollingSource', { source: readyState.snapshot.transport.simulatorHttpSource })
          : t('httpPollingSourceNotReported')
      }) : t('httpPollingUnknown')}</p>}
      {(stale || error) && <p className="telemetry-notice">{t(stale ? 'lastObservedNotice' : 'retryingTelemetry')}</p>}
      <section id="summaryCards" className="summary-grid" aria-label={t('buildingSummary')}>{error ? <Empty>{t('liveSummaryUnavailable')}</Empty> : totals && <Summary totals={totals} stale={stale} />}</section>
      <div className="dashboard-grid"><div className="primary-column">
        <Paper component="section" elevation={0} className="panel activity-panel" aria-labelledby="activityTitle">
          <div className="section-heading"><div><p className="eyebrow">{t('buildingTotal')}</p><h2 id="activityTitle">{t('activityTitle')}</h2></div><p id="activityCaption" className="muted-caption">{totals && t(stale ? 'activityCaptionObserved' : 'activityCaption', { on: totals.lightsOn, total: totals.strips })}</p></div>
          <div id="lightingSummary">{error ? <Empty>{t('lightingActivityUnavailable')}</Empty> : totals && <Activity totals={totals} />}</div>
        </Paper>
        <section className="controllers-section" aria-labelledby="controllersTitle"><div className="section-heading controllers-heading"><div><p className="eyebrow">{t('floorByFloor')}</p><h2 id="controllersTitle">{t('controllersTitle')}</h2></div><span id="controllerCount" className="section-count">{readyState && t('floorCount', { count: controllers.length })}</span></div>
          <div id="controllers" className="controller-grid">{error ? <Empty>{t('controllerStateUnavailable')}</Empty> : readyState && (controllers.length ? controllers.map(controller => <Controller key={controller.id} controller={controller} stale={stale} />) : <Empty>{t('waitingForTelemetry')}</Empty>)}</div>
        </section>
      </div>
      <Paper component="aside" elevation={0} className="panel events-panel" aria-labelledby="eventsTitle"><div className="section-heading"><div><p className="eyebrow">{t('systemActivity')}</p><h2 id="eventsTitle">{t('eventsTitle')}</h2></div><span id="eventCount" className="section-count">{readyState ? t('eventsShown', { shown: visibleEvents.length, total: events.length }) : ''}</span></div><div id="events" className="event-list" role="region" aria-label={t('eventsListLabel')} tabIndex={visibleEvents.length ? 0 : undefined}>{error ? <Empty>{t('recentEventsUnavailable')}</Empty> : readyState && <Events events={visibleEvents} />}</div>{readyState && events.length > 12 && <button className="events-toggle" type="button" aria-controls="events" aria-expanded={showAllEvents} onClick={() => setShowAllEvents(!showAllEvents)}>{t(showAllEvents ? 'showFewerEvents' : 'showAllAvailableEvents')}</button>}</Paper>
      </div>
    </Box>
  </>;
}
