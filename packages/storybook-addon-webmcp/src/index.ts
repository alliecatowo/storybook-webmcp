/**
 * Public programmatic surface (spec §33). Consumers that add this package as
 * a Storybook addon never import from here directly — Storybook loads
 * `./manager` and `./preset` by convention. This entry exists for anyone
 * embedding the compiler pipeline or its types/constants outside that
 * lifecycle (tests, tooling, alternate hosts). No React component is
 * re-exported here: components are Manager-only concerns.
 */

export * from './core/types.js'
export {
  ADDON_ID,
  ADDON_NAME,
  ADDON_TITLE,
  ADDON_VERSION,
  HASH_LENGTH,
  LIMITS,
  PANEL_ID,
  TIMEOUTS,
  TOOL_FIND_STORIES,
  TOOL_GET_CONTEXT,
  TOOL_OPEN_STORY,
  TOOL_RESET_CONTROLS_PREFIX,
  TOOL_UPDATE_CONTROLS_PREFIX,
  TOOL_UPDATE_GLOBALS_PREFIX,
} from './core/constants.js'

export { capabilityHash } from './core/hash.js'
export { compileControls, compileArgType } from './storybook/control-compiler.js'
export { compileGlobals } from './storybook/global-compiler.js'
