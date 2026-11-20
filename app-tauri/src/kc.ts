/**
 * window.kc on top of Tauri: same API as the Electron preload (src/shared/ipc.ts), so the UI is unchanged.
 * Binary results come back as raw ArrayBuffers; big uploads (export, saveFile) go as one packed raw body:
 * [u32 headerLen][header JSON][blob…], header.blobs = byte lengths.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { KcApi, MeshDto } from '@shared/ipc'
import type { RgbaImage, TeamExport } from '@shared/types'

const bytes = (b: ArrayBuffer | Uint8Array | number[]): Uint8Array =>
  b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : new Uint8Array(b)

/** [u32 w][u32 h][rgba…] or empty → null */
function rgba(b: ArrayBuffer): RgbaImage | null {
  if (!b || b.byteLength < 8) return null
  const v = new DataView(b)
  return { width: v.getUint32(0, true), height: v.getUint32(4, true), data: new Uint8Array(b, 8) }
}

function pack(header: Record<string, unknown>, blobs: Uint8Array[]): Uint8Array {
  const h = new TextEncoder().encode(JSON.stringify({ ...header, blobs: blobs.map((b) => b.byteLength) }))
  const total = 4 + h.byteLength + blobs.reduce((s, b) => s + b.byteLength, 0)
  const out = new Uint8Array(total)
  new DataView(out.buffer).setUint32(0, h.byteLength, true)
  out.set(h, 4)
  let p = 4 + h.byteLength
  for (const b of blobs) { out.set(b, p); p += b.byteLength }
  return out
}

function packTeam(t: TeamExport): { team: object; blobs: Uint8Array[] } {
  const blobs: Uint8Array[] = []
  const ref = (img?: RgbaImage): { width: number; height: number; blob: number } | undefined => {
    if (!img) return undefined
    blobs.push(bytes(img.data as Uint8Array))
    return { width: img.width, height: img.height, blob: blobs.length - 1 }
  }
  const team = {
    teamId: t.teamId, teamName: t.teamName, league: t.league, emblem: ref(t.emblem),
    kits: t.kits.map((k) => ({ slot: k.slot, kit: ref(k.kit), back: ref(k.back), leg: ref(k.leg), name: ref(k.name), chest: ref(k.chest), config: k.config, format: k.format }))
  }
  return { team, blobs }
}

const call = <T>(cmd: string, args?: Record<string, unknown>): Promise<T> => invoke<T>(cmd, args)

export const kc: KcApi & { launchGame(): Promise<string> } = {
  getSettings: () => call('get_settings'),
  getVersion: () => call('get_version'),
  checkUpdate: (auto) => call('check_update', { auto }),
  installUpdate: (url, version) => call('install_update', { url, version }),
  onUpdateProgress: (cb) => {
    let off: (() => void) | null = null
    let dead = false
    listen<number>('kc:update-progress', (e) => cb(e.payload)).then((u) => { if (dead) u(); else off = u })
    return () => { dead = true; off?.() }
  },
  saveSettings: (s) => call('save_settings', { s }),
  pickFolder: (title) => call('pick_folder', { title }),
  pickFiles: (filters, multi) => call('pick_files', { filters, multi }),
  saveFile: (name, data) => invoke('save_file', pack({ name }, [bytes(data)])),

  openGame: (root) => call('open_game', { root }),
  listTeams: () => call('list_teams'),
  readKitTexture: async (teamId, slot, part, mip) => rgba(await call<ArrayBuffer>('read_kit_texture', { teamId, slot, part, mip })),
  readEmblem: async (teamId) => {
    const b = await call<ArrayBuffer>('read_emblem', { teamId })
    return b && b.byteLength ? new Uint8Array(b) : null
  },
  readModel: async (name) => {
    const ms = await call<{ positions: number[]; normals: number[] | null; uvs: number[]; indices: number[] }[]>('read_model', { name })
    return ms.map((m): MeshDto => ({
      positions: new Float32Array(m.positions), normals: m.normals ? new Float32Array(m.normals) : null,
      uvs: new Float32Array(m.uvs), indices: new Uint16Array(m.indices)
    }))
  },
  listCollars: () => call('list_collars'),
  listNumberSets: () => call('list_number_sets'),

  listFonts: () => call<string[]>('list_fonts'),
  readFile: async (path) => new Uint8Array(await call<ArrayBuffer>('read_file', { path })),
  decodeImageFile: async (path) => rgba(await call<ArrayBuffer>('decode_image_file', { path })),
  fetchUrl: async (url) => {
    const b = await call<ArrayBuffer>('fetch_url', { url })
    const n = new DataView(b).getUint32(0, true)
    return { mime: new TextDecoder().decode(new Uint8Array(b, 4, n)), data: new Uint8Array(b, 4 + n) }
  },
  listLibrary: () => call('list_library'),
  listTextures: (kind) => call('list_textures', { kind }),

  exportTeam: (t: TeamExport, projectJson, thumbPng) => {
    const { team, blobs } = packTeam(t)
    let thumb: number | undefined
    if (thumbPng) { blobs.push(thumbPng); thumb = blobs.length - 1 }
    return invoke('export_team', pack({ team, project: projectJson, thumb }, blobs))
  },
  exportKitserver: (t: TeamExport, dest) => {
    const { team, blobs } = packTeam(t)
    return invoke('export_kitserver', pack({ team, dest }, blobs))
  },
  restoreOriginal: (teamId) => call('restore_original', { teamId }),
  listSnapshots: (teamId) => call('list_snapshots', { teamId }),
  saveSnapshot: (teamId, name, fromSnapshot) => call('save_snapshot', { teamId, name, fromSnapshot }),
  renameSnapshot: (teamId, id, name) => call('rename_snapshot', { teamId, id, name }),
  deleteSnapshot: (teamId, id) => call('delete_snapshot', { teamId, id }),
  activateSnapshot: (teamId, id) => call('activate_snapshot', { teamId, id }),
  loadSnapshotProject: (teamId, id) => call('load_snapshot_project', { teamId, id }),
  exportSnapshotZip: (teamId, id) => call('export_snapshot_zip', { teamId, id }),
  backupOriginalZip: (teamId) => call('backup_original_zip', { teamId }),
  openPath: (p) => call('open_path', { p }),

  saveDraft: (teamId, projectJson, thumbs, exported) => call('save_draft', { teamId, projectJson, thumbs, exported }),
  loadDraft: (teamId) => call('load_draft', { teamId }),
  saveUserTemplate: (id, json) => call('save_user_template', { id, json }),
  exportKitlab: (name, manifest, assets) => call('export_kitlab', { name, manifest, assets }),
  readKitlab: (path) => call('read_kitlab', { path }),
  vectorizeMask: (dataUrl, opts) => call('vectorize_mask', { dataUrl, opts }),
  analyzeTexture: (dataUrl, opts) => call('analyze_texture', { dataUrl, opts }),
  listUserTemplates: () => call('list_user_templates'),
  deleteUserTemplate: (id) => call('delete_user_template', { id }),
  saveUserLayers: (id, json) => call('save_user_layers', { id, json }),
  listUserLayers: () => call('list_user_layers'),
  deleteUserLayers: (id) => call('delete_user_layers', { id }),
  listTemplateImages: () => call('list_template_images'),
  screenPixel: () => call('screen_pixel'),
  licenceHint: (teamId) => call('licence_hint', { teamId }),
  templateDirPath: () => call('template_dir_path'),
  deleteDraft: (teamId) => call('delete_draft', { teamId }),
  listDrafts: () => call('list_drafts'),

  onProgress: (cb) => {
    let off: (() => void) | null = null
    let dead = false
    listen<string>('kc:progress', (e) => cb(e.payload)).then((u) => { if (dead) u(); else off = u })
    return () => { dead = true; off?.() }
  },
  launchGame: () => call('launch_game')
}

window.kc = kc
