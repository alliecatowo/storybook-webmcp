/**
 * Addon identity and every hard bound the WebMCP capability surface obeys.
 * These are the only magic numbers in the addon; nothing re-declares them.
 */

export const ADDON_NAME = 'storybook-addon-webmcp'
export const ADDON_VERSION = '0.1.0'

export const ADDON_ID = 'storybook/webmcp'
export const PANEL_ID = `${ADDON_ID}/panel`
export const ADDON_TITLE = 'WebMCP'

/** Stable, session-lifetime tool names. */
export const TOOL_GET_CONTEXT = 'storybook_get_context'
export const TOOL_FIND_STORIES = 'storybook_find_stories'
export const TOOL_OPEN_STORY = 'storybook_open_story'
export const TOOL_SAVE_STORY = 'storybook_save_story'
export const TOOL_CREATE_STORY = 'storybook_create_story'

/** Prefixes for contextual tools; the capability hash is appended after a dot. */
export const TOOL_UPDATE_CONTROLS_PREFIX = 'storybook_update_controls'
export const TOOL_RESET_CONTROLS_PREFIX = 'storybook_reset_controls'
export const TOOL_UPDATE_GLOBALS_PREFIX = 'storybook_update_globals'

/** Result and schema bounds (spec §38). */
export const LIMITS = {
  /** Max stories returned by storybook_find_stories. */
  searchResults: 20,
  /** Default page size for storybook_find_stories. */
  searchResultsDefault: 10,
  /** Max query length accepted by storybook_find_stories. */
  searchQueryLength: 100,
  /** Max story-id length accepted by storybook_open_story. */
  storyIdLength: 200,
  /** Max enum/option values in any compiled schema. */
  options: 50,
  /** Max viewport options exposed. */
  viewportOptions: 50,
  /** Truncation for descriptions surfaced in context. */
  description: 240,
  /** Truncation for string control values surfaced in context. */
  contextString: 500,
  /** Truncation for string values inside mutation evidence. */
  evidenceString: 300,
  /** Recent executions retained by the diagnostic panel. */
  recentCalls: 5,
  /** Max recursion depth when compiling structured SBTypes. */
  objectDepth: 3,
  /** Max object properties compiled at each level. */
  objectProperties: 30,
  /** Max array items allowed by compiled array schemas. */
  arrayItems: 50,
  /** Max length of agent-authored freeform text controls. */
  stringControl: 2000,
  /** Max length of agent-authored color controls. */
  colorControl: 128,
  /** Max members of a compiled SB union. */
  unionMembers: 8,
  /** Max members of a compiled SB intersection. */
  intersectionMembers: 5,
} as const

/** Event-driven verification timeouts in milliseconds (spec §39). */
export const TIMEOUTS = {
  argsUpdate: 1500,
  globalsUpdate: 1500,
  navigation: 3000,
  /**
   * One-shot re-validation delay after a contextual capability is registered.
   * The Manager finishes settling its own globals shortly after STORY_PREPARED,
   * and that settling arrives without an observable lifecycle event.
   */
  settle: 250,
} as const

/** Length of the hexadecimal capability fingerprint appended to tool names. */
export const HASH_LENGTH = 8
