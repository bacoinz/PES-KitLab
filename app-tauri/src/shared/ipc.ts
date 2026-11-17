/** Typed IPC surface exposed to the renderer as window.kc */
import type { GameStatus, TeamInfo, RgbaImage, TeamExport, SnapshotInfo } from './types'

export interface MeshDto { positions: Float32Array; normals: Float32Array | null; uvs: Float32Array; indices: Uint16Array }

/** Defaults for new kits (Settings tab). `preset` = JSON of a saved kit design (without logos / numbers). */
export interface KitDefaults {
  templates?: { home?: string; away?: string; third?: string; gk?: string }
  collar?: number
  shortsModel?: number
  tight?: boolean
  chestNumber?: 'auto' | 'always' | 'never'
  shine?: number
  preset?: string
  /** own template per kit type, made in the editor (KitDesign JSON without logos / numbers / slot / base) */
  presets?: Partial<Record<PresetType, string>>
}
export type PresetType = 'home' | 'away' | 'third' | 'fourth' | 'gk'

export interface Settings {
  gameRoot?: string
  logoFolders: string[]
  defaultFormat: 'DXT5' | 'BC7'
  exportSize?: 512 | 1024 | 2048 | 4096 // kit texture size written for the game (default 2048)
  lang: 'pt' | 'en' | 'es'
  defaults?: KitDefaults
  /** colours the design grids preview with (1st, 2nd, 3rd colour) and the plain kit under them */
  previewColors?: string[]
  previewBase?: string
  /** save the open team every N minutes (0 / undefined = off) */
  autoSave?: 0 | 2 | 5 | 10 | 15
}

export interface LibraryItem { path: string; name: string; folder: string }

export interface NumberSet { id: string; label: string; back?: string; leg?: string; name?: string }

export interface DraftInfo { teamId: number; savedAt: string; exportedAt?: string; thumbs: Record<string, string> }

export interface ExportResult { ok: boolean; message: string; folder?: string; snapshotId?: string }

export interface KcApi {
  getSettings(): Promise<Settings>
  getVersion(): Promise<string>
  saveSettings(s: Partial<Settings>): Promise<Settings>
  pickFolder(title?: string): Promise<string | null>
  pickFiles(filters: { name: string; extensions: string[] }[], multi?: boolean): Promise<string[]>
  saveFile(defaultName: string, data: Uint8Array): Promise<string | null>

  openGame(root: string): Promise<GameStatus>
  listTeams(): Promise<TeamInfo[]>
  readKitTexture(teamId: number, slot: string, part: 'kit' | 'back' | 'leg' | 'name' | 'chest', mip: number): Promise<RgbaImage | null>
  readEmblem(teamId: number): Promise<Uint8Array | null>
  readModel(name: string): Promise<MeshDto[]>
  listCollars(): Promise<number[]>
  listNumberSets(): Promise<NumberSet[]>

  readFile(path: string): Promise<Uint8Array>
  decodeImageFile(path: string): Promise<RgbaImage | null> // DDS / FTEX → RGBA (PNG etc. are decoded in the renderer)
  fetchUrl(url: string): Promise<{ data: Uint8Array; mime: string }>
  listLibrary(): Promise<LibraryItem[]>
  /** pattern / graphic libraries: category folders are created on first call */
  listTextures(kind: 'patterns' | 'graphics'): Promise<{ root: string; categories: string[]; items: { path: string; name: string; category: string }[] }>

  exportTeam(t: TeamExport, projectJson: string, thumbPng?: Uint8Array): Promise<ExportResult>
  /** writes the team's kits in the Sider kit-server layout into `dest` (does not touch the game) */
  exportKitserver(t: TeamExport, dest: string): Promise<string>
  restoreOriginal(teamId: number): Promise<ExportResult>
  listSnapshots(teamId: number): Promise<SnapshotInfo[]>
  saveSnapshot(teamId: number, name: string, fromSnapshot?: string): Promise<SnapshotInfo>
  renameSnapshot(teamId: number, id: string, name: string): Promise<void>
  deleteSnapshot(teamId: number, id: string): Promise<void>
  activateSnapshot(teamId: number, id: string): Promise<ExportResult>
  loadSnapshotProject(teamId: number, id: string): Promise<string | null>
  exportSnapshotZip(teamId: number, id: string): Promise<string | null>
  backupOriginalZip(teamId: number): Promise<string | null>
  openPath(p: string): Promise<string>

  saveDraft(teamId: number, projectJson: string, thumbs: Record<string, string>, exported?: boolean): Promise<void>
  loadDraft(teamId: number): Promise<string | null>
  /** named shirt templates (KitCreatorData/templates): JSON of { id, name, date, kit, assets } */
  saveUserTemplate(id: string, json: string): Promise<void>
  listUserTemplates(): Promise<string[]>
  deleteUserTemplate(id: string): Promise<void>
  /** full kit textures (PNG / JPG) in KitCreatorData/templates */
  listTemplateImages(): Promise<{ path: string; name: string; category: string }[]>
  templateDirPath(): Promise<string>
  /** colour of the screen pixel under the mouse (eyedropper) */
  screenPixel(): Promise<string>
  /** why the game may not show this team's kit-server kits (unlicensed club), or null */
  licenceHint(teamId: number): Promise<string | null>
  deleteDraft(teamId: number): Promise<void>
  listDrafts(): Promise<DraftInfo[]>

  onProgress(cb: (msg: string) => void): () => void
  /** Starts Sider (if not running) and then the game. */
  launchGame(): Promise<string>
}

declare global {
  interface Window { kc: KcApi }
}
