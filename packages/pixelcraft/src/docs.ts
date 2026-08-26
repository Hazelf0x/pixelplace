/**
 * Public documentation entry point. Keeping these exports separate from the browser
 * renderer lets documentation pages share the compiler's canonical reference without
 * adding the whole reference table to the Studio's client bundle.
 */
export {
  DOCS_ADDITIONAL_NOTES,
  DOCS_REFERENCE_ROWS
} from './lang/docs-content'

export type { DocsReferenceRow } from './lang/docs-content'
