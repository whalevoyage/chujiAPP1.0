export type LocalObject = Record<string, unknown>

export type LocalRouteResult =
  | { handled: false }
  | { handled: true; value: unknown }

export type LocalRouteContext = {
  path: string
  method: string
  body: LocalObject
  segments: string[]
  query: URLSearchParams
  idAt: (index: number) => number
  all: (entity: string) => Promise<LocalObject[]>
  byId: (entity: string, id: number, label?: string) => Promise<LocalObject>
  getRow: (entity: string, id: number) => Promise<LocalObject | null>
  getMeta: (key: string) => Promise<string | null>
  save: (entity: string, row: LocalObject) => Promise<LocalObject>
  created: (entity: string, values: LocalObject, defaults?: LocalObject) => Promise<LocalObject>
  asNumber: (value: unknown, fallback?: number) => number
  asText: (value: unknown, fallback?: string) => string
  now: () => string
  today: () => string
  notFound: (label: string) => never
  deleteRow: (entity: string, id: number) => Promise<void>
  stepsForPlan: (planId: number) => Promise<LocalObject[]>
  planResponse: (plan: LocalObject) => Promise<LocalObject>
  refreshLocalPlanStatus: (planId: number) => Promise<void>
  taskResponse: (task: LocalObject) => Promise<LocalObject>
  dateInRange: (value: unknown, from?: string, to?: string) => boolean
  searchMatch: (row: LocalObject, query: string, fields: string[]) => boolean
  diaryResponse: (row: LocalObject) => Promise<LocalObject>
  setDiaryTags: (entryId: number, names: string[]) => Promise<void>
  callModel: (settings: LocalObject, kind: 'ai' | 'ocr', messages: Array<{ role: string; content: unknown }>) => Promise<string>
  analyzeScore: (row: LocalObject) => Promise<LocalObject>
}

export const unhandledRoute: LocalRouteResult = { handled: false }

export function handledRoute(value: unknown): LocalRouteResult {
  return { handled: true, value }
}
