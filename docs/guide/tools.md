# Tools


| Tool                             | Lifetime   | Purpose                                                                                 |
| -------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| storybook_get_context            | Stable     | Read the current story, bounded controls, globals, viewport, and capability identities. |
| storybook_find_stories           | Stable     | Search actual Storybook story-index entries by ID, title, component, or name.           |
| storybook_open_story             | Stable     | Navigate to an exact indexed story and verify the landing story.                        |
| storybook_update_controls.&lt;hash&gt; | Contextual | PATCH the current story's compiled editable controls.                                   |
| storybook_reset_controls.&lt;hash&gt;  | Contextual | Reset all or selected currently editable controls.                                      |
| storybook_update_globals.&lt;hash&gt;  | Contextual | PATCH safe toolbar globals and configured viewport state.                               |

All six tools use untrustedContentHint: true; read-only annotations match their behavior. The contextual names contain an eight-character SHA-256 identity of { storyId, schema }, so an observed old capability can never silently point at a new schema.
