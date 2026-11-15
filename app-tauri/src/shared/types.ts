/** Types shared by the main process and the renderer. */

export interface KitSlotInfo {
  slot: string // p1, p2, p3, g1...
  source: 'kitserver' | 'game'
  file?: string // absolute path (kitserver) or inner CPK path (game)
  config?: Record<string, string>
}

export interface TeamInfo {
  id: number
  name: string
  abbr: string
  league: string
  country: string
  tier?: number
  kitFolder?: string
  managedByUs: boolean
  slots: KitSlotInfo[]
  hasEmblem: boolean
}

export interface GameStatus {
  root: string
  exe?: string
  siderDir?: string
  kitsRoot?: string
  livecpkRoots: string[]
  teamCount: number
}

export interface RgbaImage { width: number; height: number; data: Uint8Array }

/** Everything needed to write one kit slot to the game. */
export interface KitExport {
  slot: string
  kit: RgbaImage // 2048x2048 (or whatever size) kit texture
  back?: RgbaImage
  leg?: RgbaImage
  name?: RgbaImage
  chest?: RgbaImage // own chest numbers (ChestNumbersFile)
  config: Record<string, string | number>
  format?: 'DXT5' | 'BC7'
}

export interface TeamExport {
  teamId: number
  teamName: string
  league: string
  kits: KitExport[]
  emblem?: RgbaImage // 512x512 source used for all emblem variants
}

export interface SnapshotInfo {
  id: string
  teamId: number
  name: string
  createdAt: string
  fixed?: boolean // "Original"
  thumb?: string // data URL
  active?: boolean
}
