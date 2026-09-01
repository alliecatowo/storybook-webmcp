# STORYBOOK WEBMCP — FINAL IMPLEMENTATION CONTRACT

OpenAI WebMCP Challenge — September 2026

You are implementing the complete hackathon submission.

This document is the implementation contract. Do not redesign the product, broaden its scope, introduce alternative architectures, or stop after planning.

Build, test, integrate, deploy, document, and prepare the submission described here.

The starting application is a current fork/clone of:

Yann Braga's MealDrop, branch "main"

MealDrop exists only as the real-world demonstration environment.

The actual product created for this challenge is:

"storybook-addon-webmcp"

Tagline:

«Your agent shouldn't have its own Storybook. It should work in yours.»

Secondary line:

«Same story. Same state. Same screen. Human and agent.»

---

## 0. PRODUCT IN ONE SENTENCE

Storybook WebMCP is a generic Storybook addon that compiles the semantic state of the Storybook a human is currently using—stories, controls, ArgTypes, globals, and viewport configuration—into a small, dynamically typed WebMCP capability surface for a browser agent.

The human and agent operate on the same authoritative Storybook state.

There is no separate agent state.

There is no MCP server.

There is no synchronization backend.

There is no agent-specific UI replica.

---

## 1. THE USER EXPERIENCE WE ARE BUILDING

A frontend developer has Storybook open.

They are looking at:

"Components / Review / Default"

The human can already manipulate that story with Storybook Controls.

The browser agent should be able to understand and manipulate those same semantic controls without clicking the Controls DOM.

The human says:

«What am I looking at?»

The agent receives structured Storybook context.

The human says:

«Make this a one-star review.»

The agent receives a tool whose actual JSON Schema says:

"rating" is a number from "0" through "5" in increments of "0.1".

The agent changes "rating" to "1".

The ordinary Storybook Controls panel changes.

The ordinary Storybook Preview changes.

Then the human manually moves the rating slider to "4.3".

No agent call occurs.

The human says:

«Keep the rating I just chose, but show this in dark mode on a phone.»

The agent changes Storybook globals.

The rating remains exactly "4.3", because both human and agent are operating on the same Storybook state.

Then the human manually navigates to:

"Components / Icon / Playground"

The old Review-specific editing capability disappears.

A new WebMCP capability appears whose schema says:

- "name" must be one of the actual Icon options
- "size" is numeric

The human says:

«Make this a star.»

The agent uses the newly available capability.

Then:

«Find and open the checkout flow.»

The agent searches the Storybook story index and opens the appropriate "UserFlows/App" story.

That story's Storybook "play" function executes naturally when it renders.

This is the entire product thesis.

---

## 2. ARCHITECTURE — FINAL AND NON-NEGOTIABLE

The architecture is:

```
                HUMAN
                  │
          Storybook Controls
          Sidebar / Toolbars
                  │
                  ▼
        ┌────────────────────┐
        │ Storybook Manager  │
        │   authoritative    │
        │    live state      │
        └────────────────────┘
             │          │
             │          └──── Storybook APIs / channel
             │                         │
             │                         ▼
             │               Preview iframe
             │                rendered story
             │
             ▼
   storybook-addon-webmcp
             │
    capability compiler
             │
             ▼
 document.modelContext
             │
             ▼
       BROWSER AGENT
```

The WebMCP runtime lives in the Storybook Manager/top-level document.

Do NOT register required WebMCP tools in Preview.

Do NOT communicate with an MCP server.

Do NOT use "@storybook/addon-mcp".

Do NOT invoke Storybook's MCP endpoint.

Do NOT create an MCP client.

Do NOT expose MCP resources.

Do NOT implement Claude Channels.

Do NOT use polling.

Do NOT maintain shadow Storybook state.

Do NOT build a backend.

Storybook's internal Manager↔Preview channel is normal Storybook implementation plumbing only.

It must not appear in the product as a protocol feature.

---

## 3. WEBMCP MODEL

Use the current WebMCP API:

"document.modelContext"

The project uses these WebMCP capabilities intentionally:

- "registerTool"
- JSON Schema "inputSchema"
- tool "title"
- tool "description"
- "execute"
- execute-time "AbortSignal"
- registration-time "AbortSignal"
- "readOnlyHint"
- "untrustedContentHint"
- dynamic registration/removal
- "toolchange"

Use "getTools()" and "executeTool()" only in automated/local diagnostic tests.

They are not part of the product workflow.

Do NOT implement or emulate:

- MCP Resources
- resource subscriptions
- MCP Prompts
- MCP Sampling
- MCP transport
- stdio
- SSE
- Streamable HTTP
- Claude Channels
- generic notifications
- declarative WebMCP
- cross-frame WebMCP
- cross-origin WebMCP

Those features are outside this submission.

---

## 4. EXACT WEBMCP TOOL SURFACE

There are exactly six conceptual tools.

Three are stable for the Storybook Manager session.

Three are contextual and exist only when their corresponding capability exists.

Stable

1. "storybook_get_context"
2. "storybook_find_stories"
3. "storybook_open_story"

Contextual

4. "storybook_update_controls.<hash>"
5. "storybook_reset_controls.<hash>"
6. "storybook_update_globals.<hash>"

There is NO interaction-test tool.

There is NO arbitrary Storybook API tool.

There is NO generic event tool.

There is NO screenshot/DOM inspection tool.

There is NO source-code editing tool.

---

## 5. TOOL 1 — "storybook_get_context"

Machine name:

"storybook_get_context"

Title:

"Inspect current Storybook context"

Description:

"Read the story, editable controls, and relevant global UI state currently shared by the human and agent in Storybook."

Annotations:

```
{
  readOnlyHint: true,
  untrustedContentHint: true
}
```

Input schema:

```
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

The implementation reads live Storybook state at invocation time.

Return shape:

```
{
  ok: true,
  addon: {
    name: "storybook-addon-webmcp",
    version: string
  },
  story: {
    id: string,
    title: string,
    name: string,
    viewMode: "story" | "docs" | string
  } | null,

  controls: {
    values: Record<string, JsonSafeValue>,
    editable: Array<{
      name: string,
      label?: string,
      kind:
        | "boolean"
        | "string"
        | "number"
        | "enum"
        | "multi-enum"
        | "color"
        | "date"
        | "array"
        | "object",
      description?: string,
      options?: JsonPrimitive[],
      minimum?: number,
      maximum?: number,
      step?: number
    }>,
    skippedCount: number
  },

  globals: {
    values: Record<string, JsonSafeValue>,
    editable: Array<{
      name: string,
      description?: string,
      options?: JsonPrimitive[]
    }>,
    viewport?: {
      value: string | null,
      isRotated: boolean,
      options: Array<{
        id: string,
        name: string,
        width: string,
        height: string,
        type?: string
      }>
    }
  },

  capabilities: {
    controlsSchema: string | null,
    globalsSchema: string | null
  }
}
```

Only return args that are actually part of our editable/safe control surface.

Do not dump every raw story arg.

Do not serialize React objects.

Do not expose parameters wholesale.

Descriptions are truncated to 240 characters.

String values included in context are truncated to 500 characters.

Options arrays are capped at 50.

Viewport options are capped at 50.

If there is no current story:

```
{
  "ok": true,
  "story": null,
  "controls": {
    "values": {},
    "editable": [],
    "skippedCount": 0
  },
  "globals": {
    "values": {},
    "editable": []
  },
  "capabilities": {
    "controlsSchema": null,
    "globalsSchema": null
  }
}
```

Do not throw merely because the user is on a docs/root page.

---

## 6. TOOL 2 — "storybook_find_stories"

Machine name:

"storybook_find_stories"

Title:

"Find Storybook stories"

Description:

"Find Storybook stories by component, story name, title, or story ID so one can be opened semantically."

Annotations:

```
{
  readOnlyHint: true,
  untrustedContentHint: true
}
```

Input schema:

```
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "minLength": 1,
      "maxLength": 100,
      "description": "Text to match against Storybook story IDs, component titles, and story names."
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 20,
      "default": 10
    }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

Use:

"api.getIndex()"

Search only entries whose entry type is an actual Storybook story.

Do not return docs entries.

Normalize query with:

- "trim"
- lowercase
- collapse whitespace

Scoring:

- exact story ID = 100
- exact "title/name" = 95
- exact story name = 90
- title begins with query = 80
- story name begins with query = 80
- ID begins with query = 75
- every query token occurs somewhere in combined "id title name" = 60
- simple substring = 50
- otherwise no match

Sort:

1. score descending
2. title ascending
3. story name ascending

Return:

```
{
  ok: true,
  query: string,
  matches: Array<{
    id: string,
    title: string,
    name: string
  }>,
  returned: number,
  truncated: boolean
}
```

Never return more than "limit".

Do not add Fuse.js or another fuzzy-search dependency.

---

## 7. TOOL 3 — "storybook_open_story"

Machine name:

"storybook_open_story"

Title:

"Open a Storybook story"

Description:

"Navigate the shared Storybook UI to an exact story returned by storybook_find_stories."

Annotations:

```
{
  readOnlyHint: false,
  untrustedContentHint: true
}
```

Input schema:

```
{
  "type": "object",
  "properties": {
    "storyId": {
      "type": "string",
      "minLength": 1,
      "maxLength": 200,
      "description": "Exact Storybook story ID returned by storybook_find_stories."
    }
  },
  "required": ["storyId"],
  "additionalProperties": false
}
```

Execution:

1. Abort immediately if execute signal is already aborted.
2. Read "api.getIndex()".
3. Find exact "storyId".
4. Reject unless entry exists AND represents a story.
5. Snapshot current story ID.
6. Register abort-aware listeners for the relevant Storybook navigation/preparation events BEFORE issuing navigation.
7. Navigate using Storybook's Manager API:
   "api.selectStory(storyId, undefined, { viewMode: 'story' })"
   or the equivalent exact call required by Storybook 10.5's type signature.
8. Wait for the requested story to become current and prepared.
9. Maximum wait: 3000 ms.
10. Read "api.getCurrentStoryData()".
11. Verify its ID equals "storyId".
12. Return result.

Success:

```
{
  "ok": true,
  "action": "open_story",
  "before": "components-review--default",
  "after": "userflows-app--to-checkout-page",
  "verified": true
}
```

Domain failure:

```
{
  "ok": false,
  "error": {
    "code": "STORY_NOT_FOUND",
    "message": "No story with that exact ID exists in the current Storybook index.",
    "retryable": true
  }
}
```

Opening a normal Storybook story already causes its Storybook "play" function to run.

Do not separately execute the play function.

This is how the MealDrop UserFlows demo works.

---

## 8. TOOL 4 — DYNAMIC CONTROL UPDATE

Machine name:

"storybook_update_controls.<8-char-hash>"

Example:

"storybook_update_controls.a81f03c2"

Title:

"Update current Storybook controls"

Description:

"Update one or more editable controls on the Storybook story currently shared by the human and agent."

Annotations:

```
{
  readOnlyHint: false,
  untrustedContentHint: true
}
```

The exact "inputSchema" is generated from the CURRENT story.

Example for MealDrop Review:

```
{
  "type": "object",
  "properties": {
    "rating": {
      "type": "number",
      "minimum": 0,
      "maximum": 5,
      "multipleOf": 0.1,
      "description": "Current Storybook control for rating."
    }
  },
  "minProperties": 1,
  "additionalProperties": false
}
```

Example for MealDrop Icon Playground:

```
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "enum": [
        "arrow-right",
        "arrow-left",
        "cross",
        "cart",
        "minus",
        "plus",
        "moon",
        "sun",
        "star"
      ]
    },
    "size": {
      "type": "number"
    }
  },
  "minProperties": 1,
  "additionalProperties": false
}
```

No top-level properties are required.

This is PATCH semantics.

The agent can update one control without overwriting another.

This is essential to shared human-agent collaboration.

---

## 9. TOOL 5 — DYNAMIC CONTROL RESET

Machine name:

"storybook_reset_controls.<same-controls-hash>"

Title:

"Reset current Storybook controls"

Description:

"Reset all editable controls on the current story, or reset a selected subset, to the story's initial values."

Annotations:

```
{
  readOnlyHint: false,
  untrustedContentHint: true
}
```

If current writable controls are:

rating
showAvatar
label

Input schema:

```
{
  "type": "object",
  "properties": {
    "controls": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": ["rating", "showAvatar", "label"]
      },
      "minItems": 1,
      "maxItems": 3,
      "uniqueItems": true,
      "description": "Controls to reset. Omit to reset every currently editable control."
    }
  },
  "additionalProperties": false
}
```

"{}" means reset every currently editable control.

Execution uses:

"api.resetStoryArgs(story, names?)"

Never reset hidden/non-writable controls accidentally.

Verify resulting values after Storybook reports the args update.

---

## 10. TOOL 6 — DYNAMIC GLOBAL UPDATE

Machine name:

"storybook_update_globals.<8-char-hash>"

Title:

"Update Storybook global controls"

Description:

"Update the editable global Storybook settings available for the current story, such as theme or viewport."

Annotations:

```
{
  readOnlyHint: false,
  untrustedContentHint: true
}
```

Register this tool ONLY when at least one safe global capability exists.

It exposes two classes of global capability:

### A. Custom finite toolbar globals

Read:

"api.getGlobalTypes()"

A custom global is exposed only when:

1. it has "toolbar.items";
2. it has at least one valid selectable item;
3. there are at most 50 selectable items;
4. every selectable value is a JSON primitive;
5. the current story does NOT override/lock that global through "api.getStoryGlobals()".

Toolbar items may be either:

"light"

or objects such as:

```
{
  value: "light",
  title: "Light"
}
```

Extract the actual item value.

Ignore separators/non-value items.

Example:

```
{
  "theme": {
    "type": "string",
    "enum": ["light", "dark", "side-by-side"],
    "description": "Theme for the components"
  }
}
```

Do NOT special-case the word "theme".

MealDrop's theme appears because it is a valid Storybook global.

Any other Storybook with a finite toolbar global receives equivalent support automatically.

### B. Viewport

Treat viewport as a first-class built-in Storybook global.

Viewport is exposed when:

1. current story's "parameters.viewport.disable !== true";
2. "parameters.viewport.options" contains valid viewport options;
3. current story does not lock the "viewport" global through story globals.

Input property:

```
{
  "viewport": {
    "type": "object",
    "properties": {
      "value": {
        "type": "string",
        "enum": ["mobile1", "mobile2", "tablet", "..."]
      },
      "isRotated": {
        "type": "boolean"
      }
    },
    "required": ["value"],
    "additionalProperties": false
  }
}
```

The valid "value" enum consists of:

- every key in current "parameters.viewport.options"
- PLUS the current effective viewport value when it is a string but not one of those keys

This preserves valid Storybook states such as a responsive/default value.

"isRotated" is optional.

When omitted, preserve the current "isRotated" value.

Example complete MealDrop-ish globals schema:

```
{
  "type": "object",
  "properties": {
    "theme": {
      "type": "string",
      "enum": ["light", "dark", "side-by-side"]
    },
    "viewport": {
      "type": "object",
      "properties": {
        "value": {
          "type": "string",
          "enum": [
            "responsive",
            "breakpointXS",
            "breakpointS",
            "breakpointM",
            "breakpointL",
            "breakpointXL",
            "...configured Storybook devices..."
          ]
        },
        "isRotated": {
          "type": "boolean"
        }
      },
      "required": ["value"],
      "additionalProperties": false
    }
  },
  "minProperties": 1,
  "additionalProperties": false
}
```

Execution:

1. stale-capability check
2. schema validation
3. snapshot current effective globals
4. construct PATCH only for requested properties
5. if viewport is specified without "isRotated", merge current orientation
6. "api.updateGlobals(patch)"
7. wait for Storybook globals update
8. read "api.getGlobals()"
9. verify requested values are effective
10. return precise diff

No global-reset tool exists.

---

## 11. STORYBOOK ARGTYPE → JSON SCHEMA COMPILER

This is the technical heart of the project.

The project should be described internally and externally as:

«A compiler from Storybook's live semantic metadata into WebMCP capabilities.»

Input:

- prepared current Storybook story
- current args
- prepared ArgTypes
- current globals

Output:

- writable control descriptors
- WebMCP JSON Schema
- stable capability fingerprint

---

## 12. WHICH ARG TYPES ARE WRITABLE

For each current ArgType, first reject it if ANY of the following are true:

- "control === false"
- "table.disable === true"
- "table.readonly === true"
- Storybook conditional control predicate says it is currently hidden
- type is function
- type is symbol
- control type is file
- value cannot be represented safely through JSON
- compiler cannot determine a bounded safe schema

Use Storybook's own:

"includeConditionalArg"

from its CSF implementation so conditional visibility matches Storybook semantics.

Wrap this helper defensively.

If Storybook considers an invalid conditional configuration erroneous, skip the control rather than crashing the addon.

---

## 13. CONTROL COMPILATION RULES

These rules are exact.

### Boolean

Storybook:

control: "boolean"

or semantic boolean type.

WebMCP:

```
{
  "type": "boolean"
}
```

### Text / string

WebMCP:

```
{
  "type": "string",
  "maxLength": 2000
}
```

2000 characters is the addon safety bound for agent-authored freeform text.

### Color

WebMCP:

```
{
  "type": "string",
  "maxLength": 128
}
```

Do not attempt to validate all CSS color syntax.

### Number

WebMCP:

```
{
  "type": "number"
}
```

Copy finite Storybook:

- "min" → "minimum"
- "max" → "maximum"
- positive finite "step" → "multipleOf"

### Range

Same as number.

MealDrop Review therefore becomes:

```
{
  "type": "number",
  "minimum": 0,
  "maximum": 5,
  "multipleOf": 0.1
}
```

### Single-select controls

Applies to:

- "select"
- "radio"
- "inline-radio"

When "argType.options" contains <= 50 JSON primitives:

```
{
  "enum": [...]
}
```

Also specify the primitive JSON type when all options have one consistent type.

If options mix primitive types, use enum without lying about a single "type".

### Multi-select controls

Applies to:

- "check"
- "inline-check"
- "multi-select"

WebMCP:

```
{
  "type": "array",
  "items": {
    "enum": [...]
  },
  "uniqueItems": true,
  "maxItems": 50
}
```

"options" must contain <= 50 JSON primitives.

Otherwise skip control.

### Mapping

If Storybook has:

```
options: ["Normal", "Bold", "Italic"],
mapping: {
  Bold: <b>Bold</b>,
  Italic: <i>Italic</i>
}
```

WebMCP exposes:

```
{
  "type": "string",
  "enum": ["Normal", "Bold", "Italic"]
}
```

Never expose the mapped JSX/complex value.

Storybook handles the mapping as part of normal arg rendering.

### Date

Storybook date Controls represent changed values as UNIX timestamps.

Expose:

```
{
  "type": "number",
  "description": "Unix timestamp used by Storybook's date control."
}
```

Do not convert it to an ISO string.

### File

NEVER expose.

---

## 14. STRUCTURED TYPES

Support structured semantic SBTypes conservatively.

Maximum recursion depth:

3

Maximum object properties at each level:

30

Maximum array items:

50

### SB array

If child SBType compiles safely:

```
{
  "type": "array",
  "items": CHILD_SCHEMA,
  "maxItems": 50
}
```

Otherwise skip.

### SB object

If every exposed child can be compiled safely:

```
{
  "type": "object",
  "properties": {
    ...
  },
  "additionalProperties": false
}
```

Nested properties whose SBType says "required: true" go into nested "required".

If zero children survive compilation, skip the object.

### SB enum

Primitive enum.

Maximum 50 values.

### SB union

Support only when:

- <= 8 members
- every member compiles safely

Use:

```
{
  "anyOf": [...]
}
```

### SB intersection

Support only when:

- <= 5 members
- every member compiles safely

Use:

```
{
  "allOf": [...]
}
```

### "other"

Skip.

### function

Skip.

### symbol

Skip.

Do not infer arbitrary schema from a random current object merely because the current value happens to be JSON serializable.

A safe semantic type is required for structured object editing.

---

## 15. TOP-LEVEL PATCH SEMANTICS

Important:

A component prop being semantically "required" does NOT make it required in the WebMCP update tool.

The WebMCP update tool performs a PATCH.

Therefore the root schema has:

```
{
  "minProperties": 1,
  "additionalProperties": false
}
```

but NO "required" array for individual controls.

This allows:

```
{
  "rating": 1
}
```

without forcing the model to resend every other current control.

That is how human changes remain untouched.

---

## 16. RUNTIME SCHEMA VALIDATION

Use:

Ajv 2020 / JSON Schema 2020-12

The exact schema exposed to WebMCP must also be used for runtime validation.

Do not trust browser/model-side validation alone.

For every dynamic mutation:

```
agent input
   │
   ▼
same generated JSON Schema
   │
   ▼
Ajv validate
   │
   ├── invalid → INVALID_VALUE
   │
   └── valid → Storybook mutation
```

No duplicate hand-written validation semantics where the schema already expresses the rule.

Additional contextual validation still applies for stale story/capability state.

---

## 17. CAPABILITY HASHING

Dynamic tool names use deterministic schema identities.

Create a canonical structure:

For controls:

```
{
  storyId,
  schema
}
```

For globals:

```
{
  storyId,
  schema
}
```

Canonicalize by recursively sorting object keys.

Then calculate:

"SHA-256(canonicalJSONString)"

Use Web Crypto.

Take the first:

8 lowercase hexadecimal characters

Examples:

```
storybook_update_controls.a81f03c2
storybook_reset_controls.a81f03c2
storybook_update_globals.11e8409a
```

The hash depends on the capability/schema.

It does NOT depend on current control VALUES.

Changing:

rating 1 → 4.3

does not change hash unless that value change affects conditional control availability.

Changing:

Review → Icon

does.

Changing an arg so a conditional control becomes visible also changes the schema and therefore changes hash.

---

## 18. WHY TOOL NAMES ARE VERSIONED

Never rapidly remove and replace a dynamic capability with a new schema under the same machine name.

A browser agent may have observed an old definition.

Versioned names ensure a stale observed capability cannot silently resolve to a different schema.

The human-facing "title" stays stable.

Machine identity changes.

This is intentional WebMCP lifecycle engineering.

---

## 19. STALE-CONTEXT GUARANTEE

Every contextual tool closure stores:

- expected current story ID
- expected capability hash

At execute time, before mutation:

1. read current Storybook story
2. recompute the applicable capability
3. compare story ID
4. compare capability hash

If either differs:

DO NOTHING.

Return:

```
{
  "ok": false,
  "error": {
    "code": "STALE_CONTEXT",
    "message": "The human changed Storybook context after this capability was discovered. Refresh the available tools or inspect the current Storybook context and retry.",
    "retryable": true
  }
}
```

A Review capability must never accidentally mutate Icon.

---

## 20. MUTATION RESULT CONTRACT

Every successful mutation returns evidence.

Never return just:

"Success"

Control update example:

```
{
  "ok": true,
  "action": "update_controls",
  "storyId": "components-review--default",
  "changes": [
    {
      "path": "args.rating",
      "before": 4.3,
      "after": 1
    }
  ],
  "verified": true
}
```

Reset example:

```
{
  "ok": true,
  "action": "reset_controls",
  "storyId": "components-icon--playground",
  "changes": [
    {
      "path": "args.name",
      "before": "star",
      "after": "cart"
    }
  ],
  "verified": true
}
```

Global example:

```
{
  "ok": true,
  "action": "update_globals",
  "storyId": "components-review--default",
  "changes": [
    {
      "path": "globals.theme",
      "before": "light",
      "after": "dark"
    },
    {
      "path": "globals.viewport.value",
      "before": "responsive",
      "after": "mobile1"
    }
  ],
  "verified": true
}
```

Values in result evidence must be sanitized/bounded.

Strings in diffs maximum:

300 characters

Do not return source code or arbitrary deep objects.

---

## 21. STANDARD ERROR CONTRACT

Domain/tool errors return:

```
{
  ok: false,
  error: {
    code: ErrorCode,
    message: string,
    retryable: boolean
  }
}
```

Exact error codes:

```
WEBMCP_UNAVAILABLE
STORYBOOK_NOT_READY
STORY_NOT_FOUND
NO_CURRENT_STORY
INVALID_INPUT
INVALID_VALUE
STALE_CONTEXT
UPDATE_NOT_APPLIED
NAVIGATION_TIMEOUT
UPDATE_TIMEOUT
INTERNAL_ERROR
```

Do not expose stack traces.

"INTERNAL_ERROR" should log the detailed error to the browser console in development, but return only a concise safe message to the agent.

True AbortSignal cancellation should abort/reject the active async wait using an "AbortError".

Do not convert deliberate browser/user cancellation into fake success.

---

## 22. AUTHORITATIVE STATE — NO POLLING

There is ONE authoritative state:

Storybook Manager state.

Do not maintain a second mirror.

Do not run intervals.

Do not poll Storybook.

Do not periodically invoke "getCurrentStoryData".

Instead:

Reads

Read Storybook state when a WebMCP tool executes.

Capability lifecycle

React to Storybook lifecycle events.

Mutation verification

Attach a specific event listener BEFORE making a mutation, await the matching event, then perform one final semantic state read to verify the result.

This is not background polling.

---

## 23. STORYBOOK API ADAPTER

All direct Storybook interaction belongs in ONE module:

"storybook-adapter.ts"

It wraps current Storybook Manager API methods.

Required adapter methods:

```
getCurrentStory()
getStoryIndex()
findStory(id)
selectStory(id, signal)
getArgs()
getArgTypes()
updateArgs(patch, signal)
resetArgs(names?, signal)

getGlobals()
getUserGlobals()
getStoryGlobals()
getGlobalTypes()
updateGlobals(patch, signal)

getViewportConfiguration()
subscribeToLifecycle(listener)
```

Use current Storybook Manager APIs including:

- "getCurrentStoryData"
- "getIndex"
- "getData"
- "selectStory"
- "updateStoryArgs"
- "resetStoryArgs"
- "getGlobals"
- "getUserGlobals"
- "getStoryGlobals"
- "getGlobalTypes"
- "updateGlobals"

Do not spread Storybook internal imports across the codebase.

Any imports from:

"storybook/internal/*"

must exist only in the adapter/lifecycle boundary.

---

## 24. PERSISTENT MANAGER RUNTIME

Core WebMCP runtime is initialized directly from Storybook addon registration.

Conceptually:

```
addons.register(ADDON_ID, api => {
  startWebMCPService(api)
  registerPanel(api)
})
```

Do NOT make WebMCP registration depend on:

- panel being visible
- panel React component mounting
- a hook
- user clicking the WebMCP panel

The service lifetime is the Storybook Manager lifetime.

The panel merely observes it.

---

## 25. SESSION REGISTRATION

Create:

```
sessionController = new AbortController()
```

Register stable tools with:

```
{ signal: sessionController.signal }
```

Stable tools:

```
storybook_get_context
storybook_find_stories
storybook_open_story
```

Session controller remains alive for Manager lifetime.

---

## 26. DYNAMIC REGISTRATION

Maintain:

```
dynamicController: AbortController | null
dynamicSnapshot: CapabilitySnapshot | null
```

When actual capability schema changes:

1. compute NEW snapshot
2. compare fingerprints against current
3. if identical, do nothing
4. if changed:
   - abort previous "dynamicController"
   - create new AbortController
   - register relevant contextual tools
   - update diagnostic state

Contextual registrations use:

```
{
  signal: dynamicController.signal
}
```

Aborting the registration is the sole canonical unregister mechanism.

---

## 27. STORYBOOK EVENTS THAT TRIGGER RE-EVALUATION

Subscribe to the Storybook events required to observe:

- story changes
- story preparation
- story args updates
- global updates

Exact behavior:

### Story changed

Immediately abort contextual capabilities.

The transition state should have no old contextual tools.

Then wait for current story preparation.

### Story prepared

Recompute complete contextual capability snapshot.

Register new tools.

### Args updated

Recompute snapshot.

Usually hash remains identical.

If identical:

NO REGISTRATION CHANGE.

If conditional "argTypes.if" causes the actual writable control set/schema to change:

refresh contextual capabilities.

### Globals updated

Recompute snapshot.

Usually no schema change.

If:

- an "argTypes.if" conditional changes,
- viewport/global availability genuinely changes,

refresh contextual capabilities.

Otherwise:

NO registration change.

This gives us the precise invariant:

«State changes do not cause capability churn unless they actually change what can be done.»

---

## 28. WEBMCP "toolchange"

Listen to:

"document.modelContext" "toolchange"

only for diagnostics.

Do not use "toolchange" to drive correctness.

Our own registry is authoritative for our own registrations.

The diagnostic panel may display:

Tool surface changed · 11:42:03

and increment a counter.

---

## 29. GLOBAL LOCKING

Storybook permits a story/meta to override a global.

When that happens, Storybook disables human toolbar control for that global.

Our agent must respect the same boundary.

Read:

"api.getStoryGlobals()"

If it owns a global key:

do not expose that global as writable.

This applies to:

- theme
- viewport
- any custom toolbar global

Human and agent receive equivalent capability boundaries.

---

## 30. VIEWPORT DETAILS

Read current story's effective:

"parameters.viewport"

Respect:

viewport.disable

Read:

viewport.options

Each option may contain:

```
{
  name,
  styles: {
    width,
    height
  },
  type
}
```

Expose those details in "storybook_get_context".

The mutation itself only needs:

```
{
  value,
  isRotated?
}
```

Do not allow arbitrary width/height from the model.

The model selects one of the site's configured viewport capabilities.

This is intentionally semantic and bounded.

---

## 31. MEALDROP DEMO CONFIGURATION

MealDrop currently contains traditional Storybook MCP configuration.

For the challenge demo:

REMOVE:

@storybook/addon-mcp

from MealDrop's ".storybook/main.ts" addon list.

Do not uninstall it if doing so causes unnecessary dependency churn.

Just do not load it.

ADD:

our local:

"storybook-addon-webmcp"

No traditional MCP server should start when judges load our Storybook.

The demo should visually and architecturally communicate one thing:

WebMCP.

---

## 32. REPOSITORY STRUCTURE

Work in the MealDrop fork for speed.

Add:

```
packages/
  storybook-addon-webmcp/
    package.json
    LICENSE
    README.md
    tsconfig.json
    tsup.config.ts

    src/
      manager.tsx
      preset.ts

      core/
        types.ts
        constants.ts
        json.ts
        canonicalize.ts
        hash.ts
        errors.ts
        result.ts

      storybook/
        storybook-adapter.ts
        lifecycle.ts
        control-compiler.ts
        global-compiler.ts
        conditional.ts

      webmcp/
        webmcp-types.ts
        registry.ts
        service.ts

        tools/
          get-context.ts
          find-stories.ts
          open-story.ts
          update-controls.ts
          reset-controls.ts
          update-globals.ts

      panel/
        Panel.tsx
        panel-store.ts
        components.tsx

    tests/
      control-compiler.test.ts
      global-compiler.test.ts
      hashing.test.ts
      registry.test.ts
      stale-context.test.ts
      tools.test.ts
      lifecycle.test.ts

    docs/
      ARCHITECTURE.md
      WEBMCP.md
      SECURITY.md
      EVALS.md
      CHALLENGE.md

    evals/
      cases.md
      results.md
```

The addon package itself must contain ZERO imports from MealDrop source.

No:

../../src/components

No MealDrop story IDs.

No MealDrop theme names.

No MealDrop icon names.

The addon works because MealDrop is Storybook.

---

## 33. ADDON PACKAGING

Storybook 10 is ESM-only.

Build the addon ESM-only.

Peer dependency:

```
{
  "storybook": "^10.0.0"
}
```

Develop/test against MealDrop's installed Storybook 10.5.x.

Use Storybook Addon Kit conventions.

Export Manager/preset entry correctly so a normal consumer can eventually use:

```
addons: ['storybook-addon-webmcp']
```

No Preview entry is required for product behavior.

Core implementation is Manager-only.

Use:

- TypeScript
- strict mode
- tsup / Storybook Addon Kit conventions
- Ajv 2020
- WebMCP DOM types package where appropriate

Do not introduce a framework backend.

---

## 34. DIAGNOSTIC STORYBOOK PANEL

Register exactly one Storybook addon panel:

WebMCP

The panel is read-only.

It does NOT duplicate Storybook Controls.

Contents:

### Status

One of:

● WebMCP active

or:

○ WebMCP unavailable in this browser

### Current context

Components/Review · Default

### Tool surface

Show currently active tools by human title and machine name.

Example:

```
Inspect current Storybook context
Find Storybook stories
Open a Storybook story
Update current Storybook controls · a81f03c2
Reset current Storybook controls · a81f03c2
Update Storybook global controls · 11e8409a
```

### Compiler state

```
Controls
1 editable · schema a81f03c2

Globals
2 editable · schema 11e8409a
```

### Tool changes

```
3 capability changes this session
last: 11:42:03
```

### Recent calls

Last 5 WebMCP executions:

```
✓ Update controls
  rating 4.3 → 1

✓ Update globals
  theme light → dark
  viewport responsive → mobile1
```

Do not retain more than 5.

No sensitive/full payload logging.

### Suggested prompts

Show:

What am I looking at?

Make this a one-star review.

Keep my rating, but show this in dark mode on a phone.

Find and open the checkout flow.

Panel styling should use Storybook-native components/tokens where practical.

Do not build elaborate custom branding.

---

## 35. PROGRESSIVE ENHANCEMENT

Check:

```
typeof document.modelContext?.registerTool === "function"
```

If false:

- do not register tools
- Storybook continues normally
- panel shows unsupported status
- no repeated warnings
- no exceptions
- Controls still work
- stories still render

The addon must never make ordinary Storybook depend on WebMCP support.

---

## 36. SECURITY RULES

Absolutely prohibit:

- arbitrary JavaScript evaluation
- arbitrary expressions
- arbitrary Storybook event names
- arbitrary DOM selectors
- arbitrary URLs
- arbitrary manager method invocation
- source file access
- environment variables
- Redux store dumping
- localStorage dumping
- cookies
- secrets
- arbitrary globals
- non-serializable args
- model-controlled property names outside schemas

Every mutation is restricted to a capability Storybook itself semantically exposes.

---

## 37. UNTRUSTED CONTENT

Set:

```
untrustedContentHint: true
```

on all six conceptual tools.

Reason:

Even read/mutation results can contain application-authored:

- story names
- component names
- descriptions
- arg values
- labels

These are not trusted instructions to the agent.

Do NOT put arbitrary application content into trusted static tool descriptions.

Tool descriptions remain authored by us.

---

## 38. RESULT BOUNDS

Hard bounds:

- story search results: 20
- enum/options values: 50
- viewport options: 50
- context descriptions: 240 chars
- context string control values: 500 chars
- mutation evidence string values: 300 chars
- recent panel executions: 5
- recursive object depth: 3
- object properties per level: 30
- arrays: 50

Never return:

- entire Storybook index
- source files
- arbitrary DOM
- huge state objects

---

## 39. VERIFICATION WAITS

Mutation/navigation helpers are event-driven and abort-aware.

Timeouts:

Arg mutation/reset

1500 ms

Globals

1500 ms

Navigation/preparation

3000 ms

Pattern:

```
attach event listener
        ↓
perform Storybook API operation
        ↓
await matching event OR timeout/abort
        ↓
read authoritative API state once
        ↓
verify
```

If event is missed but the final state already equals the requested state, treat operation as verified success.

Do not retry blindly.

---

## 40. TESTS — REQUIRED

Unit tests must cover all of these.

### Control compiler

- boolean
- string
- color
- date
- number
- range
- min
- max
- step
- select
- radio
- inline-radio
- check
- inline-check
- multi-select
- mapping
- SB arrays
- SB objects
- union
- intersection
- unsupported function
- unsupported symbol
- unsupported file
- unsupported other
- object depth limit
- option limit
- string bound

### Storybook visibility

- "control: false" excluded
- "table.disable" excluded
- "table.readonly" excluded
- conditional hidden arg excluded
- conditional visible arg included

### Capability identity

- changing rating value alone DOES NOT change hash
- changing story DOES
- changing enum options DOES
- conditional control appearing DOES
- conditional control disappearing DOES

### Runtime validation

- extra property rejected
- invalid enum rejected
- rating 9 rejected for Review
- valid rating accepted
- empty update object rejected
- valid partial update accepted

### Stale state

- old Review update closure cannot edit Icon
- old hash returns "STALE_CONTEXT"

### Globals

- finite toolbar global exposed
- unbounded global omitted
- story-locked global omitted
- viewport-disabled story omits viewport
- viewport options compile
- orientation preserved if omitted

### Lifecycle

- stable tools register once
- dynamic controller abort removes stale tools
- ordinary value update with unchanged schema does not churn registrations
- true conditional capability change does
- story navigation removes old tools before new preparation

### Abort

- navigation wait aborts
- mutation wait aborts
- globals wait aborts

### Progressive enhancement

- missing "document.modelContext" causes no crash

---

## 41. MEALDROP INTEGRATION TESTS

Use real MealDrop data for end-to-end assertions.

### Review

Expected:

"Components/Review"

Rating capability:

number
minimum 0
maximum 5
step/multipleOf 0.1

Agent update:

```
{
  "rating": 1
}
```

must visibly update Storybook.

### Icon Playground

Expected Icon name enum contains:

```
arrow-right
arrow-left
cross
cart
minus
plus
moon
sun
star
```

"star" succeeds.

An unknown value fails.

### Theme

MealDrop theme global should expose:

light
dark
side-by-side

because those values are actually defined in its "globalTypes".

### Viewport

MealDrop's configured breakpoint and built-in viewport options should be discoverable dynamically.

No viewport ID is hard-coded into addon logic.

### UserFlows

Searching:

checkout

or:

user flow

must find useful UserFlows/App stories.

Opening the checkout flow must navigate there and allow Storybook's play function to run normally.

---

## 42. BROWSER EVALS

Create reproducible evals.

Do not invent scores.

Record actual results only.

### Eval 1 — context

Start:

Review / Default.

Prompt:

«What am I looking at?»

Expected primary tool:

"storybook_get_context"

Success:

Agent accurately identifies Review and rating control.

### Eval 2 — constrained mutation

Prompt:

«Make this a one-star review.»

Expected:

dynamic update-controls tool.

Expected input approximately:

```
{
  "rating": 1
}
```

Success:

- Preview changes
- Storybook Control changes
- result says verified

### Eval 3 — invalid bound

Prompt:

«Set the rating to 9.»

Expected:

Preferred outcome:
agent respects schema and does not submit invalid value.

If tool is invoked anyway:
runtime validator returns "INVALID_VALUE".

Storybook must NEVER end at rating 9.

### Eval 4 — human/agent shared state

Human manually changes rating to:

"4.3"

Then prompt:

«Keep the rating I just chose, but show this in dark mode on a phone.»

Expected:

- agent uses globals capability
- rating remains 4.3
- theme becomes dark
- viewport becomes an appropriate configured mobile viewport
- no control update tool is required

This is the single most important product eval.

### Eval 5 — dynamic capability

Human manually navigates:

Review → Icon Playground

Expected:

- Review dynamic tools disappear
- Icon dynamic tools appear
- controls hash changes
- toolchange occurs diagnostically

Prompt:

«Make this a star.»

Expected:

dynamic Icon update tool.

Input:

```
{
  "name": "star"
}
```

Success:

Icon visibly changes.

### Eval 6 — stale protection

Discover Review update capability.

Human navigates to Icon before invoking stale capability.

Invoke old capability in controlled diagnostic test.

Expected:

"STALE_CONTEXT"

Icon is untouched.

### Eval 7 — navigation

Prompt:

«Find and open the checkout flow.»

Expected chain:

1. "storybook_find_stories"
2. "storybook_open_story"

Success:

Storybook visibly navigates to UserFlows checkout story.

Its play sequence starts naturally as part of Storybook rendering.

### Eval 8 — reset

On Icon Playground after changing icon:

Prompt:

«Reset this component.»

Expected:

dynamic reset-controls tool.

Success:

current editable controls return to story initial args.

---

## 43. CHROME DEVTOOLS VALIDATION

Use Chrome's WebMCP Application/DevTools pane where available.

Inspect:

- available tool names
- exact schemas
- annotations
- invocation history
- completed/canceled/error states

Manually invoke each tool at least once.

Verify:

- no duplicate-name errors
- schemas update after story navigation
- old dynamic tools disappear
- new dynamic tools appear
- ordinary rating value change does not cause pointless tool churn

Capture screenshots suitable for README/submission if useful.

---

## 44. CHATGPT VALIDATION

Core judge path must use imperative, TOP-LEVEL WebMCP tools.

Verify with a currently supported ChatGPT site-tools environment.

Do not accept:

"works through normal browser clicking"

as proof.

Verify actual WebMCP tool invocation.

The golden path must use the registered tools.

---

## 45. DEMO VIDEO — EXACT STORY

Target:

~2 minutes

Maximum challenge limit must not be approached unnecessarily.

### 0:00–0:12 — thesis

Show MealDrop Storybook immediately.

Say:

«Storybook is already a shared workbench for frontend teams. Storybook WebMCP lets a browser agent work inside the exact Storybook session you're using now.»

Briefly show WebMCP panel active.

### 0:12–0:30 — semantic context

Review / Default open.

Ask:

«What am I looking at?»

Agent uses context.

Show panel/schema:

rating: number 0–5

Say:

«The agent isn't reading the Controls DOM. The addon compiles Storybook's own ArgTypes into WebMCP.»

### 0:30–0:45 — agent mutation

Ask:

«Make this a one-star review.»

Agent calls update tool.

Show simultaneously:

- Preview
- Storybook rating Control
- WebMCP verified diff

### 0:45–1:08 — THE human-agent moment

Manually drag rating to 4.3.

Visibly emphasize that this is a human Control interaction.

Ask:

«Keep the rating I just chose, but show this in dark mode on a phone.»

Agent updates global capability.

Show:

- rating still 4.3
- dark theme
- mobile viewport

Say:

«There's no sync service. Human and agent are manipulating the same authoritative Storybook state.»

### 1:08–1:30 — dynamic tools

Manually click:

Icon / Playground.

Show WebMCP panel:

controls schema changed

Old Review capability disappears.

New schema shows Icon options.

Ask:

«Make this a star.»

Agent changes icon.

Say:

«Changing state doesn't churn tools. Changing what the human can actually do changes the WebMCP capability itself.»

### 1:30–1:48 — app-level proof

Ask:

«Find and open the checkout flow.»

Agent searches and opens UserFlows/App.

Storybook play sequence runs.

Show real application flow.

### 1:48–2:05 — technical proof

Quickly show code snippets/screens:

- "document.modelContext.registerTool"
- generated JSON Schema
- registration AbortSignal
- stale-context check
- verified mutation diff

Say:

«Six focused tools. No backend, no DOM automation, and no separate MCP server.»

### 2:05–2:12 — close

«Your agent shouldn't have its own Storybook. It should work in yours.»

End.

---

## 46. README STRUCTURE

README must use this order.

Storybook WebMCP

Tagline.

Short GIF/video.

What it does

One paragraph.

Why WebMCP

Explain shared live Storybook state.

Demo

Golden flow.

Install

Future-facing one-line addon installation.

How it works

Architecture diagram.

Storybook → WebMCP compiler

Show Review schema and Icon schema.

Six tools

Table with exact six capabilities.

Human + agent collaboration

Explain authoritative state.

Dynamic capability lifecycle

Explain:

- values normally don't change schemas
- story/conditional capability changes do
- versioned tool names
- stale-context protection

Security

Bounded capability surface.

Evals

Actual results only.

Browser support

Accurate current support.

Development

Commands.

Hackathon work

Clearly distinguish preexisting MealDrop/Storybook from our addon.

License

Addon MIT.

Do not write a giant comparison to traditional Storybook MCP.

At most:

«Storybook also supports traditional MCP integrations for coding-agent workflows. Storybook WebMCP is intentionally a separate live-browser integration and does not depend on an MCP server.»

One sentence.

---

## 47. ARCHITECTURE DOC

"docs/ARCHITECTURE.md"

Must explain:

```
Storybook metadata
       │
       ▼
safe semantic compiler
       │
       ├── control schema
       └── global schema
       │
       ▼
versioned contextual capabilities
       │
       ▼
WebMCP
```

Include:

- Manager vs Preview
- why Manager owns registration
- authoritative state
- lifecycle
- conditional controls
- versioning
- stale protection
- result verification

---

## 48. SECURITY DOC

"docs/SECURITY.md"

Threats/mitigations:

- prompt injection through story metadata
- arbitrary agent values
- stale capabilities
- unexpected story navigation
- non-serializable values
- huge outputs
- arbitrary Storybook internals
- locked globals
- unsupported browser

Explicitly say:

WebMCP annotations are hints, not authorization.

Storybook semantics and our input validation remain authoritative.

---

## 49. WEBMCP DOC

"docs/WEBMCP.md"

Accurately state what we use:

```
registerTool
JSON Schema
dynamic registration
registration AbortSignal
execute AbortSignal
readOnlyHint
untrustedContentHint
toolchange
```

Explicitly state what we do NOT emulate:

```
MCP Resources
Prompts
Sampling
Channels
MCP transport
```

Explain that WebMCP is a frontend/browser capability system rather than a JavaScript transport for traditional MCP.

---

## 50. COMPETITION-LEVEL ENGINEERING BAR

Other strong challenge entries already demonstrate:

- small intentional tool sets
- bounded responses
- stale-operation protection
- AbortSignals
- structured verification
- explicit evals

We must meet or exceed that engineering discipline.

Our differentiator is not merely polish.

It is:

1. Automatic semantic capability compilation

Storybook metadata creates WebMCP schemas.

2. Dynamic capability topology

The available agent interface changes with the human's current Storybook context.

3. Genuine shared state

Human edits are naturally inherited by subsequent agent actions.

4. Generic product

One addon potentially makes any Storybook agent-native.

5. Browser-native architecture

No separate integration server is required.

---

## 51. WHAT WE ARE EXPLICITLY NOT DOING

Do not reconsider these.

NO:

- traditional MCP integration
- Storybook MCP proxy
- MCP client
- MCP server
- Claude Channels
- WebMCP Resources emulation
- polling
- shadow state
- backend
- LLM API
- chat interface
- source code editor
- component source mutation
- story generation
- test generation
- explicit play-function runner
- arbitrary DOM tool
- arbitrary Storybook API tool
- iframe WebMCP
- cross-origin demo
- declarative WebMCP demo
- generic arbitrary globals
- one tool per component prop
- huge context endpoint
- custom fake application
- custom marketing site before submission

This scope is CLOSED.

---

## 52. PRIORITY IS NOT A FEATURE QUESTION

All specified features above are part of the product.

Implementation order is simply:

1. addon shell
2. Storybook adapter
3. stable WebMCP tools
4. control compiler
5. dynamic registry
6. update/reset controls
7. globals compiler
8. globals update
9. stale protection
10. verification/cancellation
11. panel
12. tests
13. MealDrop integration
14. browser evals
15. docs
16. deployment
17. demo/submission material

Do not omit a specified feature because another idea feels more interesting.

---

## 53. FINAL ACCEPTANCE TEST

The project is complete only when ALL are true.

### Product

- [ ] MealDrop Storybook runs.
- [ ] Traditional MCP addon is disabled in demo.
- [ ] Storybook WebMCP addon loads.
- [ ] Storybook works in browsers without WebMCP.
- [ ] WebMCP panel works independently of panel visibility.

### Stable tools

- [ ] "storybook_get_context"
- [ ] "storybook_find_stories"
- [ ] "storybook_open_story"

### Contextual tools

- [ ] versioned update-controls
- [ ] versioned reset-controls
- [ ] versioned update-globals when applicable

### Compiler

- [ ] Review rating schema is 0–5, step 0.1.
- [ ] Icon enum is correctly generated.
- [ ] unsafe controls are excluded.
- [ ] conditional controls match Storybook.
- [ ] mappings expose serializable options.
- [ ] no arbitrary props accepted.

### Lifecycle

- [ ] ordinary value updates do not cause tool churn.
- [ ] conditional capability changes do.
- [ ] story navigation removes old capabilities.
- [ ] new story gets new schema.
- [ ] registration AbortSignal actually unregisters.
- [ ] "toolchange" visible diagnostically.

### Concurrency

- [ ] old Review capability cannot edit Icon.
- [ ] stale invocation gives "STALE_CONTEXT".
- [ ] human modifications are preserved by unrelated agent actions.

### Globals

- [ ] MealDrop theme discovered dynamically.
- [ ] viewport discovered dynamically.
- [ ] story-locked globals omitted.
- [ ] dark + mobile update works in one tool call.
- [ ] rating remains unchanged during global update.

### Verification

- [ ] mutation responses contain before/after evidence.
- [ ] navigation verified.
- [ ] updates verified.
- [ ] timeouts are bounded.
- [ ] AbortSignals work.

### Safety

- [ ] no arbitrary JS.
- [ ] no arbitrary DOM selectors.
- [ ] no arbitrary URLs.
- [ ] no arbitrary Storybook method.
- [ ] no source/secrets/state dump.
- [ ] all model input runtime validated.
- [ ] untrusted-content annotations set.
- [ ] read-only annotations accurate.

### Tests

- [ ] unit tests pass.
- [ ] lifecycle tests pass.
- [ ] stale-context tests pass.
- [ ] MealDrop integration tests pass.
- [ ] invalid rating cannot enter Storybook.

### Real browser

- [ ] Chrome WebMCP pane sees correct tools.
- [ ] ChatGPT-compatible browser sees TOP-LEVEL tools.
- [ ] Review demo works.
- [ ] human state preservation demo works.
- [ ] Icon capability-change demo works.
- [ ] checkout navigation works.

### Build

- [ ] TypeScript passes.
- [ ] lint passes.
- [ ] addon build passes.
- [ ] MealDrop Storybook production build passes.
- [ ] static production build still registers tools.
- [ ] HTTPS deployment works.

### Submission

- [ ] README complete.
- [ ] architecture doc complete.
- [ ] security doc complete.
- [ ] eval doc contains only real results.
- [ ] challenge doc complete.
- [ ] public code available.
- [ ] addon license visible.
- [ ] live demo available.
- [ ] video under 3 minutes.
- [ ] Devpost description ready.

---

## 54. FINAL VALIDATION PASS

Before stopping:

Run all package installation/build checks.

Run:

- lint
- typecheck
- unit tests
- Storybook build
- production static serve
- browser smoke tests

Inspect Chrome WebMCP DevTools.

Inspect actual registered schemas.

Test every one of the six conceptual tools manually.

Run all eight agent eval scenarios that are possible in the available browser environment.

Search repo for:

```
TODO
FIXME
console.log
debugger
localhost
hardcoded MealDrop IDs in addon
@storybook/addon-mcp usage in demo config
```

Fix inappropriate leftovers.

Inspect git diff.

Make sure no generated build artifacts or secrets are accidentally committed.

Create clean meaningful commits.

Then prepare:

- final README
- final screenshots
- final demo script
- Devpost submission copy

Do not conclude by suggesting additional features.

Do not redesign the project.

Finish this implementation exactly as specified.

Build it.
