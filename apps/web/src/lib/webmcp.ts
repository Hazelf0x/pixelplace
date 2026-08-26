// A small, typed layer over the WebMCP imperative API.
//
// WebMCP (`navigator.modelContext`, also aliased onto `document`) lets a page hand an
// agent real tools instead of leaving it to guess at the DOM. The API is young and
// ships behind a flag, so everything here is feature-detected: with no agent present
// the page is an ordinary pixel editor, and nothing below ever runs.
//
// Two constraints from the spec shape every tool in this app:
//   1. Results must be JSON-serializable. A tool CANNOT return an image.
//   2. Tools are unregistered by aborting the signal passed at registration.
//
// (1) is the interesting one. An agent driving this app cannot see what it drew —
// but the person watching the canvas can. So the tools are built to hand back what
// is checkable in text (diagnostics, palette, coverage, structure) and to leave
// judging the picture to the human. That division is the point, not a workaround.

/** JSON Schema for a tool's input. Kept loose — the browser validates, not us. */
export type JsonSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

export interface WebMcpTool {
  /** snake_case, unique within the page. */
  name: string
  /** Written for an agent deciding whether to call it, not for a human reading docs. */
  description: string
  inputSchema: JsonSchema
  /**
   * Hints the browser may surface when asking the user to approve a call.
   * Unknown members are ignored by WebIDL, so this is safe to send everywhere.
   */
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
  }
  /** Must resolve to something JSON-serializable. Throwing reports an error to the agent. */
  execute: (input: never, options: { signal?: AbortSignal }) => unknown | Promise<unknown>
}

interface ModelContext {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => Promise<void> | void
  getTools?: () => unknown
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
}

function modelContext(): ModelContext | null {
  if (typeof document === 'undefined') return null
  // Chrome 151 exposes the same object on both `navigator` and `document`, but the
  // spec text and other implementations are not settled on which is canonical.
  // Checking both costs nothing and means we work wherever it lands.
  const hosts = [navigator, document] as unknown as Array<{ modelContext?: ModelContext }>
  for (const host of hosts) {
    const candidate = host?.modelContext
    if (candidate && typeof candidate.registerTool === 'function') return candidate
  }
  return null
}

/** Whether this browser exposes WebMCP at all. */
export function isWebMcpAvailable(): boolean {
  return modelContext() !== null
}

export type RegistrationStatus =
  | { state: 'unsupported' }
  | { state: 'registered'; tools: string[] }
  | { state: 'failed'; error: string }

/**
 * Register every tool, unregistering them when `signal` aborts.
 *
 * Registration is all-or-nothing from the caller's point of view: a partial set
 * would leave an agent able to read state but not change it, which is worse than
 * offering nothing.
 */
export async function registerTools(
  tools: WebMcpTool[],
  signal: AbortSignal
): Promise<RegistrationStatus> {
  const context = modelContext()
  if (!context) return { state: 'unsupported' }

  try {
    for (const tool of tools) {
      if (signal.aborted) break
      await context.registerTool(tool, { signal })
    }
    return { state: 'registered', tools: tools.map((t) => t.name) }
  } catch (error) {
    return { state: 'failed', error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Wrap a tool's result so agents get a predictable envelope.
 *
 * Every tool in this app answers with `ok` plus either data or a `message` saying
 * what to do about it. An agent refining a program reads the same shape whether
 * the program compiled or not, so its loop stays simple.
 */
export function ok<T extends object>(data: T): { ok: true } & T {
  return { ok: true, ...data }
}

export function fail(message: string, extra: object = {}) {
  return { ok: false, message, ...extra }
}
