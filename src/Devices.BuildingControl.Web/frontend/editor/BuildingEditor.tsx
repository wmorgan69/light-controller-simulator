import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Alert, Box, Button, Menu, MenuItem, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import AddBoxOutlinedIcon from '@mui/icons-material/AddBoxOutlined';
import DoorFrontOutlinedIcon from '@mui/icons-material/DoorFrontOutlined';
import DirectionsWalkOutlinedIcon from '@mui/icons-material/DirectionsWalkOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import PanToolAltOutlinedIcon from '@mui/icons-material/PanToolAltOutlined';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import StairsOutlinedIcon from '@mui/icons-material/StairsOutlined';
import DownloadOutlinedIcon from '@mui/icons-material/DownloadOutlined';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import { EditorSession, newFloor, newId, newRoom, snap, validateDesign } from './building-editor-state.js';
import {
  adjustNumericInput, createRecoveryExport, locateValidation, projectPendingForms,
  reshapeRoom, validateNumericInput
} from './building-editor.js';
import { t } from '../shared/localization.en.js';
import type {
  BuildingDesign, BuildingDevice, BuildingFloor, BuildingLight, BuildingRoom, BuildingSensor, BuildingWalkway,
  EditorFormName, EditorForms, EditorNumericConstraints, EditorProps, EditorSelection, EditorTool,
  PendingEditorForm
} from './BuildingEditor.types.js';
import type { FormEvent, KeyboardEvent } from 'react';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const toolLabels: Record<EditorTool, string> = {
  select: 'editorSelect', move: 'editorMove', room: 'editorAddRoom',
  door: 'editorAddDoor', light: 'editorAddLight', walkway: 'editorAddWalkway', stair: 'editorAddStairs'
};
const toolIcons: Record<EditorTool, React.JSX.Element> = {
  select: <PanToolAltOutlinedIcon />, move: <OpenWithIcon />, room: <AddBoxOutlinedIcon />,
  door: <DoorFrontOutlinedIcon />, light: <LightbulbOutlinedIcon />,
  walkway: <DirectionsWalkOutlinedIcon />, stair: <StairsOutlinedIcon />
};

type EditorItem = BuildingFloor | BuildingRoom | BuildingDevice | BuildingWalkway;

interface EditorLookup {
  floor?: BuildingFloor;
  room?: BuildingRoom;
  item?: EditorItem;
}

interface PlanDrag {
  pointerId: number;
  plan: SVGSVGElement;
  design: BuildingDesign;
  floorIndex: number;
  selection: EditorSelection;
  startX: number;
  startZ: number;
  clientX: number;
  clientY: number;
  originalX: number;
  originalZ: number;
  x: number;
  z: number;
  moved: boolean;
}

function findItem(
  design: BuildingDesign | null | undefined,
  floorIndex: number,
  selection: EditorSelection | null
): EditorLookup {
  const floor = design?.floors[floorIndex];
  if (!floor || !selection) return {};
  if (selection.kind === 'controller') return { floor, item: floor };
  if (selection.kind === 'walkway' || selection.kind === 'stair')
    return { floor, item: (selection.kind === 'walkway' ? floor.walkways : floor.stairs)?.find(item => item.id === selection.id) };
  const room = floor.rooms.find(value => value.id === selection.roomId);
  if (!room) return {};
  if (selection.kind === 'room') return { floor, room, item: room };
  if (selection.kind === 'sensor') return { floor, room, item: room.sensor };
  return { floor, room, item: room[selection.kind === 'door' ? 'doors' : 'lights'].find(value => value.id === selection.id) };
}

function movePlanItem(design: BuildingDesign, floorIndex: number, selection: EditorSelection, x: number, z: number): void {
  const found = findItem(design, floorIndex, selection);
  if (selection.kind === 'controller' && found.floor) {
    found.floor.controllerX = x;
    found.floor.controllerZ = z;
  } else if ((selection.kind === 'walkway' || selection.kind === 'stair') && found.item && 'x' in found.item) {
    found.item.x = x;
    found.item.z = z;
  } else if (selection.kind === 'room' && found.room) {
    const moved = reshapeRoom(found.room, x, z, found.room.width, found.room.depth);
    if (moved) Object.assign(found.room, moved);
  } else if (found.room && selection.kind === 'sensor') {
    found.room.sensor.x = x;
    found.room.sensor.z = z;
  } else if (found.room && (selection.kind === 'door' || selection.kind === 'light')) {
    const item = found.room[selection.kind === 'door' ? 'doors' : 'lights'].find(value => value.id === selection.id);
    if (item) { item.x = x; item.z = z; }
  }
}

function selectedItemName(room: BuildingRoom | undefined, selection: EditorSelection | null, floor?: BuildingFloor): string {
  if (!selection) return '';
  if (selection.kind === 'controller') return t('editorController');
  if (selection.kind === 'walkway' || selection.kind === 'stair') {
    const items = selection.kind === 'walkway' ? floor?.walkways : floor?.stairs;
    const number = (items?.findIndex(item => item.id === selection.id) ?? -1) + 1;
    return number ? t(selection.kind === 'walkway' ? 'editorWalkwayNumber' : 'editorStairsNumber', { number }) : '';
  }
  if (!room) return '';
  if (selection.kind === 'room') return t('editorRoom', { name: room.name });
  if (selection.kind === 'sensor') return t('editorSensor', { room: room.name });
  const items = selection.kind === 'door' ? room.doors : room.lights;
  const number = items.findIndex(item => item.id === selection.id) + 1;
  if (number < 1) return '';
  return t(selection.kind === 'door' ? 'editorDoor' : 'editorLight', { number, room: room.name });
}

function isSelectedDevice(
  selection: EditorSelection | null,
  roomId: string,
  kind: 'sensor' | 'door' | 'light',
  deviceId: string
): boolean {
  if (!selection || selection.kind === 'controller' || selection.kind === 'stair' || selection.kind === 'walkway' || selection.roomId !== roomId) return false;
  if (selection.kind === 'sensor') return kind === 'sensor';
  return selection.kind === kind && selection.id === deviceId;
}

function initialForms(
  design: BuildingDesign,
  floorIndex: number,
  selection: EditorSelection | null
): EditorForms {
  const found = findItem(design, floorIndex, selection);
  const forms: EditorForms = {
    building: { width: String(design.width), depth: String(design.depth), count: String(design.floors.length) },
    'new-room': { name: t('editorNewRoom'), x: '0', z: '0', width: '2', depth: '2' }
  };
  if (selection && found.floor) {
    if (selection.kind === 'controller') {
      forms.properties = { x: String(found.floor.controllerX), z: String(found.floor.controllerZ) };
    } else if ((selection.kind === 'walkway' || selection.kind === 'stair') && found.item && 'width' in found.item) {
      forms.properties = { x: String(found.item.x), z: String(found.item.z),
        width: String(found.item.width), depth: String(found.item.depth),
        ...(selection.kind === 'stair' && 'direction' in found.item ? { direction: String(found.item.direction) } : {}) };
    } else if (selection.kind === 'room' && found.room) {
      forms.properties = {
        name: found.room.name, width: String(found.room.width), depth: String(found.room.depth),
        x: String(found.room.x), z: String(found.room.z)
      };
    } else if (selection.kind === 'sensor' && found.room) {
      forms.properties = {
        x: String(found.room.sensor.x), z: String(found.room.sensor.z),
        connection: found.room.sensor.controllerId || ''
      };
    } else if (selection.kind === 'door' && found.room) {
      const item = found.room.doors.find(value => value.id === selection.id);
      if (item) {
        forms.properties = { x: String(item.x), z: String(item.z) };
      }
    } else if (selection.kind === 'light' && found.room) {
      const item = found.room.lights.find(value => value.id === selection.id);
      if (item) {
        forms.properties = {
          x: String(item.x), z: String(item.z),
          connection: item.controllerId || ''
        };
      }
    }
  }
  return forms;
}

function pendingForms(forms: EditorForms, baseline: EditorForms): PendingEditorForm[] {
  const names: EditorFormName[] = ['building', 'new-room', 'properties'];
  return names.flatMap(form => {
    const fields = forms[form];
    if (!fields || same(fields, baseline[form])) return [];
    return [{
      form,
      fields: Object.entries(fields).map(([name, value]) => ({ name, type: 'text' as const, value }))
    }];
  });
}

function download(value: object, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface NumberFieldProps extends EditorNumericConstraints {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  name?: string;
}

function NumberField({ label, value, onChange, min, max, step = 0.5, disabled, name }: NumberFieldProps) {
  const constraints: EditorNumericConstraints = { min, max, step };
  const result = validateNumericInput(value, constraints);
  return <TextField fullWidth required size="small" label={label} name={name} value={value}
    disabled={disabled} error={!result.valid}
    helperText={!result.valid ? t('editorNumericConstraint') : undefined}
    onChange={event => onChange(event.target.value)}
    onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
      const next = adjustNumericInput(value, event.key, constraints);
      if (next !== null) { event.preventDefault(); onChange(next); }
    }}
    slotProps={{ htmlInput: { inputMode: 'decimal', role: 'spinbutton', 'aria-valuemin': min, 'aria-valuemax': max,
      'aria-valuenow': Number.isFinite(result.value) ? result.value : undefined,
      'aria-valuetext': value || undefined, title: t('editorNumericInputHelp') }}} />;
}

function isEditorTool(value: unknown): value is EditorTool {
  return value === 'select' || value === 'room' || value === 'door' || value === 'light' ||
    value === 'move' || value === 'walkway' || value === 'stair';
}

function moveFocusFromMenu(trigger: HTMLElement, backwards: boolean): void {
  const doc = trigger.ownerDocument;
  const eligible = Array.from(doc.querySelectorAll<HTMLElement>(
    'a[href], area[href], button, input, select, textarea, iframe, object, embed, summary, [tabindex], [contenteditable=""], [contenteditable="true"]'
  )).filter(element => element.tabIndex >= 0 && !element.matches(':disabled, input[type="hidden"]') &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]') && element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility === 'visible');
  const candidates = eligible.filter(element => {
    if (element instanceof HTMLInputElement && element.type === 'radio' && element.name) {
      const group = eligible.filter((candidate): candidate is HTMLInputElement =>
        candidate instanceof HTMLInputElement && candidate.type === 'radio' &&
        candidate.name === element.name && candidate.form === element.form);
      if ((group.find(radio => radio.checked) || group[0]) !== element) return false;
    }
    return true;
  }).sort((a, b) => {
    const aOrder = a.tabIndex || Number.MAX_SAFE_INTEGER;
    const bOrder = b.tabIndex || Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder;
  });
  const index = candidates.indexOf(trigger);
  if (index < 0) return;
  const next = candidates[index + (backwards ? -1 : 1)];
  if (next) next.focus();
  else trigger.blur();
}

export default function BuildingEditor({ mutationAccess, onActivated = () => {}, menuContainer }: EditorProps) {
  const labelClipId = useId();
  const sessionRef = useRef<EditorSession | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const entryRef = useRef<HTMLButtonElement | null>(null);
  const wasOpen = useRef(false);
  const activateAfterMenu = useRef(false);
  const tabAfterMenu = useRef<boolean | null>(null);
  const dragRef = useRef<PlanDrag | null>(null);
  const suppressPlanClick = useRef(false);
  const cancelledPointer = useRef<number | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [version, setVersion] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [floorIndex, setFloorIndex] = useState(0);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [tool, setTool] = useState<EditorTool>('select');
  const [zoomIndex, setZoomIndex] = useState(0);
  const [pan, setPan] = useState({ x: 0, z: 0 });
  const [dragPreview, setDragPreview] = useState<PlanDrag | null>(null);
  const [forms, setForms] = useState<EditorForms>({});
  const [baseline, setBaseline] = useState<EditorForms>({});
  const [focusField, setFocusField] = useState<{ form: EditorFormName; field?: string } | null>(null);
  const notify = () => { if (mounted.current) setVersion(value => value + 1); };
  const session = sessionRef.current;
  const design = session?.design;
  const hasDesign = Boolean(design);
  const allowed = Boolean(mutationAccess?.editorAllowed);
  const blocked = busy || !allowed || Boolean(session?.conflict);
  const pending = pendingForms(forms, baseline);
  const pendingRef = useRef(false);
  pendingRef.current = pending.length > 0;
  void version;

  useEffect(() => {
    if (open) headingRef.current?.focus();
    else if (wasOpen.current) {
      entryRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    const unsubscribe = mutationAccess?.subscribe(() => { if (active) notify(); });
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
      mounted.current = false;
    };
  }, [mutationAccess]);
  useEffect(() => {
    if (!allowed) setTool('select');
  }, [allowed]);
  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      if (cancelledPointer.current === event.pointerId) cancelledPointer.current = null;
    };
    const pointerUp = (event: PointerEvent) => {
      if (cancelledPointer.current !== event.pointerId) return;
      cancelledPointer.current = null;
      suppressPlanClick.current = true;
      window.setTimeout(() => { suppressPlanClick.current = false; }, 0);
    };
    window.addEventListener('pointerdown', pointerDown, true);
    window.addEventListener('pointerup', pointerUp, true);
    return () => {
      window.removeEventListener('pointerdown', pointerDown, true);
      window.removeEventListener('pointerup', pointerUp, true);
    };
  }, []);
  useEffect(() => {
    const cancel = () => {
      const drag = dragRef.current;
      if (!drag) return;
      cancelledPointer.current = drag.pointerId;
      dragRef.current = null;
      setDragPreview(null);
      if (drag.plan.hasPointerCapture(drag.pointerId)) drag.plan.releasePointerCapture(drag.pointerId);
    };
    cancel();
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && dragRef.current) {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { window.removeEventListener('keydown', onKeyDown); cancel(); };
  }, [tool, allowed, floorIndex, open, busy, session?.conflict]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    if (!focusField) return;
    const target = focusField.field
      ? rootRef.current?.querySelector<HTMLInputElement>(`form[data-form="${focusField.form}"] [name="${focusField.field}"]`)
      : null;
    if (target && !target.disabled) target.focus();
    else errorRef.current?.focus();
    setFocusField(null);
  }, [focusField, floorIndex, selection]);
  useEffect(() => {
    if (!open || !hasDesign) return undefined;
    const timer = setInterval(() => sessionRef.current?.refreshStatus(), 20000);
    return () => clearInterval(timer);
  }, [open, hasDesign]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (sessionRef.current?.dirty || pendingRef.current) {
        event.preventDefault();
        event.returnValue = t('editorBeforeUnload');
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  const resetForms = (
    nextDesign: BuildingDesign,
    nextFloor = floorIndex,
    nextSelection: EditorSelection | null = selection
  ): void => {
    const next = initialForms(nextDesign, nextFloor, nextSelection);
    setForms(next);
    setBaseline(structuredClone(next));
  };
  const confirmPending = (except?: EditorFormName): boolean => {
    const others = pending.filter(form => form.form !== except);
    return !others.length || window.confirm(t('editorUnapplied'));
  };
  const run = async (action: () => Promise<unknown>): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (exception) { setError(exception instanceof Error ? exception.message : String(exception)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };
  const refreshLiveAfterSave = async (): Promise<void> => {
    try { await onActivated(); }
    catch (exception) {
      setError(t('editorLiveRefreshFailed', {
        error: exception instanceof Error ? exception.message : String(exception)
      }));
    }
  };
  const load = (): Promise<void> => run(async () => {
    if (!mutationAccess?.editorAllowed) throw new Error(mutationAccess?.editorMessage || t('mutationAccess_checking'));
    setLoading(true);
    try {
      const next = new EditorSession((url, options) => mutationAccess.request(url, options, true), notify);
      await next.open();
      sessionRef.current = next;
      setFloorIndex(0); setSelection(null); setTool('select');
      if (!next.design) throw new Error(t('editorProtocolError'));
      resetForms(next.design, 0, null);
      notify();
    } catch (exception) {
      throw new Error(t('editorLoadFailed', { error: exception instanceof Error ? exception.message : String(exception) }));
    } finally { setLoading(false); }
  });
  const close = (): void => {
    if ((session?.dirty || pending.length) && !window.confirm(t('editorExitConfirm'))) return;
    sessionRef.current = null; setForms({}); setBaseline({}); setOpen(false); setError('');
  };
  const startDesign = (kind: 'blank' | 'default'): void => {
    if (busyRef.current || blocked || !session || !design || !mutationAccess.editorAllowed ||
        !window.confirm(t('editorStartConfirm'))) return;
    void run(async () => {
      const replacement: BuildingDesign = kind === 'blank'
        ? { revision: design.revision, width: 20, depth: 20, floors: [newFloor(1)] }
        : await session.defaultDesign();
      if (!mutationAccess.editorAllowed || session.conflict || sessionRef.current !== session)
        throw new Error(mutationAccess.editorMessage || t('editorConflict'));
      replacement.revision = design.revision;
      session.edit(next => Object.assign(next, replacement));
      if (!session.design) throw new Error(t('editorInvalidState'));
      setFloorIndex(0); setSelection(null); setTool('select');
      resetForms(session.design, 0, null);
    });
  };
  const changeForm = (form: EditorFormName, field: string, value: string): void => setForms(current => ({
    ...current, [form]: { ...current[form], [field]: value }
  }));
  const edit = (
    change: (design: BuildingDesign) => void,
    except: EditorFormName | null = null,
    after?: EditorSelection | null
  ): boolean => {
    if (busyRef.current || blocked || !session || session.conflict || !mutationAccess.editorAllowed ||
        !confirmPending(except ?? undefined) || !session.design) return false;
    setError('');
    session.edit(change);
    const nextFloor = Math.min(floorIndex, session.design.floors.length - 1);
    const nextSelection = after === undefined ? selection : after;
    setFloorIndex(nextFloor); setSelection(nextSelection);
    resetForms(session.design, nextFloor, nextSelection);
    return true;
  };
  const navigate = (nextFloor: number, nextSelection: EditorSelection | null): void => {
    if (busyRef.current || busy || !session || session.conflict || !confirmPending() || !design) return;
    setFloorIndex(nextFloor); setSelection(nextSelection);
    resetForms(design, nextFloor, nextSelection);
  };
  const field = (form: EditorFormName, name: string, label: string, options: EditorNumericConstraints = {}) => <NumberField key={name}
    label={t(label)} name={name} value={forms[form]?.[name] ?? ''} disabled={blocked}
    onChange={value => changeForm(form, name, value)} {...options} />;
  const nameField = (form: EditorFormName) => <TextField fullWidth required size="small" label={t('editorName')} name="name"
    value={forms[form]?.name ?? ''} disabled={blocked} slotProps={{ htmlInput: { maxLength: 256 } }}
    onChange={event => changeForm(form, 'name', event.target.value)} />;
  const validForm = (form: EditorFormName, constraints: Record<string, EditorNumericConstraints>): boolean => {
    const values = forms[form];
    if (!values) return false;
    for (const [name, options] of Object.entries(constraints)) {
      if (!validateNumericInput(values[name] ?? '', options).valid) {
        setError(t('editorNumericConstraint'));
        return false;
      }
    }
    if ('name' in values && !values.name.trim()) {
      setError(t('editorInvalidRoom', { room: values.name }));
      return false;
    }
    return true;
  };
  const coords = { x: {}, z: {} };
  const roomCoords = { ...coords, width: { min: 1 }, depth: { min: 1 } };
  const accessCoords: Record<string, EditorNumericConstraints> = {
    x: { step: 'any' }, z: { step: 'any' },
    width: { min: Number.MIN_VALUE, step: 'any' }, depth: { min: Number.MIN_VALUE, step: 'any' }
  };
  const submitBuilding = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blocked || !design || !validForm('building', { width: { min: 2, max: 100 }, depth: { min: 2, max: 100 }, count: { min: 1, max: 10, step: 1 } })) return;
    const values = forms.building;
    if (!values) return;
    const count = Number(values.count), removed = design.floors.slice(count), rooms = removed.flatMap(floor => floor.rooms);
    if (removed.length && !window.confirm(t('editorFloorRemove', { floors: removed.length, rooms: rooms.length,
      doors: rooms.reduce((sum, room) => sum + room.doors.length, 0),
      lights: rooms.reduce((sum, room) => sum + room.lights.length, 0),
      walkways: removed.reduce((sum, floor) => sum + (floor.walkways?.length ?? 0), 0),
      stairs: removed.reduce((sum, floor) => sum + (floor.stairs?.length ?? 0), 0) + (design.floors[count - 1]?.stairs?.length ?? 0) }))) return;
    edit(next => {
      next.width = Number(values.width); next.depth = Number(values.depth); next.floors.splice(count);
      if (removed.length && next.floors[count - 1]) next.floors[count - 1]!.stairs = [];
      while (next.floors.length < count) next.floors.push(newFloor(next.floors.length + 1));
    }, 'building', count <= floorIndex ? null : selection);
  };
  const submitRoom = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blocked || !validForm('new-room', roomCoords)) return;
    const values = forms['new-room'];
    if (!values) return;
    edit(next => {
      const floor = next.floors[floorIndex];
      if (!floor) return;
      floor.rooms.push(newRoom(Number(values.x), Number(values.z), Number(values.width), Number(values.depth), values.name, floor.controllerId));
    }, 'new-room');
  };
  const submitProperties = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (blocked || !selection || !session || !design ||
        !validForm('properties', selection.kind === 'room' ? roomCoords :
          selection.kind === 'walkway' || selection.kind === 'stair' ? accessCoords : coords)) return;
    const values = forms.properties, found = findItem(design, floorIndex, selection);
    if (!values) return;
    const reshaped = selection.kind === 'room' && found.room
      ? reshapeRoom(found.room, Number(values.x), Number(values.z), Number(values.width), Number(values.depth))
      : null;
    if (selection.kind === 'room' && !reshaped) { setError(t('editorResizeFixtures')); return; }
    edit(next => {
      const target = findItem(next, floorIndex, selection);
      if (selection.kind === 'controller' && target.floor) {
        target.floor.controllerX = Number(values.x);
        target.floor.controllerZ = Number(values.z);
      } else if ((selection.kind === 'walkway' || selection.kind === 'stair') && target.floor) {
        const area = (selection.kind === 'walkway' ? target.floor.walkways : target.floor.stairs)?.find(item => item.id === selection.id);
        if (area) {
          area.x = Number(values.x); area.z = Number(values.z);
          area.width = Number(values.width); area.depth = Number(values.depth);
          if ('direction' in area && (values.direction === 'east' || values.direction === 'west'))
            area.direction = values.direction;
        }
      } else if (selection.kind === 'room' && target.room && reshaped) {
        Object.assign(target.room, reshaped);
        target.room.name = values.name ?? '';
      } else if (target.room && selection.kind === 'sensor') {
        target.room.sensor.x = Number(values.x);
        target.room.sensor.z = Number(values.z);
        target.room.sensor.controllerId = values.connection || null;
      } else if (target.room && selection.kind === 'door') {
        const item = target.room.doors.find(value => value.id === selection.id);
        if (item) {
          item.x = Number(values.x);
          item.z = Number(values.z);
        }
      } else if (target.room && selection.kind === 'light') {
        const item = target.room.lights.find(value => value.id === selection.id);
        if (item) {
          item.x = Number(values.x);
          item.z = Number(values.z);
          item.controllerId = values.connection || null;
        }
      }
    }, 'properties');
  };
  const save = (): void => {
    if (busyRef.current || blocked || !session || !design || session.conflict || !mutationAccess.editorAllowed) return;
    const problem = locateValidation(design);
    if (problem) {
      const problemFloor = problem.floor === undefined ? undefined : design.floors[problem.floor];
      const message = problem.floor === undefined ? t('editorValidationBuilding', { error: problem.error }) :
        t('editorValidationLocation', { floor: problemFloor?.number ?? problem.floor, item: problem.item, error: problem.error });
      if (pending.length) setError(t('editorValidationUnapplied', { error: message }));
      else {
        if (problem.floor !== undefined) navigate(problem.floor, problem.selection ?? null);
        setError(message);
        setFocusField({ form: problem.floor === undefined ? 'building' : 'properties', field: problem.field });
      }
      return;
    }
    if (!confirmPending()) return;
    void run(async () => {
      await session.save();
      if (!session.design) throw new Error(t('editorProtocolError'));
      resetForms(session.design);
      await refreshLiveAfterSave();
    });
  };
  const recover = (): void => {
    if (busyRef.current || busy || !mutationAccess.editorAllowed || !session || !session.conflict ||
        !window.confirm(t('editorUseCurrentConfirm'))) return;
    void run(async () => {
      await session.useCurrent();
      if (!session.design) throw new Error(t('editorProtocolError'));
      setFloorIndex(0); setSelection(null); setTool('select');
      resetForms(session.design, 0, null);
    });
  };
  const exportDesign = (): void => {
    if (!design || !session) return;
    const projected = projectPendingForms(design, pending, floorIndex, selection);
    if (projected.issue) {
      const reason = projected.issue.problem?.error || t('editorPendingProjectionInvalid');
      download(createRecoveryExport(design, pending, {
        floorIndex, floorNumber: design.floors[floorIndex]?.number ?? null, selection,
        conflict: Boolean(session.conflict), savedRevision: session.saved?.revision ?? null,
        editRevision: session.editRevision ?? null
      }, reason), 'building-design-recovery.json');
      setError(t('editorRecoveryExported'));
    } else download(projected.design, 'building-design.json');
  };
  const history = (from: BuildingDesign[], to: BuildingDesign[]): void => {
    if (busyRef.current || blocked || !session || session.conflict || !mutationAccess.editorAllowed ||
        !confirmPending() || !session.design) return;
    session.history(from, to);
    const nextFloor = Math.min(floorIndex, session.design.floors.length - 1);
    setFloorIndex(nextFloor); setSelection(null); resetForms(session.design, nextFloor, null);
  };
  const remove = (): void => {
    if (!selection || !session || !design) return;
    const found = findItem(design, floorIndex, selection);
    if (busyRef.current || blocked || session.conflict || !mutationAccess.editorAllowed || !confirmPending()) return;
    const message = selection.kind === 'room' && found.room
      ? t('editorRoomRemove', { room: found.room.name, doors: found.room.doors.length, lights: found.room.lights.length })
      : t('editorDeleteConfirm', { item: selectedItemName(found.room, selection, found.floor) });
    if (!window.confirm(message)) return;
    session.edit(next => {
      const current = findItem(next, floorIndex, selection);
      if (selection.kind === 'room' && current.floor)
        current.floor.rooms = current.floor.rooms.filter(room => room.id !== selection.roomId);
      else if (selection.kind === 'walkway' && current.floor)
        current.floor.walkways = (current.floor.walkways ?? []).filter(item => item.id !== selection.id);
      else if (selection.kind === 'stair' && current.floor)
        current.floor.stairs = (current.floor.stairs ?? []).filter(item => item.id !== selection.id);
      else {
        if (!current.room || (selection.kind !== 'door' && selection.kind !== 'light')) return;
        if (selection.kind === 'door')
          current.room.doors = current.room.doors.filter(item => item.id !== selection.id);
        else
          current.room.lights = current.room.lights.filter(item => item.id !== selection.id);
      }
    });
    if (session.design) {
      setSelection(null);
      resetForms(session.design, floorIndex, null);
    }
  };
  const addDevice = (kind: 'door' | 'light'): void => {
    edit(next => {
      const { floor, room } = findItem(next, floorIndex, selection);
      if (!floor || !room) return;
      const device: BuildingDevice = { id: newId(kind), x: room.x, z: room.z };
      if (kind === 'light') room.lights.push({ ...device, controllerId: floor.controllerId });
      else room.doors.push(device);
    });
  };
  const addAccess = (kind: 'walkway' | 'stair', x = 0, z = 0): void => {
    if (!design || (kind === 'stair' && design.floors[floorIndex]?.number === design.floors.length)) {
      setError(t('editorStairsTopFloor'));
      return;
    }
    const currentFloor = design.floors[floorIndex];
    const count = kind === 'walkway' ? currentFloor?.walkways?.length : currentFloor?.stairs?.length;
    const limit = kind === 'walkway' ? 256 : 32;
    if ((count ?? 0) >= limit) {
      setError(t('editorAccessLimit', { item: t(kind === 'walkway' ? 'editorWalkway' : 'editorStairs'), limit }));
      return;
    }
    const id = newId(kind);
    edit(next => {
      const floor = next.floors[floorIndex];
      if (!floor) return;
      if (kind === 'walkway') {
        floor.walkways ??= [];
        floor.walkways.push({ id, x, z, width: 2, depth: 1 });
      } else {
        floor.stairs ??= [];
        floor.stairs.push({ id, x, z, width: 2.5, depth: 1, direction: 'east' });
      }
    }, null, { kind, id });
  };
  const planPosition = (plan: SVGSVGElement, clientX: number, clientY: number): { x: number; z: number } | null => {
    const matrix = plan.getScreenCTM();
    if (!matrix) return null;
    const point = plan.createSVGPoint();
    point.x = clientX; point.y = clientY;
    const position = point.matrixTransform(matrix.inverse());
    return Number.isFinite(position.x) && Number.isFinite(position.y) ? { x: position.x, z: position.y } : null;
  };
  const startPlanDrag = (event: React.PointerEvent<SVGElement>, target: EditorSelection): void => {
    if (busyRef.current || blocked || !design || dragRef.current || event.button !== 0 ||
        event.isPrimary === false || (tool !== 'select' && tool !== 'move')) return;
    const plan = event.currentTarget.ownerSVGElement;
    const found = findItem(design, floorIndex, target);
    if (!plan || !found.item || !found.floor) return;
    const point = planPosition(plan, event.clientX, event.clientY);
    if (!point) { setError(t('editorDragUnavailable')); return; }
    const original = target.kind === 'controller'
      ? { x: found.floor.controllerX, z: found.floor.controllerZ }
      : 'x' in found.item && 'z' in found.item ? { x: found.item.x, z: found.item.z } : null;
    if (!original) return;
    plan.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId, plan, design, floorIndex, selection: target,
      startX: point.x, startZ: point.z, clientX: event.clientX, clientY: event.clientY,
      originalX: original.x, originalZ: original.z, x: original.x, z: original.z, moved: false
    };
  };
  const updatePlanDrag = (event: React.PointerEvent<SVGSVGElement>): PlanDrag | null => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return null;
    const point = planPosition(drag.plan, event.clientX, event.clientY);
    if (!point) { setError(t('editorDragUnavailable')); return null; }
    const moved = drag.moved || Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) >= 5;
    const access = drag.selection.kind === 'walkway' || drag.selection.kind === 'stair';
    const next = {
      ...drag, moved,
      x: snap(Math.max(access ? -4 : 0, Math.min(drag.design.width + (access ? 4 : 0), drag.originalX + point.x - drag.startX))),
      z: snap(Math.max(access ? -4 : 0, Math.min(drag.design.depth + (access ? 4 : 0), drag.originalZ + point.z - drag.startZ)))
    };
    dragRef.current = next;
    setDragPreview(moved ? next : null);
    return next;
  };
  const finishPlanDrag = (event: React.PointerEvent<SVGSVGElement>): void => {
    const previous = dragRef.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    const drag = updatePlanDrag(event);
    if (!drag) {
      dragRef.current = null;
      setDragPreview(null);
      if (previous?.moved) {
        suppressPlanClick.current = true;
        window.setTimeout(() => { suppressPlanClick.current = false; }, 0);
      }
      return;
    }
    dragRef.current = null;
    setDragPreview(null);
    if (drag.moved || tool === 'select') {
      suppressPlanClick.current = true;
      window.setTimeout(() => { suppressPlanClick.current = false; }, 0);
    }
    if (!drag.moved) {
      if (tool === 'select' && drag.design === session?.design && drag.floorIndex === floorIndex)
        navigate(floorIndex, drag.selection);
      return;
    }
    if (drag.x === drag.originalX && drag.z === drag.originalZ) return;
    if (drag.design !== session?.design || drag.floorIndex !== floorIndex) {
      setError(t('editorDragCancelled'));
      return;
    }
    if (edit(next => movePlanItem(next, floorIndex, drag.selection, drag.x, drag.z), null, drag.selection) && session.design) {
      const validation = validateDesign(session.design);
      if (validation) setError(t('editorDragInvalid', { error: validation }));
    }
  };
  const planClick = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (busyRef.current || blocked || !mutationAccess.editorAllowed || tool === 'select' || !design) return;
    const plan = event.currentTarget, matrix = plan.getScreenCTM();
    if (!matrix) return;
    const point = plan.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const position = point.matrixTransform(matrix.inverse());
    const accessTool = tool === 'walkway' || tool === 'stair' ||
      (tool === 'move' && (selection?.kind === 'walkway' || selection?.kind === 'stair'));
    const x = snap(Math.max(accessTool ? -4 : 0, Math.min(design.width + (accessTool ? 4 : 0), position.x)));
    const z = snap(Math.max(accessTool ? -4 : 0, Math.min(design.depth + (accessTool ? 4 : 0), position.y)));
    const found = findItem(design, floorIndex, selection);
    if (tool === 'move' && !found.item) { setError(t('editorNoMove')); return; }
    if ((tool === 'door' || tool === 'light') && !found.room) { setError(t('editorClickRoom')); return; }
    if (tool === 'walkway' || tool === 'stair') { addAccess(tool, x, z); return; }
    edit(next => {
      const current = findItem(next, floorIndex, selection);
      if (tool === 'room') {
        const floor = next.floors[floorIndex];
        if (!floor) return;
        floor.rooms.push(newRoom(x, z, 2, 2, t('editorNewRoom'), floor.controllerId));
      } else if (tool === 'move') {
        if (!selection || !current.item) return;
        movePlanItem(next, floorIndex, selection, x, z);
      } else {
        if (!current.room || !current.floor || (tool !== 'door' && tool !== 'light')) return;
        const device: BuildingDevice = { id: newId(tool), x, z };
        if (tool === 'light') current.room.lights.push({ ...device, controllerId: current.floor.controllerId });
        else current.room.doors.push(device);
      }
    });
  };

  const floor = design?.floors[floorIndex];
  const incomingFloorIndex = design?.floors.findIndex(item => item.number === (floor?.number ?? 0) - 1) ?? -1;
  const found = findItem(design, floorIndex, selection);
  const dragItem = dragPreview && findItem(design, floorIndex, dragPreview.selection).item;
  const selectedName = selectedItemName(found.room, selection, floor);
  const actionSx = { minHeight: 44, maxWidth: '100%', overflowWrap: 'anywhere' };
  const panelSx = { p: 2, minWidth: 0, bgcolor: '#172033', color: '#e9eef7' };
  const formSx = { display: 'grid', gap: 1, my: 2 };
  const cleanup = session?.cleanup;
  const status = design && session && [
    pending.length ? t('editorUnappliedFormStatus') : '',
    session.conflict ? t('editorConflict') : session.dirty ? t('editorDirty') : t('editorSaved'),
    session.activationStatus !== 'active' ? t('editorActivation', { status: session.activationStatus && ['active', 'pending', 'failed'].includes(session.activationStatus)
      ? t(`editorActivation${session.activationStatus[0].toUpperCase()}${session.activationStatus.slice(1)}`)
      : session.activationStatus ?? t('editorUnknownStatus') }) : '',
    cleanup?.some(item => String(item.status).toLowerCase() === 'failed') ? t('editorCleanupNeedsAttention')
      : cleanup?.some(item => String(item.status).toLowerCase() === 'pending') ? t('editorCleanupPendingBrief') : '',
    !cleanup ? t('editorCleanupUnavailable') : '',
    session.statusError ? t('editorStatusRefreshFailed', { error: session.statusError }) : ''
  ].filter(Boolean).join(' ');
  const statusDetails = design && session && [
    t('editorActivation', { status: session.activationStatus && ['active', 'pending', 'failed'].includes(session.activationStatus)
      ? t(`editorActivation${session.activationStatus[0].toUpperCase()}${session.activationStatus.slice(1)}`)
      : session.activationStatus ?? t('editorUnknownStatus') }),
    session.activeDesign && session.saved
      ? t('editorRevisions', { saved: session.saved.revision, running: session.activeDesign.revision })
      : '',
    cleanup ? t('editorCleanup', Object.fromEntries(['pending', 'failed', 'completed', 'cancelled']
      .map(value => [value, cleanup.filter(entry => String(entry.status).toLowerCase() === value).length]))) : t('editorCleanupUnavailable'),
  ].filter(Boolean).join(' ');
  const zoomLevels = [1, 1.5, 2, 3, 4];
  const zoom = zoomLevels[zoomIndex];
  const viewWidth = ((design?.width ?? 0) + 8) / zoom;
  const viewDepth = ((design?.depth ?? 0) + 8) / zoom;
  const panLimitX = ((design?.width ?? 0) + 8 - viewWidth) / 2;
  const panLimitZ = ((design?.depth ?? 0) + 8 - viewDepth) / 2;
  const panX = Math.max(-panLimitX, Math.min(panLimitX, pan.x));
  const panZ = Math.max(-panLimitZ, Math.min(panLimitZ, pan.z));
  const activeSession = design && session ? session : null;

  const menu = <>
    <Stack className="building-menu-trigger-group" hidden={open} spacing={1} sx={{ alignItems: 'flex-end', display: open ? 'none' : 'flex' }}>
      <Button ref={entryRef} sx={{ ...actionSx, minWidth: 44 }} variant="outlined"
        aria-label={t('openBuildingMenu')} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)}
        aria-controls={menuAnchor ? 'building-menu' : undefined}
        onClick={event => { tabAfterMenu.current = null; setMenuAnchor(event.currentTarget); }}>
        <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('editorMenu')}</Box>
        <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex' }}>
          <MoreVertIcon />
        </Box>
      </Button>
      {!allowed && <Typography className="building-menu-access-status" role="status">{mutationAccess?.editorMessage || t('mutationAccess_checking')}</Typography>}
    </Stack>
    <Menu id="building-menu" anchorEl={menuAnchor} open={Boolean(menuAnchor)}
      onClose={(event, reason) => {
        tabAfterMenu.current = reason === 'tabKeyDown' && 'shiftKey' in event ? Boolean(event.shiftKey) : null;
        setMenuAnchor(null);
      }}
      onTransitionExited={() => {
        if (activateAfterMenu.current && mutationAccess.editorAllowed) {
          activateAfterMenu.current = false;
          window.setTimeout(() => {
            if (!mounted.current) return;
            if (mutationAccess.editorAllowed) {
              setOpen(true);
              void load();
            }
          }, 0);
        } else {
          activateAfterMenu.current = false;
          const backwards = tabAfterMenu.current;
          tabAfterMenu.current = null;
          if (backwards !== null) {
            window.setTimeout(() => {
              const trigger = entryRef.current;
              if (mounted.current && trigger && trigger.getAttribute('aria-expanded') === 'false' &&
                document.activeElement === trigger) moveFocusFromMenu(trigger, backwards);
            }, 0);
          }
        }
      }}
      slotProps={{ list: { 'aria-label': t('editorMenu'), disabledItemsFocusable: true } }}>
      <MenuItem disabled={!allowed} aria-describedby={!allowed ? 'building-menu-access' : undefined}
        onClick={() => {
          if (!mutationAccess.editorAllowed) return;
          activateAfterMenu.current = true;
          setMenuAnchor(null);
        }}>{t('editBuilding')}</MenuItem>
      {!allowed && <Typography component="li" role="presentation" id="building-menu-access" sx={{ px: 2, py: 1, maxWidth: 320 }}>
        {mutationAccess?.editorMessage || t('mutationAccess_checking')}
      </Typography>}
    </Menu>
  </>;

  return <Box ref={rootRef} sx={{ minWidth: 0 }}>
    {menuContainer ? createPortal(menu, menuContainer) : menu}
    {open && <Box component="section" aria-label={t('editBuilding')} sx={{ p: { xs: 1, sm: 2 }, minWidth: 0 }}>
      <Typography ref={headingRef} tabIndex={-1} variant="h5" component="h2">{t('editBuilding')}</Typography>
      {!allowed && <Alert severity="warning">{mutationAccess?.editorMessage || t('mutationAccess_checking')}</Alert>}
      {loading && <Typography role="status">{t('editorLoading')}</Typography>}
      {status && <Typography role="status" sx={{ my: 1, overflowWrap: 'anywhere' }}>{status}</Typography>}
      {statusDetails && <details className="editor-status-details">
        <summary>{t('editorStatusDetails')}</summary><Typography>{statusDetails}</Typography>
      </details>}
      {error && <Alert ref={errorRef} tabIndex={-1} severity="error" role="alert" sx={{ my: 1, overflowWrap: 'anywhere' }}>{error}</Alert>}
      {!design && !loading && <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button sx={actionSx} disabled={busy || !allowed} onClick={() => { headingRef.current?.focus(); void load(); }}>{t('editorRetry')}</Button>
        <Button sx={actionSx} disabled={busy} onClick={close}>{t('editorReturn')}</Button>
      </Stack>}
      {design && floor && activeSession && <>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, my: 2 }}>
          <Button sx={actionSx} variant="contained" startIcon={<SaveOutlinedIcon />} disabled={blocked} onClick={save}>{t('editorSave')}</Button>
          {['pending', 'failed'].includes(activeSession.activationStatus ?? '') && <Button sx={actionSx} disabled={blocked} onClick={() => run(async () => { await activeSession.retryWork('/retry'); await refreshLiveAfterSave(); })}>{t('editorRetryActivation')}</Button>}
          {activeSession.cleanup?.some(item => ['pending', 'failed'].includes(String(item.status).toLowerCase())) && <Button sx={actionSx} disabled={blocked} onClick={() => run(() => activeSession.retryWork('/retry-cleanup'))}>{t('editorRetryCleanup')}</Button>}
          <Button sx={actionSx} startIcon={<UndoIcon />} disabled={blocked || !activeSession.undoStack.length} onClick={() => history(activeSession.undoStack, activeSession.redoStack)}>{t('editorUndo')}</Button>
          <Button sx={actionSx} startIcon={<RedoIcon />} disabled={blocked || !activeSession.redoStack.length} onClick={() => history(activeSession.redoStack, activeSession.undoStack)}>{t('editorRedo')}</Button>
          <Button sx={actionSx} disabled={blocked} onClick={() => startDesign('blank')}>{t('editorStartBlank')}</Button>
          <Button sx={actionSx} disabled={blocked} onClick={() => startDesign('default')}>{t('editorStartDefault')}</Button>
          {activeSession.conflict && <Button sx={actionSx} disabled={busy || !allowed} onClick={recover}>{t('editorUseCurrent')}</Button>}
          <Button sx={actionSx} startIcon={<DownloadOutlinedIcon />} disabled={busy} onClick={exportDesign}>{t('editorExport')}</Button>
          <Button sx={actionSx} startIcon={<ExitToAppIcon />} disabled={busy} onClick={close}>{t('editorExit')}</Button>
        </Stack>
        <Typography sx={{ mb: 2 }}>{t('editorHistory')}</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(180px, 220px) minmax(0, 1fr) minmax(240px, 280px)' }, gap: 2 }}>
          <Paper component="section" sx={panelSx}>
            <Typography variant="h6" component="h3">{t('editorBuilding')}</Typography>
            <Box component="form" data-form="building" sx={formSx} onSubmit={submitBuilding} noValidate>
              {field('building', 'width', 'editorWidth', { min: 2, max: 100 })}
              {field('building', 'depth', 'editorDepth', { min: 2, max: 100 })}
              {field('building', 'count', 'editorFloorCount', { min: 1, max: 10, step: 1 })}
              <Button sx={actionSx} type="submit" disabled={blocked}>{t('editorApply')}</Button>
            </Box>
            <TextField select fullWidth size="small" label={t('editorFloors')} value={floorIndex} disabled={busy || session.conflict}
              onChange={event => navigate(Number(event.target.value), null)}>
              {design.floors.map((item, index) => <MenuItem key={item.id} value={index}>{t('editorFloor', { number: item.number })}</MenuItem>)}
            </TextField>
          </Paper>
          <Paper component="section" sx={panelSx}>
            <Typography variant="h6" component="h3">{t('editorPlan')}</Typography>
            <Typography sx={{ my: 1 }}>{t('editorPlanHelp')}</Typography>
            <Typography id="editor-tool-help" className="editor-tool-help">{t('editorToolKeyboardHelp')}</Typography>
            <ToggleButtonGroup className="editor-tool-group" role="toolbar" aria-label={t('editorTool')} aria-describedby="editor-tool-help" exclusive value={tool} disabled={blocked}
              onChange={(_event, value: unknown) => { if (isEditorTool(value)) setTool(value); }}>
              {(Object.keys(toolLabels) as EditorTool[]).map(value => <Tooltip key={value} title={t(toolLabels[value])}>
                <ToggleButton value={value} aria-label={t(toolLabels[value])}>
                  {toolIcons[value]}
                </ToggleButton>
              </Tooltip>)}
            </ToggleButtonGroup>
            <Typography sx={{ mt: 1 }}>{t('editorActiveTool', { tool: t(toolLabels[tool]) })}</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 1 }}>
              <Button sx={actionSx} disabled={zoomIndex === 0} onClick={() => {
                if (zoomIndex === 1) setPan({ x: 0, z: 0 });
                setZoomIndex(index => Math.max(0, index - 1));
              }}>{t('editorZoomOut')}</Button>
              <Button sx={actionSx} disabled={zoomIndex === zoomLevels.length - 1} onClick={() => setZoomIndex(index => Math.min(zoomLevels.length - 1, index + 1))}>{t('editorZoomIn')}</Button>
              <Button sx={actionSx} disabled={zoomIndex === 0} onClick={() => { setZoomIndex(0); setPan({ x: 0, z: 0 }); }}>{t('editorZoomFit')}</Button>
              <Typography role="status">{t('editorZoomLevel', { percent: Math.round(zoom * 100) })}</Typography>
            </Stack>
            {zoomIndex > 0 && <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, mt: 1 }}>
              <Button sx={actionSx} disabled={panX <= -panLimitX} onClick={() => setPan({ x: panX - viewWidth / 2, z: panZ })}>{t('editorPanLeft')}</Button>
              <Button sx={actionSx} disabled={panX >= panLimitX} onClick={() => setPan({ x: panX + viewWidth / 2, z: panZ })}>{t('editorPanRight')}</Button>
              <Button sx={actionSx} disabled={panZ <= -panLimitZ} onClick={() => setPan({ x: panX, z: panZ - viewDepth / 2 })}>{t('editorPanUp')}</Button>
              <Button sx={actionSx} disabled={panZ >= panLimitZ} onClick={() => setPan({ x: panX, z: panZ + viewDepth / 2 })}>{t('editorPanDown')}</Button>
            </Stack>}
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center', mt: 1 }}>
              <Typography>{selectedName ? t('editorSelectedItem', { item: selectedName }) : t('editorNoSelection')}</Typography>
              <Button sx={actionSx} disabled={blocked || (selection?.kind !== 'room' && selection?.kind !== 'door' && selection?.kind !== 'light' && selection?.kind !== 'walkway' && selection?.kind !== 'stair')} onClick={remove}>{t('editorDelete')}</Button>
            </Stack>
            <svg className="editor-plan" viewBox={`${design.width / 2 + panX - viewWidth / 2} ${design.depth / 2 + panZ - viewDepth / 2} ${viewWidth} ${viewDepth}`} role="img" aria-label={t('editorPlan')}
              style={{ touchAction: tool === 'select' || tool === 'move' ? 'none' : 'manipulation' }}
              onPointerMove={updatePlanDrag} onPointerUp={finishPlanDrag}
              onPointerCancel={event => {
                if (dragRef.current?.pointerId === event.pointerId) { dragRef.current = null; setDragPreview(null); }
                if (cancelledPointer.current === event.pointerId) cancelledPointer.current = null;
              }}
              onLostPointerCapture={event => {
                if (dragRef.current?.pointerId === event.pointerId) {
                  cancelledPointer.current = event.pointerId;
                  dragRef.current = null;
                  setDragPreview(null);
                }
              }}
              onClickCapture={event => {
                if (suppressPlanClick.current) { suppressPlanClick.current = false; event.stopPropagation(); }
              }}
              onClick={planClick}>
              <rect className="editor-footprint" x="0" y="0" width={design.width} height={design.depth} />
              {(floor.walkways ?? []).map(item => <rect key={item.id}
                className={`editor-walkway${selection?.kind === 'walkway' && selection.id === item.id ? ' editor-selected' : ''}`}
                x={item.x} y={item.z} width={item.width} height={item.depth}
                onPointerDown={event => startPlanDrag(event, { kind: 'walkway', id: item.id })}
                onClick={event => { if (tool === 'select') { event.stopPropagation(); navigate(floorIndex, { kind: 'walkway', id: item.id }); } }} />)}
              {(design.floors[incomingFloorIndex]?.stairs ?? []).map((item, index) => <g key={item.id}>
                <rect className="editor-stair editor-stair-incoming" x={item.x} y={item.z} width={item.width} height={item.depth}
                  onClick={event => { if (tool === 'select') { event.stopPropagation(); navigate(incomingFloorIndex, { kind: 'stair', id: item.id }); } }} />
                <text x={item.x + .1} y={item.z + item.depth * .7} fontSize={Math.max(.35, item.depth * .6)}>{t('editorStairsDownShort', { number: index + 1 })}</text>
              </g>)}
              {(floor.stairs ?? []).map((item, index) => <g key={item.id}>
                <rect className={`editor-stair${selection?.kind === 'stair' && selection.id === item.id ? ' editor-selected' : ''}`}
                  x={item.x} y={item.z} width={item.width} height={item.depth}
                  onPointerDown={event => startPlanDrag(event, { kind: 'stair', id: item.id })}
                  onClick={event => { if (tool === 'select') { event.stopPropagation(); navigate(floorIndex, { kind: 'stair', id: item.id }); } }} />
                <text x={item.x + .1} y={item.z + item.depth * .7} fontSize={Math.max(.35, item.depth * .6)}>{t('editorStairsUpShort', { number: index + 1 })}</text>
              </g>)}
              {floor.rooms.map((room, index) => <React.Fragment key={room.id}>
                <clipPath id={`${labelClipId}-${index}`}><rect x={room.x} y={room.z} width={room.width} height={room.depth} /></clipPath>
                <rect className={`editor-room${selection?.kind === 'room' && selection.roomId === room.id ? ' editor-selected' : ''}`}
                  x={room.x} y={room.z} width={room.width} height={room.depth}
                  onPointerDown={event => startPlanDrag(event, { kind: 'room', roomId: room.id })}
                  onClick={event => { if (tool === 'select') { event.stopPropagation(); navigate(floorIndex, { kind: 'room', roomId: room.id }); } }} />
                <text x={room.x + .3} y={room.z + .8} fontSize={Math.max(.5, design.width / 45)} clipPath={`url(#${labelClipId}-${index})`}>{room.name}</text>
                {[room.sensor, ...room.lights].filter(device => device.controllerId === floor.controllerId).map(device =>
                  <polyline key={device.id} className={device === room.sensor ? 'editor-sensor-wire' : 'editor-light-wire'}
                    fill="none" points={`${floor.controllerX},${floor.controllerZ} ${device.x},${floor.controllerZ} ${device.x},${device.z}`} />)}
                {([
                  { device: room.sensor, kind: 'sensor' as const },
                  ...room.doors.map(device => ({ device, kind: 'door' as const })),
                  ...room.lights.map(device => ({ device, kind: 'light' as const }))
                ] satisfies Array<{ device: BuildingDevice; kind: 'sensor' | 'door' | 'light' }>).map(({ device, kind }) => {
                  const radius = Math.max(design.width, design.depth) * .014;
                  const target: EditorSelection = kind === 'sensor'
                    ? { kind, roomId: room.id } : { kind, roomId: room.id, id: device.id };
                  const handlers = {
                    onPointerDown: (event: React.PointerEvent<SVGElement>) => startPlanDrag(event, target),
                    onClick: (event: React.MouseEvent<SVGElement>) => {
                      if (tool === 'select') { event.stopPropagation(); navigate(floorIndex, target); }
                    }
                  };
                  const className = `editor-${kind}${isSelectedDevice(selection, room.id, kind, device.id) ? ' editor-selected' : ''}`;
                  if (kind === 'door') {
                    const horizontal = device.z === room.z || device.z === room.z + room.depth;
                    const width = radius * (horizontal ? 2.8 : 1.2), height = radius * (horizontal ? 1.2 : 2.8);
                    return <rect key={device.id} className={className} x={device.x - width / 2} y={device.z - height / 2}
                      width={width} height={height} {...handlers} />;
                  }
                  return <circle key={device.id} className={className} cx={device.x} cy={device.z} r={radius} {...handlers} />;
                })}
              </React.Fragment>)}
              <rect className={`editor-controller${selection?.kind === 'controller' ? ' editor-selected' : ''}`}
                x={floor.controllerX - Math.max(design.width, design.depth) * .014}
                y={floor.controllerZ - Math.max(design.width, design.depth) * .014}
                width={Math.max(design.width, design.depth) * .028} height={Math.max(design.width, design.depth) * .028}
                onPointerDown={event => startPlanDrag(event, { kind: 'controller' })}
                onClick={event => { if (tool === 'select') { event.stopPropagation(); navigate(floorIndex, { kind: 'controller' }); } }} />
              {dragPreview && <g className="editor-drag-preview" aria-hidden="true">
                {dragItem && 'width' in dragItem && 'depth' in dragItem
                  ? <rect x={dragPreview.x} y={dragPreview.z}
                    width={dragItem.width} height={dragItem.depth} />
                  : <circle cx={dragPreview.x} cy={dragPreview.z} r={Math.max(design.width, design.depth) * .025} />}
              </g>}
            </svg>
          </Paper>
          <Paper component="section" sx={panelSx}>
            <Typography variant="h6" component="h3">{t('editorItems')}</Typography>
            <Typography>{t('editorDeleteHelp')}</Typography>
            <Typography>{t('editorAccessHelp')}</Typography>
            <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button sx={actionSx} disabled={blocked} onClick={() => addAccess('walkway')}>{t('editorAddWalkwayForm')}</Button>
              <Button sx={actionSx} disabled={blocked || floor.number === design.floors.length} onClick={() => addAccess('stair')}>{t('editorAddStairsForm')}</Button>
            </Stack>
            <Stack className="editor-items" spacing={0.5} sx={{ alignItems: 'stretch' }}>
              <Button sx={actionSx} aria-pressed={selection?.kind === 'controller'} disabled={busy || session.conflict} onClick={() => navigate(floorIndex, { kind: 'controller' })}>{t('editorController')}</Button>
              {(floor.walkways ?? []).map((item, index) => <Button key={item.id} sx={actionSx}
                aria-pressed={selection?.kind === 'walkway' && selection.id === item.id} disabled={busy || session.conflict}
                onClick={() => navigate(floorIndex, { kind: 'walkway', id: item.id })}>{t('editorWalkwayNumber', { number: index + 1 })}</Button>)}
              {(floor.stairs ?? []).map((item, index) => <Button key={item.id} sx={actionSx}
                aria-pressed={selection?.kind === 'stair' && selection.id === item.id} disabled={busy || session.conflict}
                onClick={() => navigate(floorIndex, { kind: 'stair', id: item.id })}>{t('editorStairsUp', { number: index + 1, floor: floor.number + 1 })}</Button>)}
              {(design.floors[incomingFloorIndex]?.stairs ?? []).map((item, index) => <Button key={item.id} sx={actionSx}
                disabled={busy || session.conflict} onClick={() => navigate(incomingFloorIndex, { kind: 'stair', id: item.id })}>
                {t('editorStairsDown', { number: index + 1, floor: floor.number - 1 })}</Button>)}
              {!floor.rooms.length && <Typography>{t('editorNoRooms')}</Typography>}
              {floor.rooms.flatMap(room => {
                const connection = (item: BuildingSensor | BuildingLight) => t(item.controllerId === floor.controllerId ? 'editorConnected' : 'editorDisconnected');
                const items: Array<{ label: string; selection: EditorSelection }> = [
                  { label: t('editorRoom', { name: room.name }), selection: { kind: 'room', roomId: room.id } },
                  { label: `${t('editorSensor', { room: room.name })} — ${connection(room.sensor)}`, selection: { kind: 'sensor', roomId: room.id } },
                  ...room.doors.map((item, index): { label: string; selection: EditorSelection } => ({ label: t('editorDoor', { number: index + 1, room: room.name }), selection: { kind: 'door', roomId: room.id, id: item.id } })),
                  ...room.lights.map((item, index): { label: string; selection: EditorSelection } => ({ label: `${t('editorLight', { number: index + 1, room: room.name })} — ${connection(item)}`, selection: { kind: 'light', roomId: room.id, id: item.id } }))
                ];
                return items.map(item => <Button key={`${item.selection.kind}-${'id' in item.selection ? item.selection.id : 'roomId' in item.selection ? item.selection.roomId : room.id}`} sx={actionSx}
                  aria-pressed={same(selection, item.selection)} disabled={busy || session.conflict}
                  onClick={() => navigate(floorIndex, item.selection)}>{item.label}</Button>);
              })}
            </Stack>
            <Box component="form" data-form="new-room" sx={formSx} onSubmit={submitRoom} noValidate>
              <Typography component="h4" variant="subtitle1">{t('editorAddRoom')}</Typography>
              {nameField('new-room')}
              {field('new-room', 'x', 'editorX')}{field('new-room', 'z', 'editorZ')}
              {field('new-room', 'width', 'editorRoomWidth', { min: 1 })}{field('new-room', 'depth', 'editorRoomDepth', { min: 1 })}
              <Button sx={actionSx} type="submit" disabled={blocked}>{t('editorAddRoomForm')}</Button>
            </Box>
            {found.item && selection && <Box component="form" data-form="properties" sx={formSx} onSubmit={submitProperties} noValidate>
              <Typography component="h4" variant="subtitle1">{t('editorPropertiesFor', { item: selectedName })}</Typography>
              {selection.kind === 'room' && nameField('properties')}
              {field('properties', 'x', 'editorX', selection.kind === 'walkway' || selection.kind === 'stair' ? accessCoords.x : {})}
              {field('properties', 'z', 'editorZ', selection.kind === 'walkway' || selection.kind === 'stair' ? accessCoords.z : {})}
              {selection.kind === 'room' && <>{field('properties', 'width', 'editorRoomWidth', { min: 1 })}{field('properties', 'depth', 'editorRoomDepth', { min: 1 })}</>}
              {(selection.kind === 'walkway' || selection.kind === 'stair') && <>
                {field('properties', 'width', 'editorAccessWidth', accessCoords.width)}
                {field('properties', 'depth', 'editorAccessDepth', accessCoords.depth)}
              </>}
              {selection.kind === 'stair' && <TextField select fullWidth size="small" name="direction" label={t('editorStairsDirection')}
                value={forms.properties?.direction ?? 'east'} disabled={blocked} onChange={event => changeForm('properties', 'direction', event.target.value)}>
                <MenuItem value="east">{t('editorStairsEast')}</MenuItem>
                <MenuItem value="west">{t('editorStairsWest')}</MenuItem>
              </TextField>}
              {(selection.kind === 'sensor' || selection.kind === 'light') && <TextField select fullWidth size="small" name="connection" label={t('editorConnection')}
                value={forms.properties?.connection ?? ''} disabled={blocked} onChange={event => changeForm('properties', 'connection', event.target.value)}>
                <MenuItem value="">{t('editorNoConnection')}</MenuItem>
                <MenuItem value={floor.controllerId}>{t('editorConnected')}</MenuItem>
              </TextField>}
              <Button sx={actionSx} type="submit" disabled={blocked}>{t('editorApply')}</Button>
            </Box>}
            {found.room && <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
              <Button sx={actionSx} disabled={blocked} onClick={() => addDevice('door')}>{t('editorAddDoor')}</Button>
              <Button sx={actionSx} disabled={blocked} onClick={() => addDevice('light')}>{t('editorAddLight')}</Button>
            </Stack>}
          </Paper>
        </Box>
      </>}
    </Box>}
  </Box>;
}
