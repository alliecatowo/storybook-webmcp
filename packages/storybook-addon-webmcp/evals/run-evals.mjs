/**
 * Runs the eight eval scenarios from the spec against a real Storybook build.
 *
 * Everything here is measured, never asserted-by-hope: each case reports the
 * actual tool names the addon registered, the actual schema it published, and
 * the actual Storybook state afterwards. Results are written as JSON for
 * evals/results.md to quote verbatim.
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const POLYFILL = readFileSync(join(HERE, 'webmcp-polyfill.js'), 'utf8')
const BASE = process.env.STORYBOOK_URL ?? 'http://127.0.0.1:6006'
const RESULTS_PATH = process.env.EVAL_RESULTS_PATH ?? join(HERE, 'results.json')
const VIDEO_DIR = process.env.EVAL_VIDEO_DIR
const RECORDING = Boolean(VIDEO_DIR)
const PANEL_QUERY = RECORDING ? '&panel=storybook%2Fwebmcp%2Fpanel' : ''

const REVIEW = 'components-review--default'
const ICON = 'components-icon--playground'

const results = []
const record = (name, status, detail) => {
  results.push({ name, status, detail })
  console.log(`${status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'INFO'}  ${name}`)
  if (detail !== undefined) console.log(`      ${JSON.stringify(detail)}`)
}

const page = await (async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext(
    VIDEO_DIR ? { recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 1000 } } } : undefined
  )
  await context.addInitScript(POLYFILL)
  const browserPage = await context.newPage()
  browserPage.on('pageerror', (e) => console.error('PAGE ERROR', e.message))
  globalThis.__browser = browser
  globalThis.__recordingContext = context
  return browserPage
})()

/** Keep the optional recording legible without slowing the normal assertions. */
const visualPause = (ms = 700) => (RECORDING ? page.waitForTimeout(ms) : Promise.resolve())

/** Storybook registers tools only once the manager has booted and a story is prepared. */
const waitForDynamicTools = () =>
  page.waitForFunction(
    () =>
      document.modelContext
        ?.getTools()
        .some((t) => t.name.startsWith('storybook_update_controls.')),
    undefined,
    { timeout: 30_000 }
  )

const openWebMCPPanel = async () => {
  const tab = page.locator('[role="tab"][data-key="storybook/webmcp/panel"]')
  if (await tab.count()) {
    await tab.click({ force: true })
    await page.waitForTimeout(RECORDING ? 700 : 250)
  }
}

/**
 * Client-side navigation, the way a human clicking the sidebar navigates: the
 * Manager stays loaded and the page is never reloaded. A full page load would
 * reset `document.modelContext` and destroy any capability an agent had already
 * observed, which is exactly the state the stale-context eval needs to exercise.
 */
const navigateInApp = async (storyId) => {
  await page.evaluate(
    ([id, panelQuery]) => {
      window.history.pushState({}, '', `?path=/story/${id}${panelQuery}`)
      window.dispatchEvent(new PopStateEvent('popstate'))
    },
    [storyId, PANEL_QUERY]
  )
  await page.waitForFunction(
    (id) =>
      document.modelContext
        ?.getTools()
        .some((t) => t.name.startsWith('storybook_update_controls.')) &&
      window.location.search.includes(id),
    storyId,
    { timeout: 30_000 }
  )
  await openWebMCPPanel()
  await page.waitForTimeout(RECORDING ? 1200 : 800)
}

const gotoStory = async (storyId) => {
  await page.goto(`${BASE}/?path=/story/${storyId}${PANEL_QUERY}`, {
    waitUntil: 'domcontentloaded',
  })
  await waitForDynamicTools()
  await openWebMCPPanel()
  await page.waitForTimeout(RECORDING ? 1400 : 500)
}

const tools = () => page.evaluate(() => document.modelContext.getTools())
const call = (name, input) =>
  page.evaluate(
    ([n, i]) => document.modelContext.executeTool(n, i).catch((e) => ({ threw: String(e) })),
    [name, input ?? {}]
  )
const named = async (prefix) => (await tools()).find((t) => t.name.startsWith(prefix))
const toolChanges = () => page.evaluate(() => window.__webmcpToolChanges)

// --- Eval 1: context -------------------------------------------------------
await gotoStory(REVIEW)
{
  const ctx = await call('storybook_get_context')
  const rating = ctx?.controls?.editable?.find((c) => c.name === 'rating')
  await visualPause()
  record('eval-1-context', ctx?.ok && ctx.story?.id === REVIEW && rating ? 'pass' : 'fail', {
    story: ctx?.story,
    rating,
    skipped: ctx?.controls?.skippedCount,
  })
}

// --- Eval 2: constrained mutation -----------------------------------------
{
  const tool = await named('storybook_update_controls.')
  const schema = tool?.inputSchema?.properties?.rating
  const res = await call(tool.name, { rating: 1 })
  await visualPause(900)
  record('eval-2-update-controls', res?.ok && res.verified ? 'pass' : 'fail', {
    tool: tool?.name,
    schema,
    result: res,
  })
}

// --- Eval 3: invalid bound -------------------------------------------------
{
  const tool = await named('storybook_update_controls.')
  const res = await call(tool.name, { rating: 9 })
  const ctx = await call('storybook_get_context')
  await visualPause(600)
  record(
    'eval-3-invalid-bound',
    res?.ok === false && res.error.code === 'INVALID_VALUE' && ctx.controls.values.rating !== 9
      ? 'pass'
      : 'fail',
    { rejected: res?.error, ratingAfter: ctx?.controls?.values?.rating }
  )
}

// --- Eval 4: human/agent shared state (THE product eval) -------------------
{
  // Stand in for the human dragging the slider: Storybook's own manager channel,
  // which is exactly what the Controls panel uses.
  await page.evaluate((id) => {
    const api = window.__STORYBOOK_ADDONS_MANAGER
    const channel = api.getChannel()
    channel.emit('updateStoryArgs', { storyId: id, updatedArgs: { rating: 4.3 } })
  }, REVIEW)
  await page.waitForTimeout(800)

  const before = await call('storybook_get_context')
  const globalsTool = await named('storybook_update_globals.')
  const viewportEnum = globalsTool?.inputSchema?.properties?.viewport?.properties?.value?.enum ?? []
  const mobile = viewportEnum.find((v) => /mobile|iphone|galaxy|pixel/i.test(v)) ?? viewportEnum[1]
  const themeEnum = globalsTool?.inputSchema?.properties?.theme?.enum ?? []
  const dark = themeEnum.find((v) => /dark/i.test(v))

  const res = await call(globalsTool.name, { theme: dark, viewport: { value: mobile } })
  const after = await call('storybook_get_context')
  await visualPause(1100)

  record('eval-4-shared-state', res?.ok && after.controls.values.rating === 4.3 ? 'pass' : 'fail', {
    humanRatingBefore: before?.controls?.values?.rating,
    ratingAfterGlobalsUpdate: after?.controls?.values?.rating,
    changes: res?.changes,
    themeEnum,
    chosenViewport: mobile,
  })
}

// --- Eval 5: dynamic capability -------------------------------------------
{
  const reviewControls = await named('storybook_update_controls.')
  // Capture the live capability closure while it is still registered, so the
  // stale check is exercised after the human navigates away.
  await page.evaluate((name) => {
    const descriptor = document.modelContext.__descriptor(name)
    window.__staleExecute = (input) => descriptor.execute(input, {})
  }, reviewControls.name)
  const changesBefore = await toolChanges()
  await navigateInApp(ICON)
  const iconControls = await named('storybook_update_controls.')
  const nameEnum = iconControls?.inputSchema?.properties?.name?.enum
  const res = await call(iconControls.name, { name: 'star' })
  const ctx = await call('storybook_get_context')
  await visualPause(1000)

  record(
    'eval-5-dynamic-capability',
    reviewControls.name !== iconControls.name && res?.ok && ctx.controls.values.name === 'star'
      ? 'pass'
      : 'fail',
    {
      reviewTool: reviewControls.name,
      iconTool: iconControls.name,
      hashChanged: reviewControls.name !== iconControls.name,
      nameEnum,
      toolChangeEvents: (await toolChanges()) - changesBefore,
      result: res,
    }
  )

  // --- Eval 6: stale protection (diagnostic invocation of the old capability)
  // The registration AbortSignal has already removed the Review tool by now, so
  // executeTool alone would only prove deregistration. To exercise the
  // stale-context guard itself we invoke the captured closure directly, exactly
  // as an agent holding a previously-observed capability would.
  const stale = await page.evaluate(
    (name) =>
      (window.__staleExecute
        ? window.__staleExecute({ rating: 1 })
        : Promise.resolve({ missing: name })
      ).catch((e) => ({ threw: String(e) })),
    reviewControls.name
  )
  const ctxAfter = await call('storybook_get_context')
  record(
    'eval-6-stale-context',
    (stale?.threw || stale?.error?.code === 'STALE_CONTEXT') &&
      ctxAfter.story.id === ICON &&
      ctxAfter.controls.values.name === 'star'
      ? 'pass'
      : 'fail',
    { staleInvocation: stale, iconUntouched: ctxAfter?.controls?.values }
  )

  // --- Eval 8: reset -------------------------------------------------------
  const resetTool = await named('storybook_reset_controls.')
  const reset = await call(resetTool.name, {})
  const ctxReset = await call('storybook_get_context')
  await visualPause(900)
  record('eval-8-reset', reset?.ok && ctxReset.controls.values.name !== 'star' ? 'pass' : 'fail', {
    tool: resetTool?.name,
    result: reset,
    valuesAfter: ctxReset?.controls?.values,
  })
}

// --- Eval 7: navigation ----------------------------------------------------
{
  const found = await call('storybook_find_stories', { query: 'checkout' })
  // Prefer the UserFlows checkout story: Pages/Checkout stories prove search,
  // while UserFlows/App proves that opening a story lets Storybook run its own
  // play function naturally as part of rendering.
  const target =
    found?.matches?.find((match) => match.id.startsWith('userflows-app--')) ?? found?.matches?.[0]
  const opened = target ? await call('storybook_open_story', { storyId: target.id }) : null
  await page.waitForTimeout(RECORDING ? 1800 : 1500)
  const ctx = await call('storybook_get_context')
  record(
    'eval-7-navigation',
    opened?.ok && opened.verified && ctx.story?.id === target.id ? 'pass' : 'fail',
    { matches: found?.matches, opened, landedOn: ctx?.story }
  )
}

// --- Churn check: an ordinary value change must not re-register tools ------
{
  await gotoStory(REVIEW)
  const before = await toolChanges()
  const tool = await named('storybook_update_controls.')
  await call(tool.name, { rating: 2 })
  await page.waitForTimeout(800)
  const after = await toolChanges()
  const still = await named('storybook_update_controls.')
  record('churn-value-change-does-not-rechurn', still.name === tool.name ? 'pass' : 'fail', {
    toolName: tool.name,
    unchanged: still.name === tool.name,
    toolChangeEventsDuringValueChange: after - before,
  })
}

// --- Progressive enhancement: no WebMCP, Storybook still works -------------
{
  const ctx2 = await (await globalThis.__browser.newContext()).newPage()
  const errors = []
  ctx2.on('pageerror', (e) => errors.push(e.message))
  await ctx2.goto(`${BASE}/?path=/story/${REVIEW}`, { waitUntil: 'domcontentloaded' })
  await ctx2.waitForTimeout(4000)
  const hasModelContext = await ctx2.evaluate(() => 'modelContext' in document)
  const rendered = await ctx2.evaluate(() => !!document.querySelector('#storybook-preview-iframe'))
  record(
    'progressive-enhancement-no-webmcp',
    !hasModelContext && rendered && !errors.length ? 'pass' : 'fail',
    {
      modelContextPresent: hasModelContext,
      storybookRendered: rendered,
      pageErrors: errors,
    }
  )
}

await globalThis.__recordingContext?.close()
await globalThis.__browser.close()

const summary = {
  target: BASE,
  harness: 'headless Chromium with the local document.modelContext polyfill',
  passed: results.filter((r) => r.status === 'pass').length,
  failed: results.filter((r) => r.status === 'fail').length,
  results,
}
writeFileSync(RESULTS_PATH, `${JSON.stringify(summary, null, 2)}\n`)
console.log(`\n${summary.passed} passed, ${summary.failed} failed`)
process.exit(summary.failed ? 1 : 0)
