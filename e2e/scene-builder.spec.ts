import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', service: 'magnus-spatial' }),
  }))
  await page.route('**/api/offline/status', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ regions: [], cachedScenes: 0, cacheBytes: 0 }),
  }))
})

test('loads the scene builder with a visible roadway and passing audit', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await expect(page.getByLabel('Highway', { exact: true })).toHaveValue('I-95')
  await expect(page.getByLabel('Direction')).toHaveValue('northbound')
  await expect(page.getByLabel('Reference')).toHaveValue('mile-marker')
  await expect(page.getByLabel('Mile marker', { exact: true })).toHaveValue('170')
  await expect(page.getByText('I-95 Northbound MM 170 scale reference')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Single right lane closure' })).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Setup compliant' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Spatial service' })).toContainText('Connected')
  const brand = page.getByLabel('Magnus version 6.0.0')
  await expect(brand).toBeVisible()
  await expect(brand).toContainText('AGNUS')
  await expect(brand).toContainText('v6')
})

test('builds the initial TOC radio exchange from direction and lane closure settings', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/road-scenes/resolve?**', (route) => {
    requests.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')

  await expect(page.getByRole('form', { name: 'Roadway location' })).not.toContainText('Direction')
  await page.getByLabel('Reference').selectOption('exit')
  await page.getByLabel('Exit', { exact: true }).fill('166')
  await page.getByLabel('Travel direction').selectOption('southbound')
  await expect(page.getByLabel('Incident type').locator('option')).toHaveText([
    'Car fire',
    'Tractor trailer fire',
    'Crash',
    'Severe crash',
    'Plane crash',
    'Bridge collapse',
    'Overhead signage collapse',
    'Disabled vehicle (shoulder)',
    'Blocking disabled (travel lane)',
    'Debris',
    'Downed tree',
  ])
  await expect(page.getByLabel('Vehicle count')).toBeVisible()
  await expect(page.getByLabel('Transported by EMS')).toBeVisible()
  await expect(page.getByLabel('Injuries')).toBeVisible()
  await page.getByLabel('Incident type').selectOption('blocking-disabled')
  await expect(page.getByLabel('License plate')).toBeVisible()
  await expect(page.getByLabel('Plate state')).toBeVisible()
  await expect(page.getByLabel('Vehicle make')).toBeVisible()
  await expect(page.getByLabel('Vehicle model')).toBeVisible()
  await expect(page.getByLabel('Vehicle color')).toBeVisible()
  await page.getByLabel('Incident type').selectOption('downed-tree')
  await expect(page.getByLabel('Tree lanes blocked')).toBeVisible()
  await expect(page.getByLabel('Tree size')).toHaveValue('20 feet')
  await expect(page.getByLabel('Resources to move tree')).toBeVisible()
  await page.getByLabel('Incident type').selectOption('debris')
  await expect(page.getByLabel('Hazardous debris')).toBeVisible()
  await expect(page.getByLabel('SSP can remove manually')).toBeVisible()
  await expect(page.getByLabel('Needs VSP slow-roll')).toBeVisible()
  await expect(page.getByLabel('SSP has lane blade')).toBeVisible()
  await page.getByLabel('Incident type').selectOption('car-fire')
  await expect(page.getByLabel('Motorist out')).toBeVisible()
  await expect(page.getByLabel('Electric vehicle')).toBeVisible()
  await expect(page.getByLabel('Fire lanes blocked')).toBeVisible()
  await page.getByLabel('Incident type').selectOption('tractor-trailer-fire')
  await expect(page.getByLabel('Driver out')).toBeVisible()
  await expect(page.getByLabel('Trailer hauling')).toBeVisible()
  await expect(page.getByLabel('HAZMAT')).toBeVisible()
  await expect(page.getByLabel('Truck fire lanes blocked')).toBeVisible()
  await page.getByLabel('Incident type').selectOption('plane-crash')
  await page.getByLabel('Plane size').selectOption('small')
  await page.getByLabel('Survivors').selectOption('yes')
  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /All lanes closure/ }).click()
  await page.getByRole('button', { name: 'Build initial radio call' }).click()

  const communications = page.locator('.radio-section')
  await expect(communications).toContainText('SSP970 to 95 control')
  await expect(communications).toContainText('SSP970, go ahead')
  await expect(communications).toContainText("Show me out southbound 95 at exit 166, with a plane crash blocking all lanes, all lanes impacted, small plane, survivors reported, I'll advise.")
  expect(requests.every((url) => url.includes('direction=all'))).toBe(true)
})

test('displays live communications in a large closable classroom window', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  const displayPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Display' }).click()
  const display = await displayPromise
  await expect(display).toHaveTitle('Magnus Communications Display')
  await expect(display.getByLabel('Communications classroom display')).toContainText('Build an initial radio call')

  await page.getByRole('button', { name: 'Build initial radio call' }).click()
  await expect(display.getByLabel('Communications classroom display')).toContainText('SSP970 to 95 control')
  await expect(display.getByLabel('Communications classroom display')).toContainText("I'll advise")

  await display.getByRole('button', { name: 'Close communications display' }).click()
  await expect.poll(() => display.isClosed()).toBe(true)
})

test('persists offline mode and sends cache-only map requests', async ({ page }) => {
  const requests: string[] = []
  await page.route('**/api/road-scenes/resolve?**', (route) => {
    requests.push(route.request().url())
    return route.abort()
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByRole('radiogroup', { name: 'Map connection mode' }).getByRole('radio', { name: 'Offline' }).click()
  await expect.poll(() => requests.some((url) => url.includes('source=offline'))).toBe(true)
  await page.reload()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.getByRole('radiogroup', { name: 'Map connection mode' }).getByRole('radio', { name: 'Offline' })).toHaveAttribute('aria-checked', 'true')
})

test('opens a live scene presentation without display-capture permission', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Open settings' }).click()

  const presentationPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Present on external display' }).click()
  const presentation = await presentationPromise

  await expect(presentation).toHaveTitle('Magnus Presentation')
  await expect(presentation.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toBeVisible()
  await expect(presentation.locator('.road-stage-controls')).toBeHidden()
})

test('saves custom themes while keeping the roadway field green', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.route('**/api/offline/status', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      regions: [
        { id: 'northern-virginia', label: 'Northern Virginia highways', installed: true, bytes: 12 * 1024 * 1024 },
        { id: 'virginia', label: 'Virginia statewide source', installed: false, bytes: 0 },
      ],
      cachedScenes: 3,
      cacheBytes: 2048,
    }),
  }))
  await page.goto('/')

  await page.getByRole('button', { name: 'Open settings' }).click()
  const settings = page.getByRole('region', { name: 'Settings' })
  await expect(settings).toContainText('3 prepared scenes')
  await expect(settings).toContainText('Northern Virginia highways')
  await settings.getByRole('button', { name: 'Custom 2' }).click()
  await settings.getByLabel('Custom theme color').fill('#2468a0')
  await settings.getByLabel('Custom theme name').fill('Blue operations')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'custom')
  await expect(page.locator('.road-stage')).toHaveCSS('background-color', 'rgb(79, 92, 72)')

  await page.reload()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.getByRole('region', { name: 'Settings' }).getByRole('button', { name: 'Blue operations' })).toHaveAttribute('aria-pressed', 'true')
})

test('scales workspace panes and renders animated directional equipment', async ({ page }, testInfo) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  const configPane = page.getByRole('complementary', { name: 'Scenario configuration' })
  const initialWidth = (await configPane.boundingBox())!.width
  await page.getByRole('button', { name: 'Open settings' }).click()
  await page.getByLabel('Pane and text scale').fill('140')
  await expect(configPane).toHaveCSS('zoom', '1.4')
  if (testInfo.project.name === 'desktop-chromium') {
    await expect.poll(async () => (await configPane.boundingBox())!.width).toBeGreaterThan(initialWidth * 1.3)
  }
  await page.reload()
  await page.getByRole('button', { name: 'Open settings' }).click()
  await expect(page.getByLabel('Pane and text scale')).toHaveValue('140')
  await page.getByRole('button', { name: 'Close settings' }).click()

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'SSP Assets' }).click()
  await toolkit.getByRole('button', { name: /Lane Blade Truck/ }).click()
  const laneBlade = page.locator('.ssp-truck[data-asset-type="lane-blade-truck"]')
  await expect(laneBlade).toHaveCount(1)
  await expect(laneBlade.locator('.truck-lane-blade')).toHaveCount(1)
  await expect(laneBlade.locator('.signboard-frame-a')).toHaveCSS('animation-name', 'signboard-flash')
  const initialRotation = Number(/rotate\(([^)]+)\)/.exec(await laneBlade.getAttribute('transform') ?? '')?.[1])
  await page.getByLabel(/Rotation for Lane Blade Truck/).selectOption('90')
  await expect.poll(async () => Number(/rotate\(([^)]+)\)/.exec(await laneBlade.getAttribute('transform') ?? '')?.[1])).toBeCloseTo(initialRotation + 90, 4)
  await expect(laneBlade.getByLabel(/Rotate Lane Blade Truck/)).toBeVisible()
})

test('saves and restores the complete scene configuration', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { value: undefined }))
  await page.goto('/')
  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  await page.getByRole('button', { name: 'SAVE SCENE' }).click()
  await page.getByRole('menuitem', { name: 'SVG vector' }).click()
  await expect(page.getByText('Scene ready', { exact: true })).toBeVisible()

  await page.reload()
  await expect(page.locator('[data-definition-id="ems-ambulance"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset whole scene' }).click()
  await expect(page.locator('[data-definition-id="ems-ambulance"]')).toHaveCount(0)
})

test('preserves non-SSP objects when resetting or changing the SSP scene and allows loaded cones to move', async ({ page }) => {
  await page.goto('/')

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  await toolkit.getByRole('tab', { name: 'SSP Assets' }).click()
  await toolkit.getByRole('button', { name: /Gas can/ }).click()

  const ambulance = page.locator('[data-definition-id="ems-ambulance"]')
  const gasCan = page.locator('[data-definition-id="gas-can"]')
  await expect(ambulance).toHaveCount(1)
  await expect(gasCan).toHaveCount(1)

  await page.getByRole('button', { name: 'Reset SSP objects' }).click()
  await expect(ambulance).toHaveCount(1)
  await expect(gasCan).toHaveCount(0)

  const loadedCone = page.locator('[data-cone-id="anchor"]')
  const initialTransform = await loadedCone.getAttribute('transform')
  const coneBounds = await loadedCone.boundingBox()
  expect(coneBounds).not.toBeNull()
  await page.mouse.move(coneBounds!.x + coneBounds!.width / 2, coneBounds!.y + coneBounds!.height / 2)
  await page.mouse.down()
  await page.mouse.move(coneBounds!.x + coneBounds!.width / 2 + 30, coneBounds!.y + coneBounds!.height / 2 + 20)
  await page.mouse.up()
  await expect(loadedCone).not.toHaveAttribute('transform', initialTransform ?? '')

  await toolkit.getByRole('button', { name: /Gas can/ }).click()
  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Shoulder closure/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#mainline-surface').click({ force: true })

  await expect(ambulance).toHaveCount(1)
  await expect(gasCan).toHaveCount(0)
  await expect(page.locator('[data-cone-id="taper-3"]')).toBeVisible()
})

test('warns about unsaved changes before exiting and allows them to be discarded', async ({ page }) => {
  let exitRequests = 0
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.route('**/api/exit', (route) => {
    exitRequests += 1
    return route.fulfill({ status: 202 })
  })
  await page.goto('/')
  await expect(page.getByText('scale-accurate reference layout', { exact: false })).toBeVisible()

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    expect(dialog.message()).toContain('unsaved changes')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'Exit Magnus' }).click()
  expect(exitRequests).toBe(0)
  await expect(page.locator('[data-definition-id="ems-ambulance"]')).toHaveCount(1)

  page.once('dialog', async (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Exit Magnus' }).click()
  await expect.poll(() => exitRequests).toBe(1)
})

test('zooms the imported vector highway graphic', async ({ page }) => {
  await page.goto('/')
  const canvas = page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')
  const stage = page.locator('.road-stage')
  const topbarZoom = page.locator('.topbar').getByRole('group', { name: 'Scene zoom' })
  const scaleKey = page.locator('.scale-key')
  const initialScalePixels = Number(await scaleKey.getAttribute('data-scale-pixels'))

  await expect(topbarZoom).toBeVisible()
  await expect(page.locator('.canvas-toolbar').getByRole('img', { name: /Map compass/ })).toBeVisible()
  await expect(page.locator('.canvas-toolbar').getByText('Traffic flow', { exact: true })).toBeVisible()
  await expect(page.locator('.audit-panel').getByRole('group', { name: 'Scene zoom' })).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '500')
  await expect.poll(() => stage.evaluate((element) => ({
    horizontal: element.scrollLeft / (element.scrollWidth - element.clientWidth),
    vertical: element.scrollTop / (element.scrollHeight - element.clientHeight),
  }))).toEqual({
    horizontal: expect.closeTo(.5, 2),
    vertical: expect.closeTo(.5, 2),
  })
  const canvasBounds = await canvas.boundingBox()
  expect(canvasBounds).not.toBeNull()
  expect(canvasBounds!.width / canvasBounds!.height).toBeGreaterThan(0.5)
  const mapWorld = page.locator('.map-world')
  await page.getByRole('button', { name: 'Rotate center view clockwise 45 degrees' }).click()
  await expect(mapWorld).toHaveAttribute('transform', /^rotate\(45 /)
  await expect(page.getByRole('img', { name: 'Map compass, north rotated 45 degrees' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reset center view rotation, currently 45 degrees' })).toHaveText('45°')
  await page.getByRole('button', { name: 'Reset center view rotation, currently 45 degrees' }).click()
  await expect(mapWorld).toHaveAttribute('transform', /^rotate\(0 /)
  const fittedViewBox = await canvas.getAttribute('viewBox')
  await page.getByRole('button', { name: 'Zoom in highway graphic' }).click()
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '400')
  await expect.poll(async () => Number(await scaleKey.getAttribute('data-scale-pixels'))).toBeGreaterThan(initialScalePixels)
  await expect(canvas).toHaveAttribute('viewBox', fittedViewBox!)
  await expect.poll(() => stage.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight,
  }))).toEqual({ horizontal: true, vertical: true })

  await stage.evaluate((element) => element.scrollTo(element.scrollWidth, element.scrollHeight))
  await expect.poll(() => stage.evaluate((element) => ({
    left: element.scrollLeft,
    top: element.scrollTop,
  }))).toEqual({
    left: expect.any(Number),
    top: expect.any(Number),
  })
  expect(await stage.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(await stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  await page.getByRole('button', { name: /Reset highway graphic zoom/ }).click()
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '500')
  await expect(canvas).toHaveAttribute('viewBox', fittedViewBox!)

  await stage.dispatchEvent('wheel', { deltaY: -1000, ctrlKey: true })
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '40')
})

test('draws sampled freehand vectors and controls their layer', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await page.getByRole('button', { name: 'Draw' }).click()
  const drawingTools = page.getByRole('dialog', { name: 'Freehand drawing tools' })
  await drawingTools.getByRole('button', { name: 'Pen off' }).click()
  await drawingTools.getByLabel('Drawing width').fill('10')
  await page.getByRole('button', { name: 'Draw' }).click()

  const drawingSurface = page.locator('.drawing-hit-area')
  const bounds = await drawingSurface.boundingBox()
  expect(bounds).not.toBeNull()
  const startX = bounds!.x + bounds!.width / 2
  const startY = bounds!.y + bounds!.height * .3
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + Math.min(20, bounds!.width * .2), startY + 140, { steps: 2 })
  await page.mouse.up()

  const stroke = page.locator('.drawing-stroke')
  await expect(stroke).toHaveCount(1)
  await expect(stroke).toHaveAttribute('stroke-width', '10')
  const points = (await stroke.getAttribute('points'))!.split(' ').map((point) => point.split(',').map(Number))
  expect(points.length).toBeGreaterThan(2)
  expect(Math.max(...points.slice(1).map(([x, y], index) => Math.hypot(x - points[index][0], y - points[index][1])))).toBeLessThanOrEqual(10.01)

  const drawingsLayer = page.getByText('Drawings', { exact: true }).locator('..').getByRole('checkbox')
  await drawingsLayer.uncheck()
  await expect(stroke).toHaveCount(0)
  await drawingsLayer.check()
  await expect(stroke).toHaveCount(1)

  await page.getByRole('button', { name: 'Draw' }).click()
  await page.getByRole('dialog', { name: 'Freehand drawing tools' }).getByRole('button', { name: 'Undo last stroke' }).click()
  await expect(stroke).toHaveCount(0)
})

test('reserves two-finger touch input and pans with three touch contacts', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')
  const canvas = page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')
  const stage = page.locator('.road-stage')

  await stage.dispatchEvent('pointerdown', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 100,
    clientY: 200,
    isPrimary: true,
  })
  await stage.dispatchEvent('pointerdown', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 200,
    clientY: 200,
  })
  const initialZoom = await canvas.getAttribute('data-visible-width-feet')
  const initialScroll = await stage.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  await stage.dispatchEvent('pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 225,
    clientY: 200,
  })
  await expect(canvas).toHaveAttribute('data-visible-width-feet', initialZoom!)
  await expect.poll(() => stage.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual(initialScroll)
  await stage.dispatchEvent('pointerdown', {
    pointerId: 3,
    pointerType: 'touch',
    clientX: 300,
    clientY: 200,
  })
  await stage.dispatchEvent('pointermove', {
    pointerId: 1,
    pointerType: 'touch',
    clientX: 50,
    clientY: 150,
    isPrimary: true,
  })
  await stage.dispatchEvent('pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 175,
    clientY: 150,
  })
  await stage.dispatchEvent('pointermove', {
    pointerId: 3,
    pointerType: 'touch',
    clientX: 250,
    clientY: 150,
  })
  await expect.poll(() => stage.evaluate((element, start) => ({
    horizontal: element.scrollLeft > start.left,
    vertical: element.scrollTop > start.top,
  }), initialScroll)).toEqual({ horizontal: true, vertical: true })
  await expect(canvas).toHaveAttribute('data-visible-width-feet', initialZoom!)
  await stage.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' })
  await stage.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch' })
  await stage.dispatchEvent('pointerup', { pointerId: 3, pointerType: 'touch' })
})

test('pans the zoomed scene with laptop touchpad wheel output', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')
  const stage = page.locator('.road-stage')
  await page.getByRole('button', { name: 'Zoom in highway graphic' }).click()
  await expect.poll(() => stage.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)

  const initial = await stage.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))
  await stage.dispatchEvent('wheel', { deltaX: -30, deltaY: -30 })
  await expect.poll(() => stage.evaluate((element) => ({ left: element.scrollLeft, top: element.scrollTop }))).toEqual({
    left: initial.left - 30,
    top: initial.top - 30,
  })

})

test('renders highway markings and the SSP vehicle to the same foot scale', async ({ page }) => {
  await page.goto('/')

  const truck = page.locator('.ssp-truck')
  const skipLine = page.locator('.road-feature-skip-line').first()

  await expect(truck).toHaveAttribute('data-width-feet', '8.5')
  await expect(truck).toHaveAttribute('data-length-feet', '24')
  await expect(truck.locator('.truck-body')).toHaveAttribute('width', '8.5')
  await expect(truck.locator('.truck-body')).toHaveAttribute('height', '24')
  await expect(skipLine).toHaveAttribute('stroke-dasharray', '10 30')
  await expect(skipLine).toHaveAttribute('stroke-width', '0.5')
  await expect(page.locator('.road-canvas .cone-label, .road-canvas .distance-label, .road-canvas .flow-label, .road-canvas .north-arrow text')).toHaveCount(0)
})

test('uses a wider center pane and a muted moss map field', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.setViewportSize({ width: 3840, height: 1080 })
  await page.goto('/')

  const widths = await page.locator('.workspace').evaluate((workspace) => {
    const left = workspace.querySelector<HTMLElement>('.config-panel')!
    const center = workspace.querySelector<HTMLElement>('.canvas-panel')!
    const right = workspace.querySelector<HTMLElement>('.audit-panel')!
    return {
      workspace: workspace.clientWidth,
      left: left.clientWidth,
      center: center.clientWidth,
      right: right.clientWidth,
    }
  })

  expect(widths.left).toBeLessThanOrEqual(360)
  expect(widths.right).toBeLessThanOrEqual(360)
  expect(widths.center).toBeGreaterThan(3_100)
  expect(Math.abs(widths.workspace - widths.left - widths.center - widths.right)).toBeLessThanOrEqual(2)
  await expect(page.locator('.road-stage')).toHaveCSS('background-color', 'rgb(79, 92, 72)')
  await expect(page.locator('.roadway-data-layer > rect')).toHaveAttribute('fill', '#56624d')
  await expect.poll(async () => {
    const stageBounds = await page.locator('.road-stage').boundingBox()
    const truckBounds = await page.locator('[data-truck-id="ssp-truck-1"]').boundingBox()
    if (!stageBounds || !truckBounds) return false
    return truckBounds.x > stageBounds.x
      && truckBounds.x < stageBounds.x + stageBounds.width
      && truckBounds.y > stageBounds.y
      && truckBounds.y < stageBounds.y + stageBounds.height
  }).toBe(true)
})

test('collapses, restores, and persists both workspace panes', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto('/')

  const workspace = page.locator('.workspace')
  const canvas = page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')
  const center = page.locator('.canvas-panel')
  const stage = page.locator('.road-stage')
  const viewedCenter = () => stage.evaluate((element) => {
    const surface = element.querySelector<HTMLElement>('.road-canvas-surface')!
    const canvas = element.querySelector<SVGSVGElement>('.road-canvas')!
    const viewBox = canvas.viewBox.baseVal
    return {
      x: viewBox.x + ((element.scrollLeft + element.clientWidth / 2 - surface.offsetLeft) / surface.clientWidth) * viewBox.width,
      y: viewBox.y + ((element.scrollTop + element.clientHeight / 2 - surface.offsetTop) / surface.clientHeight) * viewBox.height,
    }
  })
  const centerDriftPixels = async (expected: { x: number; y: number }) => stage.evaluate((element, target) => {
    const surface = element.querySelector<HTMLElement>('.road-canvas-surface')!
    const canvas = element.querySelector<SVGSVGElement>('.road-canvas')!
    const viewBox = canvas.viewBox.baseVal
    const currentX = viewBox.x + ((element.scrollLeft + element.clientWidth / 2 - surface.offsetLeft) / surface.clientWidth) * viewBox.width
    const currentY = viewBox.y + ((element.scrollTop + element.clientHeight / 2 - surface.offsetTop) / surface.clientHeight) * viewBox.height
    return Math.max(
      Math.abs(currentX - target.x) / (viewBox.width / surface.clientWidth),
      Math.abs(currentY - target.y) / (viewBox.height / surface.clientHeight),
    )
  }, expected)
  const initialCenterWidth = (await center.boundingBox())!.width
  const initialZoom = await canvas.getAttribute('data-zoom')
  const initialTruckTransform = await page.locator('[data-truck-id="ssp-truck-1"]').getAttribute('transform')
  const initialViewedCenter = await viewedCenter()
  await page.getByRole('button', { name: 'Collapse configuration pane' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Expand configuration pane' })).toBeFocused()
  await expect.poll(() => centerDriftPixels(initialViewedCenter)).toBeLessThanOrEqual(1)
  await expect(page.getByRole('button', { name: 'Collapse operations pane' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse operations pane' }).click()
  await expect(workspace).toHaveClass(/left-pane-collapsed/)
  await expect(workspace).toHaveClass(/right-pane-collapsed/)
  await expect(canvas).toHaveAttribute('data-zoom', initialZoom!)
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', initialTruckTransform!)
  await expect.poll(async () => (await center.boundingBox())!.width).toBeGreaterThan(initialCenterWidth)
  await expect.poll(() => centerDriftPixels(initialViewedCenter)).toBeLessThanOrEqual(1)
  await expect(page.getByText('Mode & audit')).toHaveCount(0)

  const gripWidths = await workspace.evaluate((element) => ({
    left: element.querySelector<HTMLElement>('.left-pane-restore')!.getBoundingClientRect().width,
    right: element.querySelector<HTMLElement>('.right-pane-restore')!.getBoundingClientRect().width,
  }))
  expect(gripWidths).toEqual({ left: 44, right: 44 })

  await page.reload()
  await expect(workspace).toHaveClass(/left-pane-collapsed/)
  await expect(workspace).toHaveClass(/right-pane-collapsed/)
  await page.getByRole('button', { name: 'Expand configuration pane' }).click()
  await page.getByRole('button', { name: 'Expand operations pane' }).click()
  await expect(page.getByRole('button', { name: 'Collapse configuration pane' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collapse operations pane' })).toBeVisible()
})

test('resolves a highway exit request into scaled interchange geometry', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await page.getByLabel('Highway', { exact: true }).fill('I 95')
  await page.getByLabel('Direction').selectOption('northbound')
  await page.getByLabel('Reference').selectOption('exit')
  await page.getByLabel('Exit', { exact: true }).fill('166')
  await page.getByRole('button', { name: 'Render location' }).click()

  await expect(page.locator('.location-result')).toContainText('scale-accurate reference layout')
  await expect(page.getByText('I-95 Northbound Exit 166 scale reference')).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toHaveAttribute('data-visible-width-feet', '500')
  await expect(page.locator('#preview-exit-ramp-surface')).toHaveCount(1)
  await expect(page.locator('#preview-exit-ramp-surface')).toHaveAttribute('stroke-width', '12')
})

test('selects a Mixing Bowl overpass as the controlled scene sector', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await page.getByLabel('Highway', { exact: true }).fill('I-95')
  await page.getByLabel('Direction').selectOption('northbound')
  await page.getByLabel('Reference').selectOption('mile-marker')
  await page.getByLabel('Mile marker', { exact: true }).fill('170')
  await page.getByRole('button', { name: 'Render location' }).click()

  const connector = page.locator('#preview-express-ramp-surface')
  await expect(page.getByLabel('Controlled roadway section')).toBeVisible()
  await page.getByRole('button', { name: 'Select section' }).click()
  await expect(page.getByText('Select a roadway section')).toBeVisible()
  await page.getByRole('button', { name: 'Northbound express connector' }).press('Enter')

  await expect(connector).toHaveClass(/section-selected/)
  await expect(page.getByLabel('Controlled roadway section')).toContainText('Northbound express connector')
  await expect(page.locator('.scene-equipment')).toHaveAttribute('transform', /translate\(.+\) rotate\(.+\)/)
})

test('toggles roadway display layers independently', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await expect(page.getByRole('checkbox', { name: 'Highway labels unavailable in preview' })).toBeDisabled()
  await expect(page.locator('.roadway-label-layer')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Road geometry' }).uncheck()
  await expect(page.locator('.road-feature-road-surface')).toHaveCount(0)
  await expect(page.locator('.road-feature-shoulder-edge')).toHaveCount(2)

  await page.getByRole('checkbox', { name: 'Barriers' }).uncheck()
  await expect(page.locator('.road-feature-shoulder-edge')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Traffic flow' }).uncheck()
  await expect(page.locator('.road-feature-traffic-flow')).toHaveCount(0)

})

test('renders compact highway labels from loaded map feature metadata only', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      source: { type: 'osm-api', dataset: 'OpenStreetMap I-395 Exit 8', generatedAt: 'resolved-live', attribution: 'OpenStreetMap contributors' },
      coordinateSystem: { worldCrs: 'LOCAL_ENU_FT_FROM_EPSG:4326', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
      viewport: { width: 122, height: 760 },
      features: [
        { id: 'i395-casing', kind: 'road-casing', layer: 0, geometry: { type: 'LineString', coordinates: [[61, 0], [61, 760]] }, properties: { highway: 'motorway', reference: 'I-395', renderWidthFeet: 44 } },
        { id: 'i395-surface', kind: 'road-surface', layer: 0, geometry: { type: 'LineString', coordinates: [[61, 0], [61, 760]] }, properties: { highway: 'motorway', reference: 'I-395', junctionReference: '8A', destinationReference: 'VA 27', lanes: 3, direction: 'forward', renderWidthFeet: 36 } },
      ],
    }),
  }))
  await page.goto('/')

  const mapLabel = page.locator('.roadway-label', { hasText: 'I-395 · Exit 8A · to VA 27' })
  await expect(mapLabel).toBeVisible()
  await expect(mapLabel).toHaveCSS('font-size', '3px')
  await expect(mapLabel).toHaveCSS('fill', 'rgb(17, 17, 17)')
  await expect(mapLabel).toHaveCSS('stroke', 'rgb(255, 255, 255)')
  await expect(page.locator('.roadway-label-layer')).toHaveCount(1)
  expect(await page.evaluate(() => {
    const equipment = document.querySelector('.scene-equipment')
    const labels = document.querySelector('.roadway-label-layer')
    return Boolean(equipment && labels && equipment.compareDocumentPosition(labels) & Node.DOCUMENT_POSITION_FOLLOWING)
  })).toBe(true)
  await page.getByRole('checkbox', { name: 'Highway labels' }).uncheck()
  await expect(page.locator('.roadway-label')).toHaveCount(0)
})

test('clears an incompatible reference when the requested highway changes', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('Mile marker', { exact: true })).toHaveValue('170')
  await page.getByLabel('Highway', { exact: true }).fill('I-395')
  await expect(page.getByLabel('Mile marker', { exact: true })).toHaveValue('')
  await page.getByRole('button', { name: 'Render location' }).click()
  await expect(page.getByText('Enter a mile marker.')).toBeVisible()
})

test('collapses and expands Scene Type controls downward', async ({ page }) => {
  await page.goto('/')
  const toggle = page.getByRole('button', { name: 'Scene type' })

  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#scene-type-options')).toBeVisible()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#scene-type-options')).toHaveCount(0)
  await toggle.click()
  await expect(page.locator('#scene-type-options')).toBeVisible()
})

test('configures signboards independently for up to five SSP trucks', async ({ page }) => {
  await page.goto('/')

  const firstMessage = page.getByLabel('Signboard message for SSP Truck 1')
  await expect(firstMessage).toHaveValue('double-diamonds')
  await firstMessage.selectOption('incident-ahead')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('data-signboard', 'incident-ahead')

  const addTruck = page.getByRole('region', { name: 'Scene equipment toolkit' }).getByRole('button', { name: /^SSP truck/ })
  await addTruck.click()
  const secondMessage = page.getByLabel('Signboard message for SSP Truck 2')
  await expect(secondMessage).toHaveValue('double-diamonds')
  await secondMessage.selectOption('high-water')

  await addTruck.click()
  await addTruck.click()
  await addTruck.click()
  await expect(addTruck).toBeDisabled()

  await page.getByRole('button', { name: 'SSP Truck 1, signboard Incident Ahead' }).press('Enter')
  await expect(page.getByLabel('Signboard message for SSP Truck 1')).toHaveValue('incident-ahead')
  await expect(page.getByRole('img', { name: 'SSP Truck 1 signboard: Incident Ahead' })).toBeVisible()
  await expect(page.locator('[data-truck-id="ssp-truck-2"]')).toHaveAttribute('data-signboard', 'high-water')
})

test('renders split arrow as one horizontal double-headed arrow', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Signboard message for SSP Truck 1').selectOption('split-arrow')

  await expect(page.getByRole('img', { name: 'SSP Truck 1 signboard: Split arrow' }).locator('.signboard-symbol')).toHaveAttribute(
    'd',
    'M -22 0 H 22 M -22 0 L -10 -8 M -22 0 L -10 8 M 22 0 L 10 -8 M 22 0 L 10 8',
  )
})

test('removes the scene and places the selected scene on the next map tap', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await page.getByLabel('Reference').selectOption('mile-marker')
  await page.getByLabel('Mile marker', { exact: true }).fill('170')
  await page.getByRole('button', { name: 'Render location' }).click()
  await expect(page.locator('#preview-express-ramp-surface')).toHaveCount(1)

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await expect(page.locator('.scene-equipment')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Roadway only' })).toBeVisible()

  await page.getByRole('button', { name: /Center lane closure/ }).click()
  const addScene = page.getByRole('button', { name: 'Add scene' })
  await addScene.click()
  await page.getByRole('button', { name: 'Rotate center view clockwise 45 degrees' }).click()
  await expect(page.getByRole('button', { name: 'Tap roadway to place' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.scene-equipment')).toHaveCount(0)

  await page.locator('#preview-express-ramp-surface').click({ force: true, position: { x: 20, y: 5 } })
  await expect(page.locator('.scene-equipment')).toHaveCount(1)
  await expect(page.locator('.map-world')).toHaveAttribute('transform', /^rotate\(45 /)
  await expect(page.getByRole('heading', { name: 'Center lane closure' })).toBeVisible()
  await expect(page.locator('.scene-equipment')).toHaveAttribute('transform', /translate\(.+ .+\) rotate\((?!0\))/)
})

test('instantiates lane-specific geometry and signboards when adding a scene', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      source: { type: 'osm-pbf', dataset: 'lane template test road', generatedAt: '2026-08-22T00:00:00.000Z', attribution: 'Test fixture' },
      coordinateSystem: { worldCrs: 'LOCAL', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
      viewport: { width: 72, height: 760 },
      features: [{
        id: 'mainline-surface',
        kind: 'road-surface',
        layer: 0,
        geometry: { type: 'LineString', coordinates: [[36, 760], [36, 0]] },
        properties: { name: 'Straight road', highway: 'motorway', lanes: 3, direction: 'forward', renderWidthFeet: 36 },
      }],
    }),
  }))
  await page.goto('/')

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Left lane closure/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#mainline-surface').click({ force: true })

  await expect(page.locator('[data-cone-id="anchor"]')).toHaveAttribute('transform', 'translate(30 282)')
  await expect(page.locator('[data-cone-id="buffer-2"]')).toHaveAttribute('transform', 'translate(30 362)')
  await expect(page.locator('[data-cone-id="taper-5"]')).toHaveAttribute('transform', 'translate(18 562)')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', 'translate(24 260) rotate(0)')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('data-signboard', 'right-arrow')
  await expect(page.locator('.metric-grid > div').filter({ hasText: 'Taper length' }).locator('strong')).toContainText('200')

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Two left lanes/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#mainline-surface').click({ force: true })

  await expect(page.locator('[data-cone-id="anchor"]')).toHaveAttribute('transform', 'translate(42 282)')
  await expect(page.locator('[data-cone-id="buffer-2"]')).toHaveAttribute('transform', 'translate(42 362)')
  await expect(page.locator('[data-cone-id="taper-5"]')).toHaveAttribute('transform', 'translate(30 562)')
  await expect(page.locator('[data-cone-id="taper-10"]')).toHaveAttribute('transform', 'translate(18 762)')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', 'translate(36 260) rotate(0)')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('data-signboard', 'right-arrow')
  await expect(page.locator('.metric-grid > div').filter({ hasText: 'Taper length' }).locator('strong')).toContainText('400')

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Two right lanes/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#mainline-surface').click({ force: true })

  await expect(page.locator('[data-cone-id="anchor"]')).toHaveAttribute('transform', 'translate(30 282)')
  await expect(page.locator('[data-cone-id="buffer-2"]')).toHaveAttribute('transform', 'translate(30 362)')
  await expect(page.locator('[data-cone-id="taper-5"]')).toHaveAttribute('transform', 'translate(42 562)')
  await expect(page.locator('[data-cone-id="taper-10"]')).toHaveAttribute('transform', 'translate(54 762)')

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Shoulder closure/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#mainline-surface').click({ force: true })

  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', 'translate(60 260) rotate(0)')
  await expect(page.locator('[data-cone-id="taper-3"]')).toHaveAttribute('transform', 'translate(66 402)')
})

test('aligns right-lane cones to skip and fog lines on a four-lane road', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      source: { type: 'osm-api', dataset: 'Four-lane alignment fixture', generatedAt: 'test', attribution: 'Test geometry' },
      coordinateSystem: { worldCrs: 'LOCAL', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
      viewport: { width: 200, height: 400 },
      features: [
        { id: 'four-lane-surface', kind: 'road-surface', layer: 0, geometry: { type: 'LineString', coordinates: [[100, 350], [100, 50]] }, properties: { highway: 'motorway', lanes: 4, renderWidthFeet: 62 } },
        { id: 'four-lane-right-skip', kind: 'skip-line', layer: 1, geometry: { type: 'LineString', coordinates: [[112, 350], [112, 50]] }, properties: { highway: 'motorway', lanes: 4, renderWidthFeet: 0.5 } },
        { id: 'four-lane-right-fog', kind: 'right-fog-line', layer: 1, geometry: { type: 'LineString', coordinates: [[124, 350], [124, 50]] }, properties: { highway: 'motorway', lanes: 4, renderWidthFeet: 0.5 } },
      ],
    }),
  }))
  await page.goto('/')

  await expect(page.locator('.scene-equipment')).toHaveAttribute(
    'transform',
    'translate(100 200) rotate(0) translate(6 0) translate(-36 -260)',
  )
  await expect(page.locator('[data-cone-id="anchor"]')).toHaveAttribute('transform', 'translate(42 282)')
  await expect(page.locator('[data-cone-id="taper-5"]')).toHaveAttribute('transform', 'translate(54 562)')
  await expect(page.locator('#four-lane-right-skip')).toHaveAttribute('d', 'M 112 350 L 112 50')
  await expect(page.locator('#four-lane-right-fog')).toHaveAttribute('d', 'M 124 350 L 124 50')
})

test('bends lane and shoulder tapers between curved roadway boundaries', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      source: { type: 'osm-api', dataset: 'Curved alignment fixture', generatedAt: 'test', attribution: 'Test geometry' },
      coordinateSystem: { worldCrs: 'LOCAL', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
      viewport: { width: 500, height: 800 },
      features: [
        { id: 'curved-surface', kind: 'road-surface', layer: 0, geometry: { type: 'LineString', coordinates: [[200, 780], [200, 500], [220, 300], [280, 20]] }, properties: { highway: 'motorway', lanes: 3, renderWidthFeet: 60 } },
        { id: 'curved-right-fog', kind: 'right-fog-line', layer: 1, geometry: { type: 'LineString', coordinates: [[218, 780], [218, 500], [237.91, 301.79], [297.6, 23.77]] }, properties: { highway: 'motorway', lanes: 3, renderWidthFeet: 0.5 } },
        { id: 'curved-shoulder-edge', kind: 'shoulder-edge', layer: 1, geometry: { type: 'LineString', coordinates: [[230, 780], [230, 500], [249.85, 302.99], [309.34, 26.28]] }, properties: { highway: 'motorway', lanes: 3, renderWidthFeet: 0.5 } },
      ],
    }),
  }))
  await page.goto('/')
  await expect(page.getByText('Curved alignment fixture')).toBeVisible()

  const distanceToFogLine = await page.locator('[data-cone-id="taper-5"]').evaluate((cone) => {
    const coneMatrix = (cone as SVGGraphicsElement).getCTM()
    const fogLine = document.querySelector<SVGPathElement>('#curved-right-fog')
    if (!coneMatrix || !fogLine) return Number.POSITIVE_INFINITY
    const coneCenter = new DOMPoint(0, 0).matrixTransform(coneMatrix)
    const fogMatrix = fogLine.getCTM()
    if (!fogMatrix) return Number.POSITIVE_INFINITY
    let nearestDistance = Number.POSITIVE_INFINITY
    const length = fogLine.getTotalLength()
    for (let distance = 0; distance <= length; distance += 1) {
      const point = fogLine.getPointAtLength(distance).matrixTransform(fogMatrix)
      nearestDistance = Math.min(nearestDistance, Math.hypot(coneCenter.x - point.x, coneCenter.y - point.y))
    }
    return nearestDistance
  })

  expect(distanceToFogLine).toBeLessThan(1)
  await expect(page.locator('[data-cone-id="taper-5"]')).not.toHaveAttribute('transform', 'translate(54 562)')

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Shoulder closure/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#curved-surface').click({ force: true })
  await expect(page.locator('[data-cone-id="taper-3"]')).toBeVisible()
  const distanceToShoulderEdge = await page.locator('[data-cone-id="taper-3"]').evaluate((cone) => {
    const coneMatrix = (cone as SVGGraphicsElement).getCTM()
    const shoulderEdge = document.querySelector<SVGPathElement>('#curved-shoulder-edge')
    if (!coneMatrix || !shoulderEdge) return Number.POSITIVE_INFINITY
    const coneCenter = new DOMPoint(0, 0).matrixTransform(coneMatrix)
    const edgeMatrix = shoulderEdge.getCTM()
    if (!edgeMatrix) return Number.POSITIVE_INFINITY
    let nearestDistance = Number.POSITIVE_INFINITY
    const length = shoulderEdge.getTotalLength()
    for (let distance = 0; distance <= length; distance += 1) {
      const point = shoulderEdge.getPointAtLength(distance).matrixTransform(edgeMatrix)
      nearestDistance = Math.min(nearestDistance, Math.hypot(coneCenter.x - point.x, coneCenter.y - point.y))
    }
    return nearestDistance
  })
  expect(distanceToShoulderEdge).toBeLessThan(1)
})

test('deploys assets and hazards with live scene counters and deletion', async ({ page }) => {
  await page.goto('/')

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  await expect(page.getByRole('region', { name: 'Scene resource counts' })).toContainText('2')
  const inspector = page.getByRole('region', { name: 'Selected scene item' })
  await expect(inspector).toContainText('EMS ambulance')
  await inspector.getByLabel('X (ft)').fill('40')
  await expect(page.locator('[data-definition-id="ems-ambulance"]')).toHaveAttribute('transform', /translate\(40 /)

  await toolkit.getByRole('tab', { name: 'Hazards' }).click()
  await toolkit.getByRole('button', { name: /Vehicle fire/ }).click()
  await expect(page.locator('[data-definition-id="vehicle-fire"] .catalog-flames')).toHaveCount(1)
  await toolkit.getByRole('button', { name: /Hazmat tanker truck/ }).click()
  await expect(page.locator('[data-definition-id="hazmat-tanker"] .catalog-hazmat')).toHaveCount(1)
  await toolkit.getByRole('button', { name: /^Downed tree/ }).click()
  const downedTree = page.locator('[data-definition-id="downed-tree"]')
  await expect(downedTree.locator('.catalog-tree-canopy')).toHaveCount(3)
  await expect(downedTree.locator('.deployed-selection')).toHaveAttribute('height', '24')
  await toolkit.getByRole('button', { name: /Helicopter landing zone/ }).click()
  await expect(page.locator('[data-definition-id="helicopter-zone"]')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Scene resource counts' })).toContainText('1')
  await page.getByRole('button', { name: 'Delete selected item' }).click()
  await expect(page.locator('[data-definition-id="helicopter-zone"]')).toHaveCount(0)

  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  const cruiser = toolkit.getByRole('button', { name: /VSP cruiser/ })
  for (let count = 0; count < 5; count += 1) await cruiser.click()
  await expect(cruiser).toBeDisabled()
})

test('organizes scene equipment into four diagonal catalog tabs', async ({ page }) => {
  await page.goto('/')

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  const tabs = toolkit.getByRole('tab')
  await expect(tabs).toHaveText(['SSP Assets', 'External Assets', 'Hazards', 'Incidentals'])
  await expect(toolkit.getByRole('tab', { name: 'SSP Assets' })).toHaveAttribute('aria-selected', 'true')
  await expect(toolkit.getByRole('tab', { name: 'SSP Assets' })).toHaveCSS('background-color', 'rgb(255, 106, 0)')
  await expect(toolkit.getByRole('tab', { name: 'External Assets' })).toHaveCSS('background-color', 'rgb(166, 64, 0)')
  await expect(toolkit.getByRole('tab', { name: 'External Assets' })).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(toolkit.getByRole('tab', { name: 'SSP Assets' }).locator('.toolkit-tab-line')).toHaveText(['SSP', 'Assets'])
  await expect(toolkit.getByRole('tab', { name: 'External Assets' }).locator('.toolkit-tab-line')).toHaveText(['External', 'Assets'])
  await expect(toolkit.getByRole('tab', { name: 'Hazards' })).toHaveCSS('font-size', '13px')
  await expect(toolkit.getByRole('tab', { name: 'Incidentals' })).toHaveCSS('font-size', '9px')
  await expect(toolkit.locator('.toolkit-tabs')).toHaveCSS('height', '72px')
  await expect(toolkit.getByRole('button', { name: /Gas can/ })).toBeVisible()
  await expect(toolkit.getByRole('button', { name: /Floor jack/ })).toBeVisible()
  await expect(toolkit.getByRole('button', { name: /Tool bag/ })).toBeVisible()
  await expect(toolkit.getByRole('button', { name: /Portable compressor/ })).toBeVisible()

  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await expect(toolkit.getByRole('button', { name: /EMS ambulance/ })).toBeVisible()
  await expect(toolkit.getByRole('button', { name: /Gas can/ })).toHaveCount(0)

  await toolkit.getByRole('tab', { name: 'Incidentals' }).click()
  await expect(toolkit.getByRole('button', { name: /Removed wheel/ })).toBeVisible()
  await expect(toolkit.getByRole('button', { name: /Motorist/ })).toBeVisible()
  await toolkit.getByRole('button', { name: /Crash debris area/ }).click()
  const inspector = page.getByRole('region', { name: 'Selected scene item' })
  await inspector.getByLabel('Width (ft)').fill('30')
  await inspector.getByLabel('Length (ft)').fill('18')
  const debris = page.locator('[data-definition-id="crash-debris-area"]')
  await expect(debris.locator('.deployed-selection')).toHaveAttribute('width', '34')
  await expect(debris.locator('.deployed-selection')).toHaveAttribute('height', '22')
})

test('deletes selected scene items from the keyboard and restores SSP trucks from SSP Assets', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByTitle('Remove selected SSP truck')).toHaveCount(0)
  await expect(page.getByTitle('Add SSP truck')).toHaveCount(0)

  const cone = page.locator('[data-cone-id="anchor"]')
  await cone.evaluate((element) => (element as HTMLElement).focus())
  await page.keyboard.press('Enter')
  await page.keyboard.press('Delete')
  await expect(cone).toHaveCount(0)

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  const ambulance = page.locator('[data-definition-id="ems-ambulance"]')
  await page.keyboard.press('Delete')
  await expect(ambulance).toHaveCount(0)

  const truck = page.locator('[data-truck-id="ssp-truck-1"]')
  await truck.evaluate((element) => (element as HTMLElement).focus())
  await page.keyboard.press('Enter')
  await page.keyboard.press('Delete')
  await expect(truck).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'SSP truck signboard' })).toHaveCount(0)

  await toolkit.getByRole('tab', { name: 'SSP Assets' }).click()
  await toolkit.getByRole('button', { name: /^SSP truck/ }).click()
  await expect(page.locator('[data-truck-id]')).toHaveCount(1)
})

test('exports image and portable scene files and loads the scene back', async ({ page }) => {
  await page.addInitScript(() => {
    const files: Record<string, string> = {}
    Object.assign(window, {
      __savedSceneFiles: files,
      showDirectoryPicker: () => Promise.resolve({
        getFileHandle: (name: string) => Promise.resolve({
          createWritable: () => Promise.resolve({
            write: async (data: Blob | string) => { files[name] = typeof data === 'string' ? data : await data.text() },
            close: () => Promise.resolve(),
          }),
        }),
      }),
    })
  })
  await page.goto('/')

  await page.getByRole('button', { name: 'SAVE SCENE' }).click()
  await page.getByRole('menuitem', { name: 'SVG vector' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __savedSceneFiles: Record<string, string> }).__savedSceneFiles).length)).toBe(2)

  const savedFiles = await page.evaluate(() => (window as unknown as { __savedSceneFiles: Record<string, string> }).__savedSceneFiles)
  const scenarioName = Object.keys(savedFiles).find((name) => name.endsWith('.magnus.json'))
  const svgName = Object.keys(savedFiles).find((name) => name.endsWith('.svg'))
  expect(scenarioName).toBeTruthy()
  expect(svgName).toBeTruthy()
  expect(savedFiles[svgName!]).toContain('<svg')
  expect(JSON.parse(savedFiles[scenarioName!])).toMatchObject({ kind: 'magnus-scene', version: 2 })

  const truck = page.locator('[data-truck-id="ssp-truck-1"]')
  await truck.click({ force: true })
  await page.keyboard.press('Delete')
  await expect(truck).toHaveCount(0)
  await page.locator('.scene-file-input').setInputFiles({
    name: scenarioName!,
    mimeType: 'application/json',
    buffer: Buffer.from(savedFiles[scenarioName!]),
  })
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toBeVisible()

  await page.getByRole('button', { name: 'SAVE SCENE' }).click()
  await page.getByRole('menuitem', { name: 'PNG image' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __savedSceneFiles: Record<string, string> }).__savedSceneFiles).some((name) => name.endsWith('.png')))).toBe(true)
})

test('allows scene items across the full map after repositioning the scene', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      version: 1,
      source: { type: 'osm-pbf', dataset: 'placement test road', generatedAt: '2026-08-22T00:00:00.000Z', attribution: 'Test fixture' },
      coordinateSystem: { worldCrs: 'LOCAL', displayUnits: 'feet', origin: 'top-left', trafficFlow: 'bottom-to-top' },
      viewport: { width: 72, height: 760 },
      features: [{
        id: 'straight-road',
        kind: 'road-surface',
        layer: 0,
        geometry: { type: 'LineString', coordinates: [[36, 760], [36, 0]] },
        properties: { name: 'Straight road', highway: 'motorway', lanes: 3, direction: 'forward', renderWidthFeet: 36 },
      }],
    }),
  }))
  await page.goto('/')
  await expect(page.getByText('placement test road')).toBeVisible()

  const canvas = page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')
  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()

  const canvasBounds = await canvas.boundingBox()
  const viewBox = (await canvas.getAttribute('viewBox'))?.split(' ').map(Number)
  expect(canvasBounds).not.toBeNull()
  expect(viewBox).toHaveLength(4)
  const mapPoint = (x: number, y: number) => ({
    clientX: canvasBounds!.x + ((x - viewBox![0]) / viewBox![2]) * canvasBounds!.width,
    clientY: canvasBounds!.y + ((y - viewBox![1]) / viewBox![3]) * canvasBounds!.height,
  })
  await canvas.dispatchEvent('pointerdown', {
    pointerId: 41,
    pointerType: 'mouse',
    ...mapPoint(36, 20),
  })
  await expect(page.locator('.scene-equipment')).toHaveAttribute(
    'transform',
    'translate(36 20) rotate(0) translate(-36 -260)',
  )

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  const ambulance = page.locator('[data-definition-id="ems-ambulance"]')
  await page.getByLabel('Y (ft)').fill('900')
  await expect(ambulance).toHaveAttribute('transform', /translate\([^ ]+ 900\)/)
})

test('centers and rotates dropped response vehicles and exposes the expanded catalog', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')
  const stage = page.locator('.road-stage')
  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('tab', { name: 'External Assets' }).click()

  await page.getByRole('button', { name: 'Zoom in highway graphic' }).click()
  await stage.evaluate((element) => element.scrollTo(element.scrollWidth * .75, element.scrollHeight * .7))
  await toolkit.getByRole('button', { name: /^Tow truck/ }).click()

  const stageBounds = await stage.boundingBox()
  const towTruck = page.locator('[data-definition-id="tow-truck"]')
  const towBounds = await towTruck.boundingBox()
  expect(stageBounds).not.toBeNull()
  expect(towBounds).not.toBeNull()
  expect(Math.abs(towBounds!.x + towBounds!.width / 2 - (stageBounds!.x + stageBounds!.width / 2))).toBeLessThan(20)
  expect(Math.abs(towBounds!.y + towBounds!.height / 2 - (stageBounds!.y + stageBounds!.height / 2))).toBeLessThan(20)

  const rotationHandle = page.getByLabel('Rotate Tow truck')
  const handleBounds = await rotationHandle.boundingBox()
  expect(handleBounds).not.toBeNull()
  await rotationHandle.dispatchEvent('pointerdown', {
    pointerId: 31,
    pointerType: 'touch',
    clientX: handleBounds!.x + handleBounds!.width / 2,
    clientY: handleBounds!.y + handleBounds!.height / 2,
  })
  await page.locator('.road-canvas').dispatchEvent('pointermove', {
    pointerId: 31,
    pointerType: 'touch',
    clientX: towBounds!.x - 30,
    clientY: towBounds!.y + towBounds!.height / 2,
  })
  await page.locator('.road-canvas').dispatchEvent('pointerup', { pointerId: 31, pointerType: 'touch' })
  await expect(towTruck).not.toHaveAttribute('transform', /rotate\(0\)/)

  const barrel = toolkit.getByRole('button', { name: /Barrel \/ drum/ })
  await expect(barrel).toBeDisabled()
  await toolkit.getByRole('button', { name: /TMA cone truck/ }).click()
  await expect(barrel).toBeEnabled()
  await barrel.click()
  await expect(page.locator('[data-definition-id="barrel"] circle')).toHaveCount(3)
  await toolkit.getByRole('button', { name: /Heavy tow truck/ }).click()
  await expect(page.locator('[data-definition-id="heavy-tow-truck"] .catalog-tow-rig')).toHaveCount(1)
  await toolkit.getByRole('button', { name: /TMA crash truck/ }).click()
  await expect(page.locator('[data-definition-id="tma-crash-truck"] .catalog-attenuator')).toHaveCount(1)
  await toolkit.getByRole('button', { name: /VSP cruiser/ }).click()
  await expect(page.locator('[data-definition-id="vsp-cruiser"] .catalog-police-stripe')).toHaveCount(1)
  await expect(page.locator('[data-definition-id="vsp-cruiser"] .emergency-light')).toHaveCount(2)

  await toolkit.getByRole('tab', { name: 'Hazards' }).click()
  await toolkit.getByRole('button', { name: /Motorcycle on its side/ }).click()
  await expect(page.locator('[data-definition-id="fallen-motorcycle"]')).toHaveCount(1)
  await toolkit.getByRole('button', { name: /Injured person/ }).click()
  await expect(page.locator('[data-definition-id="injured-person"] .catalog-blood')).toHaveCount(1)
})

test('shows map orientation and traffic direction only for an active scene', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('img', { name: /Map compass/ })).toBeVisible()
  await expect(page.getByLabel('Traffic flow bearing')).toBeVisible()
  await expect(page.getByLabel('Traffic flow bearing')).toHaveCSS('transform', /matrix/)

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await expect(page.getByLabel('Traffic flow bearing')).toHaveCount(0)
  await expect(page.getByRole('img', { name: /Map compass/ })).toBeVisible()
})

test('uses the shared assets and hazards catalog in the grid designer', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Scene design tool/ }).click()

  const toolkit = page.getByRole('region', { name: 'Designer equipment toolkit' })
  await expect(toolkit.getByRole('tab')).toHaveText(['SSP Assets', 'External Assets', 'Hazards', 'Incidentals'])
  await expect(toolkit.getByRole('tab', { name: 'SSP Assets' })).toHaveCSS('background-color', 'rgb(255, 106, 0)')
  await toolkit.getByRole('tab', { name: 'Hazards' }).click()
  await toolkit.getByRole('button', { name: 'Grey debris' }).click()
  await page.getByLabel('10 foot scene design grid').click({ position: { x: 300, y: 350 } })

  await expect(page.getByRole('button', { name: 'Delete object' })).toBeVisible()
  await page.getByLabel('X (ft)').fill('400')
  await expect(page.locator('.designer-equipment.selected')).toHaveAttribute('transform', /translate\(400 /)
  await page.getByRole('button', { name: 'Delete object' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Delete object' })).toHaveCount(0)
})

test('configures an enhanced safety scene', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('tab', { name: /Enhanced Safety/ }).click()
  await page.getByTitle('Add taper cone').click()
  await page.getByLabel('Forward spacing').selectOption('80')

  await expect(page.getByText('Drag cones to adapt the scene')).toBeVisible()
  await expect(page.getByText('6 / 5 MIN')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Setup compliant' })).toBeVisible()
})

test('reports fewer than 8 rear cones in violation training', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('tab', { name: /SOP Violation/ }).click()
  await page.getByRole('button', { name: 'Remove rear cone' }).click()

  await expect(page.getByRole('heading', { name: 'SOP violations detected' })).toBeVisible()
  await expect(page.getByText(/fewer than 8 cones protect the rear upstream area/)).toBeVisible()
})

test('opens the grid-based scene template designer', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: /Scene design tool/ }).click()

  await expect(page.getByRole('region', { name: 'Scene template designer' })).toBeVisible()
  await expect(page.getByLabel('10 foot scene design grid')).toBeVisible()
  await expect(page.getByLabel('Designer signboard')).toHaveValue('left-arrow')
})