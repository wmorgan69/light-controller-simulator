import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AppBar, Box, Button, Checkbox, Chip, Drawer, FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Paper,
  Select, Stack, Table, TableBody, TableCell, TableHead, TableRow, ThemeProvider, Toolbar, Typography,
  createTheme
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import BuildingEditor from './editor/BuildingEditor';
import { SceneCanvas } from './scene/SceneCanvas';
import { createMutationAccess, responseDetail } from './shared/mutation-access.js';
import { controllerStatusLabel, t } from './shared/localization.en.js';
import { lightEmits } from './scene/room-state.js';
import {
  accessibleFaultOptions, accessibleRoomOptions, applyMutationState, faultForRoom, findRoom,
  isBuildingView, isDesignStatus, isMutationState, readTransportStatus, refreshDisposition,
  refreshFailureDisposition, roomSensorId, selectedRoomForFloor, controllerForTarget, floorStatus
} from './shared/simulator-model';
import type {
  BuildingDesignDto, BuildingViewDto, ControllerDto, ControllerFaultDto, FaultScope, RoomDto,
  SceneSelection
} from './shared/simulator-model';
import type { MutationAccess as EditorMutationAccess } from './editor/BuildingEditor.types.js';

interface SimulatorMutationAccess extends EditorMutationAccess {
  readonly allowed: boolean;
  refresh(): Promise<void>;
}

interface FaultRequestDto {
  scope: FaultScope;
  targetId: string;
  description: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isStaleRefreshError(error: unknown): boolean {
  return error instanceof Error && 'staleRefresh' in error && error.staleRefresh === true;
}

function isFaultScope(value: string): value is FaultScope {
  return value === 'sensor' || value === 'light' || value === 'controller';
}

const theme = createTheme({
  palette: { mode: 'dark', primary: { main: '#2563eb' }, background: { default: '#111827', paper: '#172033' } },
  typography: { fontFamily: 'system-ui, sans-serif' },
  shape: { borderRadius: 12 }
});

function faultRows(controllers: ControllerDto[]): Array<{ controller: ControllerDto; fault: ControllerFaultDto; target: string }> {
  return controllers.flatMap(controller => {
    const labels = new Map(['sensor', 'light', 'controller'].flatMap(scope =>
      accessibleFaultOptions([controller], scope).map(option => [JSON.stringify([scope, option.id]), option.label] as const)));
    return controller.faults.map(fault => {
      const label = labels.get(JSON.stringify([fault.scope, fault.targetId]));
      const target = label ? t('faultTargetWithId', { target: label, id: fault.targetId }) : fault.targetId;
      return { controller, fault, target };
    });
  });
}

function sameSnapshot<T>(left: T, right: T): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

interface RoomInspectorProps {
  room: RoomDto | undefined;
  controller: ControllerDto | undefined;
  mutationAccess: Pick<SimulatorMutationAccess, 'allowed'>;
  onClose: () => void;
  onPresence: (present: boolean) => void;
  onFault: (checked: boolean) => void;
  error: string;
}

function RoomInspector({
  room, controller, mutationAccess, onClose, onPresence, onFault, error
}: RoomInspectorProps): React.JSX.Element | null {
  if (!room || !controller) return null;
  const sensorFault = Boolean(faultForRoom(controller, room));
  return <Paper className="room-inspector" component="section" aria-label={t('roomControls')} elevation={8}>
    <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }} className="inspector-heading">
      <Typography component="h2" variant="subtitle1">{t('floorRoomName', { floor: controller.floor, room: room.name })}</Typography>
      <Button onClick={onClose} aria-label={t('closeRoomControls')} className="close-inspector">{t('closeSymbol')}</Button>
    </Stack>
    <Stack direction="row" sx={{ justifyContent: 'space-around' }} className="inspector-controls">
      <FormControlLabel label={t('presence')} control={<Checkbox checked={room.presence}
        disabled={!mutationAccess.allowed} onChange={event => onPresence(event.target.checked)} />} />
      <FormControlLabel label={t('sensorFault')} control={<Checkbox checked={sensorFault}
        disabled={!mutationAccess.allowed} onChange={event => onFault(event.target.checked)} />} />
    </Stack>
    {error && <Alert severity="error">{error}</Alert>}
  </Paper>;
}

export function App(): React.JSX.Element {
  const mutationAccess: SimulatorMutationAccess = useMemo(() => createMutationAccess(), []);
  const [accessRevision, setAccessRevision] = useState(0);
  const access = useMemo<Pick<SimulatorMutationAccess, 'allowed'>>(() => ({ allowed: mutationAccess.allowed }),
    [mutationAccess, accessRevision]);
  const [controllers, setControllers] = useState<ControllerDto[]>([]);
  const [design, setDesign] = useState<BuildingDesignDto | null>(null);
  const designRef = useRef<BuildingDesignDto | null>(null);
  const [floor, setFloor] = useState<number | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [transport, setTransport] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [dataStale, setDataStale] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');
  const [sceneError, setSceneError] = useState('');
  const [rendererError, setRendererError] = useState('');
  const [sceneRetryVersion, setSceneRetryVersion] = useState(0);
  const [inspectorError, setInspectorError] = useState('');
  const [accessibleError, setAccessibleError] = useState('');
  const [scenarioError, setScenarioError] = useState('');
  const [scenarioWarning, setScenarioWarning] = useState('');
  const [scenarioStatus, setScenarioStatus] = useState('');
  const [designStatus, setDesignStatus] = useState(t('buildingDesignStatusLoading'));
  const [designSummary, setDesignSummary] = useState(t('buildingDesignStatusLoading'));
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [sceneRevision, setSceneRevision] = useState(0);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [faultScope, setFaultScope] = useState<FaultScope>('sensor');
  const [faultTarget, setFaultTarget] = useState('');
  const [roomTarget, setRoomTarget] = useState('');
  const [accessibleFloor, setAccessibleFloor] = useState('');
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [menuContainer, setMenuContainer] = useState<HTMLElement | null>(null);
  const navigationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const desktopNavigationRef = useRef<HTMLDivElement | null>(null);
  const refreshSequence = useRef(0);
  const lastAppliedRefresh = useRef(0);
  const minimumRefreshSequence = useRef(0);
  const didInitialSelection = useRef(false);
  const hasSnapshot = useRef(false);
  const dataStaleRef = useRef(false);
  const controllersRef = useRef<ControllerDto[]>([]);
  const currentRoom = findRoom(controllers, selectedRoomId);
  const rooms = accessibleRoomOptions(controllers);
  const targets = accessibleFaultOptions(controllers, faultScope);
  const selectedRoomTarget = rooms.some(item => item.id === roomTarget) ? roomTarget : rooms[0]?.id ?? '';
  const selectedFaultTarget = targets.some(item => item.id === faultTarget) ? faultTarget : targets[0]?.id ?? '';
  const faults = faultRows(controllers);

  useEffect(() => mutationAccess.subscribe(() => setAccessRevision(value => value + 1)), [mutationAccess]);
  useEffect(() => {
    const desktop = matchMedia('(min-width: 761px)');
    const closeOnDesktop = () => { if (desktop.matches) setNavigationOpen(false); };
    desktop.addEventListener('change', closeOnDesktop);
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, []);
  useEffect(() => {
    const pointerQuery = matchMedia('(pointer: coarse)');
    const updatePointerMode = () => setCoarsePointer(pointerQuery.matches);
    updatePointerMode();
    pointerQuery.addEventListener('change', updatePointerMode);
    return () => pointerQuery.removeEventListener('change', updatePointerMode);
  }, []);

  const applyControllers = useCallback((view: BuildingViewDto): void => {
    controllersRef.current = view.controllers;
    setControllers(previous => sameSnapshot(previous, view.controllers) ? previous : view.controllers);
    designRef.current = view.design;
    setDesign(previous => sameSnapshot(previous, view.design) ? previous : view.design);
    hasSnapshot.current = true;
    if (!didInitialSelection.current && view.controllers.length) {
      const defaultController = view.controllers.find(item => item.floor === 3) ?? view.controllers[0];
      if (defaultController) {
        const defaultRoom = selectedRoomForFloor(defaultController);
        setFloor(defaultController.floor);
        setAccessibleFloor(String(defaultController.floor));
        setSelectedRoomId(defaultRoom?.id ?? null);
        didInitialSelection.current = true;
      }
    }
    setFloor(previous => previous !== null && !view.controllers.some(item => item.floor === previous) ? null : previous);
    setSelectedRoomId(previous => previous && !findRoom(view.controllers, previous) ? null : previous);
    setAccessibleFloor(previous => previous && !view.controllers.some(item => String(item.floor) === previous) ? '' : previous);
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++refreshSequence.current;
    let view: BuildingViewDto | undefined;
    let status: { mqttConnected: boolean } | null = null;
    try {
      const [buildingResult, statusResult] = await Promise.allSettled([
        fetch('/api/building-view', { signal: AbortSignal.timeout(4000) }),
        fetch('/api/status', { signal: AbortSignal.timeout(4000) })
      ]);
      const statusResponse = statusResult.status === 'fulfilled' ? statusResult.value : null;
      status = await readTransportStatus(statusResponse);
      if (buildingResult.status === 'rejected') throw buildingResult.reason;
      const buildingResponse = buildingResult.value;
      if (!buildingResponse.ok) throw new Error(t('controllerApiFailed', { status: buildingResponse.status }));
      const responseBody: unknown = await buildingResponse.json();
      if (!isBuildingView(responseBody)) throw new Error(t('mutationResponseInvalid'));
      view = responseBody;
    } catch (error: unknown) {
      const failureDisposition = refreshFailureDisposition(
        sequence, refreshSequence.current, lastAppliedRefresh.current, minimumRefreshSequence.current);
      if (failureDisposition !== 'apply') return;
      setTransport(status
        ? status.mqttConnected ? t('mqttConnected') : t('mqttUnavailableHttpActive')
        : t('transportStatusUnavailable'));
      throw error;
    }
    if (!view) return;
    const disposition = refreshDisposition(
      sequence, lastAppliedRefresh.current, minimumRefreshSequence.current);
    if (disposition === 'outdated') return;
    if (disposition === 'superseded') {
      throw Object.assign(new Error(t('statusChangedDuringRefresh')), { staleRefresh: true });
    }
    lastAppliedRefresh.current = sequence;
    applyControllers(view);
    setTransport(status ? status.mqttConnected ? t('mqttConnected') : t('mqttUnavailableHttpActive') : t('transportStatusUnavailable'));
    setLoadError('');
    setInitialLoadComplete(true);
    setDataStale(false);
    dataStaleRef.current = false;
    setLastUpdatedAt(Date.now());
    setScenarioWarning('');
  }, [applyControllers]);

  const reportBuildingRefreshFailure = useCallback((error: unknown): void => {
    if (isStaleRefreshError(error)) return;
    setLoadError(t('unableToLoadBuildingState', { error: errorMessage(error) }));
    setInitialLoadComplete(true);
    if (hasSnapshot.current) {
      setDataStale(true);
      dataStaleRef.current = true;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        await refresh();
      } catch (error: unknown) {
        if (active) reportBuildingRefreshFailure(error);
      }
    };
    const accessPoll = () => mutationAccess.refresh();
    void run();
    void accessPoll();
    const timer = window.setInterval(() => {
      void run();
      void accessPoll();
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [mutationAccess, refresh, reportBuildingRefreshFailure]);

  const refreshDesignStatus = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch('/api/building-design-status', { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error(t('controllerApiFailed', { status: response.status }));
      const responseBody: unknown = await response.json();
      if (!isDesignStatus(responseBody)) throw new Error(t('mutationResponseInvalid'));
      const state = responseBody;
      const status = state.activationStatus === 'active' ? t('editorActivationActive')
        : state.activationStatus === 'failed' ? t('editorActivationFailed') : t('editorActivationPending');
      setDesignStatus(t('buildingDesignStatusSummary', {
        status, saved: state.savedRevision, running: state.runningRevision, pending: state.pendingCleanup,
        failed: state.failedCleanup, completed: state.completedCleanup
      }));
      setDesignSummary(t(state.failedCleanup > 0 ? 'buildingStatusCleanupFailed'
        : state.pendingCleanup > 0 ? 'buildingStatusCleanupPending' : 'buildingStatusBrief', { status }));
      if (state.runningRevision !== designRef.current?.revision) {
        try {
          await refresh();
        } catch (error: unknown) {
          reportBuildingRefreshFailure(error);
        }
      }
    } catch (error: unknown) {
      if (!isStaleRefreshError(error)) {
        setDesignStatus(`${t('buildingDesignStatusUnavailable')} ${errorMessage(error)}`);
        setDesignSummary(t('buildingDesignStatusUnavailable'));
      }
    }
  }, [refresh, reportBuildingRefreshFailure]);

  useEffect(() => {
    void refreshDesignStatus();
    const timer = window.setInterval(() => void refreshDesignStatus(), 5000);
    return () => window.clearInterval(timer);
  }, [refreshDesignStatus]);

  const request = useCallback(async (url: string, options?: RequestInit): Promise<Response> => {
    const response = await mutationAccess.request(url, options);
    if (!response.ok) throw new Error(t('requestFailed', {
      status: response.status, body: await responseDetail(response)
    }));
    setActionError('');
    setAccessibleError('');
    return response;
  }, [mutationAccess]);

  const applyMutationResult = useCallback((result: unknown): boolean => {
    if (!isMutationState(result)) throw new Error(t('mutationResponseInvalid'));
    const current = controllersRef.current;
    const next = applyMutationState(current, result);
    if (!next) return false;
    minimumRefreshSequence.current = refreshSequence.current + 1;
    controllersRef.current = next;
    setControllers(previous => sameSnapshot(previous, next) ? previous : next);
    return true;
  }, []);
  const updateLocalControllers = applyMutationResult;
  const updateLocalController = useCallback(async (response: Response): Promise<void> => {
    const body: unknown = await response.json();
    if (applyMutationResult(body)) return;
    try { await refresh(); }
    catch (error: unknown) {
      setLoadError(t('actionStatusRefreshFailed', { error: errorMessage(error) }));
      if (hasSnapshot.current) {
        setDataStale(true);
        dataStaleRef.current = true;
      }
    }
  }, [applyMutationResult, refresh]);

  const handleSceneSelect = useCallback((picked: SceneSelection | null | undefined): void => {
    if (!picked) {
      setSelectedRoomId(null);
      return;
    }
    const nextController = controllers.find(controller => controller.floor === picked.floor);
    if (!nextController) return;
    if (floor !== picked.floor) setSceneRevision(value => value + 1);
    setFloor(picked.floor);
    if (picked.type === 'floor') {
      setSelectedRoomId(selectedRoomForFloor(nextController)?.id ?? null);
    } else if (picked.roomId) {
      setSelectedRoomId(picked.roomId);
    } else {
      setSelectedRoomId(null);
    }
    setAccessibleFloor(String(picked.floor));
  }, [controllers, floor]);
  const handleSceneError = useCallback((error: Error): void => setSceneError(error.message), []);
  const scenePanelRef = useRef<HTMLElement | null>(null);
  const sceneRetryButtonRef = useRef<HTMLButtonElement | null>(null);
  const handleSceneReady = useCallback(() => {
    if (sceneError && !rendererError && document.activeElement === sceneRetryButtonRef.current) {
      scenePanelRef.current?.focus();
    }
    setSceneError('');
  }, [rendererError, sceneError]);
  const handleRendererError = useCallback((error: Error): void => setRendererError(error.message), []);
  const handleRendererReady = useCallback(() => {
    if (rendererError && document.activeElement === sceneRetryButtonRef.current) {
      scenePanelRef.current?.focus();
    }
    setRendererError('');
  }, [rendererError]);

  const showAllFloors = (): void => {
    setFloor(null);
    setSelectedRoomId(null);
    setAccessibleFloor('');
    setSceneRevision(value => value + 1);
  };
  const chooseFloor = (controller: ControllerDto): void => {
    if (floor === controller.floor) setSceneRevision(value => value + 1);
    else {
      setFloor(controller.floor);
      setSelectedRoomId(selectedRoomForFloor(controller)?.id ?? null);
    }
    setAccessibleFloor(String(controller.floor));
  };

  const changePresence = async (present: boolean): Promise<void> => {
    if (!currentRoom) return;
    try {
      const response = await request(`/api/rooms/${currentRoom.room.id}/sensor/${present ? 'trigger' : 'reset'}`, { method: 'POST' });
      await updateLocalController(response);
      setInspectorError('');
    } catch (error: unknown) {
      setInspectorError(errorMessage(error));
    }
  };
  const changeSensorFault = async (checked: boolean): Promise<void> => {
    if (!currentRoom) return;
    const { controller, room } = currentRoom;
    const existing = faultForRoom(controller, room);
    try {
      let response;
      if (checked && !existing) {
        response = await request(`/api/devices/${controller.id}/faults`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scope: 'sensor',
            targetId: roomSensorId(controller, room),
            description: t('simulatedSensorFault')
          } satisfies FaultRequestDto)
        });
      } else if (!checked && existing) {
        response = await request(`/api/devices/${controller.id}/faults/${existing.id}`, { method: 'DELETE' });
      }
      if (response) await updateLocalController(response);
      setInspectorError('');
    } catch (error: unknown) {
      setInspectorError(errorMessage(error));
    }
  };
  const clearFault = async (controller: ControllerDto, fault: ControllerFaultDto): Promise<void> => {
    try {
      const response = await request(`/api/devices/${controller.id}/faults/${fault.id}`, { method: 'DELETE' });
      await updateLocalController(response);
    } catch (error: unknown) {
      setActionError(errorMessage(error));
    }
  };
  const runScenario = async (endpoint: string): Promise<void> => {
    if (scenarioBusy || !access.allowed) return;
    setScenarioBusy(true);
    setScenarioError('');
    setScenarioStatus(t('scenarioApplying'));
    try {
      const response = await request(endpoint, { method: 'POST' });
      const body: unknown = await response.json();
      if (!updateLocalControllers(body)) {
        try {
          await refresh();
          setScenarioWarning('');
        } catch (error: unknown) {
          setScenarioWarning(t('scenarioStatusRefreshFailed', { error: errorMessage(error) }));
          if (hasSnapshot.current) {
            setDataStale(true);
            dataStaleRef.current = true;
          }
        }
      }
      setScenarioStatus(t('scenarioApplied'));
    } catch (error: unknown) {
      setScenarioError(errorMessage(error));
      setScenarioStatus('');
    } finally {
      setScenarioBusy(false);
    }
  };
  const triggerAccessible = async (): Promise<void> => {
    if (!selectedRoomTarget) return;
    try {
      const response = await request(`/api/rooms/${selectedRoomTarget}/sensor/trigger`, { method: 'POST' });
      await updateLocalController(response);
    } catch (error: unknown) {
      setAccessibleError(errorMessage(error));
    }
  };
  const resetAccessible = async (): Promise<void> => {
    if (!selectedRoomTarget) return;
    try {
      const response = await request(`/api/rooms/${selectedRoomTarget}/sensor/reset`, { method: 'POST' });
      await updateLocalController(response);
    } catch (error: unknown) {
      setAccessibleError(errorMessage(error));
    }
  };
  const injectFault = async (): Promise<void> => {
    const controller = controllerForTarget(controllers, faultScope, selectedFaultTarget);
    if (!controller) return;
    try {
      const response = await request(`/api/devices/${controller.id}/faults`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: faultScope,
          targetId: selectedFaultTarget,
          description: t('simulatedScopedFault', { scope: faultScope })
        } satisfies FaultRequestDto)
      });
      await updateLocalController(response);
    } catch (error: unknown) {
      setAccessibleError(errorMessage(error));
    }
  };
  const chooseAccessibleFloor = (value: string): void => {
    setAccessibleFloor(value);
    if (value === '') showAllFloors();
    else {
      const controller = controllers.find(item => String(item.floor) === value);
      if (controller) chooseFloor(controller);
    }
  };
  const transportOffline = transport && transport !== t('mqttConnected');
  const navigation = (inDrawer: boolean): React.JSX.Element => <Box component="nav" className="floor-navigation" aria-label={t('buildingFloors')}>
    {inDrawer && <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
      <Typography component="h2" variant="h6">{t('building')}</Typography>
      <IconButton aria-label={t('closeNavigation')} onClick={() => setNavigationOpen(false)}><CloseIcon /></IconButton>
    </Stack>}
    {!inDrawer && <Typography component="h2" variant="h6">{t('building')}</Typography>}
    <Button className="floor-button" variant={floor === null ? 'contained' : 'text'}
      aria-pressed={floor === null} disabled={!controllers.length} onClick={() => {
        showAllFloors(); if (inDrawer) setNavigationOpen(false);
      }}>{t('allFloors')}</Button>
    {controllers.slice().sort((a, b) => b.floor - a.floor).map(controller => {
      const count = floorStatus(controller);
      return <Button key={controller.id} className="floor-button" variant={floor === controller.floor ? 'contained' : 'text'}
        aria-pressed={floor === controller.floor} onClick={() => {
          chooseFloor(controller); if (inDrawer) setNavigationOpen(false);
        }}>
        <span>{t('floorName', { floor: controller.floor })}</span>
        <span className={controller.status === 'Faulted' ? 'floor-status faulted' : 'floor-status'}>
          {controller.status === 'Faulted' ? '⚠ ' : ''}{controllerStatusLabel(controller.status)}
        </span>
        <span className="floor-status">{t('occupiedRooms', { occupied: count.occupied, total: count.total })}</span>
      </Button>;
    })}
    {!controllers.length && <Typography role="status">
      {!initialLoadComplete ? t('loadingFloors') : loadError ? t('floorListUnavailable') : t('noControllers')}
    </Typography>}
    <Box className="scenario-controls" role="group" aria-labelledby={inDrawer ? 'drawer-scenario-heading' : 'scenario-heading'}>
      <Typography id={inDrawer ? 'drawer-scenario-heading' : 'scenario-heading'} component="h3" variant="subtitle1">{t('scenarios')}</Typography>
      <Button variant="outlined" disabled={!access.allowed || scenarioBusy || !controllers.length} onClick={() => void runScenario('/api/scenarios/reset')}>{t('resetBuilding')}</Button>
      <Button variant="outlined" disabled={!access.allowed || scenarioBusy || !controllers.length} title={t('occupancyDemoTitle')}
        onClick={() => void runScenario('/api/scenarios/occupancy')}>{t('occupancyDemo')}</Button>
      <Typography role="status" aria-live="polite" aria-atomic="true" className="scenario-status">{scenarioStatus}</Typography>
      {scenarioError && <Alert severity="error">{scenarioError}</Alert>}
      {scenarioWarning && <Alert severity="warning">{scenarioWarning}</Alert>}
    </Box>
  </Box>;
  return <ThemeProvider theme={theme}>
    <Box className="simulator-app">
      <Box component="header" className="simulator-header">
        <AppBar component="div" position="sticky" className="simulator-app-bar" elevation={0}>
          <Toolbar className="simulator-toolbar">
            <IconButton ref={navigationTriggerRef} className="mobile-navigation-trigger" color="inherit" aria-label={t('openNavigation')}
              aria-expanded={navigationOpen} onClick={event => {
                event.currentTarget.blur();
                setNavigationOpen(true);
              }}><MenuIcon /></IconButton>
            <Typography component="h1" variant="h6" className="simulator-title">{t('pageTitle')}</Typography>
            <Chip role="status" className={`transport-chip${transportOffline ? ' offline' : ''}`} label={transport ?? t('checkingMqtt')} />
            <Box ref={setMenuContainer} className="building-menu-anchor" />
          </Toolbar>
        </AppBar>
        <Box className="header-details">
          <Typography className="header-hint">{t('floorSelectionHint')}</Typography>
          <details className="design-status">
            <summary><span role="status">{designSummary}</span> · {t('buildingStatusDetails')}</summary>
            <Typography>{designStatus}</Typography>
          </details>
        </Box>
        <BuildingEditor mutationAccess={mutationAccess} onActivated={async () => {
          await Promise.all([refresh(), refreshDesignStatus()]);
        }} menuContainer={menuContainer} />
      </Box>
      <Box component="main" className="simulator-main">
        <Box ref={desktopNavigationRef} className="desktop-floor-navigation" tabIndex={-1}>{navigation(false)}</Box>
        <Drawer open={navigationOpen} onClose={() => setNavigationOpen(false)}
          ModalProps={{ disableRestoreFocus: true }}
          slotProps={{
            paper: { 'aria-label': t('buildingFloors') },
            transition: { onExited: () => window.setTimeout(() => {
              const trigger = navigationTriggerRef.current;
              if (!trigger || document.activeElement !== document.body) return;
              if (getComputedStyle(trigger).display !== 'none') trigger.focus();
              else {
                const navigation = desktopNavigationRef.current;
                const target = navigation?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)')
                  ?? navigation?.querySelector<HTMLButtonElement>('button:not(:disabled)');
                (target ?? navigation)?.focus();
              }
            }, 0) }
          }}>
          {navigation(true)}
        </Drawer>
        <Box component="section" className="canvas-panel" aria-label={t('simulatorView')}
          ref={scenePanelRef} tabIndex={-1}>
          <SceneCanvas key={sceneRetryVersion} controllers={controllers} design={design} floor={floor} selectedRoomId={selectedRoomId}
            wiring={floor !== null} onSelect={handleSceneSelect}
            onError={handleSceneError} onReady={handleSceneReady}
            onRendererError={handleRendererError} onRendererReady={handleRendererReady}
            cameraResetVersion={sceneRevision} />
          <Box className="scene-overlays">
            <Paper className="scene-message">
              <Typography role="status">{coarsePointer ? t('touchGestureHelp') : t('mouseGestureHelp')}</Typography>
              <Typography className="wiring-legend">{t('stairsHelp')}</Typography>
              {floor !== null && <Typography className="wiring-legend">
                {t('wiringLabel')} <span className="sensor-wire">{t('sensorWiringLegend')}</span> · <span className="faulted-sensor-wire">{t('faultedSensorWiringLegend')}</span> · <span className="light-wire">{t('lightWiringLegend')}</span>
              </Typography>}
            </Paper>
            <span className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
              {sceneError || rendererError
                ? t('sceneViewUnavailable', { error: sceneError || rendererError })
                : ''}
            </span>
            {(sceneError || rendererError) && <Alert className="scene-error" severity="warning" role="group"
              aria-label={t('sceneViewUnavailable', { error: sceneError || rendererError })} action={
                <Button ref={sceneRetryButtonRef} className="scene-retry" color="inherit" size="small"
                  onClick={() => setSceneRetryVersion(value => value + 1)}>
                  {t('retryScene')}
                </Button>
              }>
              {t('sceneViewUnavailable', { error: sceneError || rendererError })}
            </Alert>}
            {loadError && <Alert severity="error">{loadError}</Alert>}
            <RoomInspector room={currentRoom?.room} controller={currentRoom?.controller} mutationAccess={access}
              onClose={() => setSelectedRoomId(null)} onPresence={changePresence} onFault={changeSensorFault} error={inspectorError} />
          </Box>
        </Box>
      </Box>
      <Paper component="section" className="status-panel" aria-labelledby="live-status-heading">
        <Typography component="h2" variant="h6" id="live-status-heading">{t('liveStatus')}</Typography>
        {dataStale && lastUpdatedAt !== null && <Alert severity="warning" role="status">
          {t('liveDataStale', { time: new Date(lastUpdatedAt).toLocaleTimeString('en-US') })}
        </Alert>}
        {actionError && <Alert severity="error">{actionError}</Alert>}
        <Box className="status-table-scroll">
          <Table size="small">
            <TableHead><TableRow>{['controller', 'floor', 'status', 'statusTableHeader'].map(key =>
              <TableCell key={key}>{t(key)}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {!initialLoadComplete ? <TableRow><TableCell colSpan={4}>{t('loadingFloors')}</TableCell></TableRow>
                : controllers.length === 0 ? <TableRow><TableCell colSpan={4}>
                  {loadError ? t('floorListUnavailable') : t('noControllers')}
                </TableCell></TableRow>
                  : controllers.map(controller => <TableRow key={controller.id}
                    className={controller.floor === floor ? 'selected-floor' : ''}>
                    <TableCell>{controller.id}</TableCell><TableCell>{controller.floor}</TableCell>
                    <TableCell>{controllerStatusLabel(controller.status)}</TableCell>
                    <TableCell>{controller.rooms.map(room => t('roomLightsOn', {
                      room: room.name, on: room.lightStrips.filter(lightEmits).length, total: room.lightStrips.length
                    })).join(' · ')}</TableCell>
                  </TableRow>)}
            </TableBody>
          </Table>
        </Box>
        <details className="accessible-controls">
          <summary>{t('accessibleControls')}</summary>
          <FormControl fullWidth>
            <InputLabel id="accessible-floor-label">{t('floorView')}</InputLabel>
            <Select<string> id="accessible-floor" labelId="accessible-floor-label" label={t('floorView')}
              value={accessibleFloor} onChange={event => chooseAccessibleFloor(event.target.value)}>
              <MenuItem value="">{t('allFloors')}</MenuItem>
              {controllers.map(controller => <MenuItem key={controller.id} value={String(controller.floor)}>
                {t('floorNameOption', { floor: controller.floor })}
              </MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="accessible-room-label">{t('roomSensor')}</InputLabel>
            <Select<string> id="accessible-room" labelId="accessible-room-label" label={t('roomSensor')} value={selectedRoomTarget}
              onChange={event => setRoomTarget(event.target.value)}>
              {rooms.map(option => <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Button disabled={!access.allowed || !selectedRoomTarget} onClick={() => void triggerAccessible()}>{t('triggerSelectedRoomSensor')}</Button>
          <Button disabled={!access.allowed || !selectedRoomTarget} onClick={() => void resetAccessible()}>{t('resetSelectedRoomSensor')}</Button>
          <FormControl fullWidth>
            <InputLabel id="fault-scope-label">{t('faultType')}</InputLabel>
            <Select<string> id="fault-scope" labelId="fault-scope-label" label={t('faultType')} value={faultScope}
              onChange={event => {
                if (isFaultScope(event.target.value)) setFaultScope(event.target.value);
                setFaultTarget('');
              }}>
              {['sensor', 'light', 'controller'].map(scope => <MenuItem key={scope} value={scope}>{t(scope === 'light' ? 'lightStrip' : scope)}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel id="fault-target-label">{t('accessibleFaultTarget')}</InputLabel>
            <Select<string> id="fault-target" labelId="fault-target-label" label={t('accessibleFaultTarget')} value={selectedFaultTarget}
              onChange={event => setFaultTarget(event.target.value)}>
              {targets.map(option => <MenuItem key={option.id} value={option.id}>{option.label}</MenuItem>)}
            </Select>
          </FormControl>
          <Button disabled={!access.allowed || !selectedFaultTarget} onClick={() => void injectFault()}>{t('injectSelectedFault')}</Button>
          <Typography component="h3" variant="subtitle1">{t('allActiveFaults')}</Typography>
          {!initialLoadComplete ? <Typography role="status">{t('loadingFloors')}</Typography>
            : controllers.length === 0 ? <Typography role="status">
              {loadError ? t('floorListUnavailable') : t('noControllers')}
            </Typography>
              : !faults.length && <Typography>{t('noActiveFaults')}</Typography>}
          {faults.map(({ controller, fault, target }) =>
            <Stack key={fault.id} className="fault-row" direction="row"
              sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography>{t('activeFaultLabel', { controller: controller.id, scope: fault.scope, target, description: fault.description })}</Typography>
              <Button aria-label={t('clearFaultFor', { target, fault: fault.id })} disabled={!access.allowed} onClick={() => void clearFault(controller, fault)}>{t('clear')}</Button>
            </Stack>)}
          {accessibleError && <Alert severity="error" role="alert">{accessibleError}</Alert>}
        </details>
      </Paper>
    </Box>
  </ThemeProvider>;
}
