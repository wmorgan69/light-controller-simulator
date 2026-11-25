import type {
  BuildingDesignDto,
  DoorDesignDto,
  FloorDesignDto,
  LightDesignDto,
  RoomDesignDto,
  SensorDesignDto,
  WalkwayDesignDto,
  StairDesignDto
} from '../shared/simulator-model.js';

export type BuildingDevice = DoorDesignDto;
export type BuildingDoor = DoorDesignDto;
export type BuildingSensor = SensorDesignDto;
export type BuildingLight = LightDesignDto;
export type BuildingRoom = RoomDesignDto;
export type BuildingFloor = FloorDesignDto;
export type BuildingDesign = BuildingDesignDto;
export type BuildingWalkway = WalkwayDesignDto;
export type BuildingStair = StairDesignDto;

export type EditorSelection =
  | { kind: 'controller' }
  | { kind: 'walkway'; id: string }
  | { kind: 'stair'; id: string }
  | { kind: 'room'; roomId: string }
  | { kind: 'sensor'; roomId: string }
  | { kind: 'door'; roomId: string; id: string }
  | { kind: 'light'; roomId: string; id: string };

export type EditorTool = 'select' | 'room' | 'door' | 'light' | 'move' | 'walkway' | 'stair';
export type EditorFormName = 'building' | 'new-room' | 'properties';
export type EditorFormValues = Record<string, string>;
export type EditorForms = Partial<Record<EditorFormName, EditorFormValues>>;

export interface PendingEditorField {
  name: string;
  type: 'text';
  value: string;
}

export interface PendingEditorForm {
  form: EditorFormName;
  fields: PendingEditorField[];
}

export interface EditorValidationIssue {
  error: string;
  field?: string;
  floor?: number;
  item?: string;
  selection?: EditorSelection;
}

export interface EditorCleanupEntry {
  status: string;
}

export interface BuildingEditorStateDto {
  design: BuildingDesign;
  activeDesign: BuildingDesign | null;
  editRevision: number;
  activationStatus: string;
  cleanup: EditorCleanupEntry[] | null;
}

export interface SaveBuildingEditorDto {
  expectedRevision: number;
  design: BuildingDesign;
}

export interface MutationAccess {
  readonly editorAllowed: boolean;
  readonly editorMessage: string;
  subscribe(listener: () => void): void | (() => void);
  request(url: string, options?: RequestInit, editor?: boolean): Promise<Response>;
}

export interface EditorProps {
  mutationAccess: MutationAccess;
  onActivated?: () => void | Promise<void>;
  menuContainer?: HTMLElement | null;
}

export interface EditorNumericConstraints {
  min?: number;
  max?: number;
  step?: number | 'any';
}

export type EditorPendingProjection =
  | {
    design: BuildingDesign;
    issue: null;
  }
  | {
    design: null;
    issue: {
      form: EditorFormName | null;
      field: string;
      problem?: EditorValidationIssue;
    };
  };

export interface EditorRecoveryContext {
  floorIndex: number;
  floorNumber: number | null;
  selection: EditorSelection | null;
  conflict: boolean;
  savedRevision: number | null;
  editRevision: number | null;
}

export interface EditorStatusCounts {
  pending: number;
  failed: number;
  completed: number;
  cancelled: number;
}
