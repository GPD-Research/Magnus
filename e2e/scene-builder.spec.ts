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
  await expect(page.getByText('I-95 Northbound MM 170 scale preview')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Single right lane closure' })).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Setup compliant' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Spatial service' })).toContainText('Connected')
  const brand = page.getByLabel('Magnus version 4.5.0')
  await expect(brand).toBeVisible()
  await expect(brand).toContainText('AGNUS')
  await expect(brand).toContainText('v4.5')
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

test('saves and restores the complete scene configuration', async ({ page }) => {
  await page.goto('/')
  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  await page.getByRole('button', { name: 'Save scenario' }).click()
  await expect(page.getByRole('button', { name: 'Scenario saved' })).toBeVisible()

  await page.reload()
  await expect(page.locator('[data-definition-id="ems-ambulance"]')).toHaveCount(1)
  await page.getByRole('button', { name: 'Reset scene' }).click()
  await expect(page.locator('[data-definition-id="ems-ambulance"]')).toHaveCount(0)
})

test('zooms the imported vector highway graphic', async ({ page }) => {
  await page.goto('/')
  const canvas = page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')
  const stage = page.locator('.road-stage')
  const topbarZoom = page.locator('.topbar').getByRole('group', { name: 'Scene zoom' })

  await expect(topbarZoom).toBeVisible()
  await expect(page.locator('.audit-panel').getByRole('group', { name: 'Scene zoom' })).toHaveCount(0)
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '320')
  const canvasBounds = await canvas.boundingBox()
  expect(canvasBounds).not.toBeNull()
  expect(canvasBounds!.width / canvasBounds!.height).toBeGreaterThan(0.5)
  const fittedViewBox = await canvas.getAttribute('viewBox')
  await page.getByRole('button', { name: 'Zoom in highway graphic' }).click()
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '256')
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
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '320')
  await expect(canvas).toHaveAttribute('viewBox', fittedViewBox!)

  await stage.dispatchEvent('wheel', { deltaY: -1000, ctrlKey: true })
  await expect(canvas).toHaveAttribute('data-visible-width-feet', '40')
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
  const initialCenterWidth = (await center.boundingBox())!.width
  const initialZoom = await canvas.getAttribute('data-zoom')
  const initialTruckTransform = await page.locator('[data-truck-id="ssp-truck-1"]').getAttribute('transform')
  const initialViewedCenter = await viewedCenter()
  await page.getByRole('button', { name: 'Collapse configuration pane' }).press('Enter')
  await expect(page.getByRole('button', { name: 'Expand configuration pane' })).toBeFocused()
  await expect.poll(viewedCenter).toEqual({
    x: expect.closeTo(initialViewedCenter.x, 0),
    y: expect.closeTo(initialViewedCenter.y, 0),
  })
  await expect(page.getByRole('button', { name: 'Collapse operations pane' })).toBeVisible()
  await page.getByRole('button', { name: 'Collapse operations pane' }).click()
  await expect(workspace).toHaveClass(/left-pane-collapsed/)
  await expect(workspace).toHaveClass(/right-pane-collapsed/)
  await expect(canvas).toHaveAttribute('data-zoom', initialZoom!)
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', initialTruckTransform!)
  await expect.poll(async () => (await center.boundingBox())!.width).toBeGreaterThan(initialCenterWidth)
  await expect.poll(viewedCenter).toEqual({
    x: expect.closeTo(initialViewedCenter.x, 0),
    y: expect.closeTo(initialViewedCenter.y, 0),
  })
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

  await expect(page.locator('.location-result')).toContainText('scale-accurate development preview')
  await expect(page.getByText('I-95 Northbound Exit 166 scale preview')).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toHaveAttribute('data-visible-width-feet', '320')
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

  await page.getByRole('checkbox', { name: 'Road geometry' }).uncheck()
  await expect(page.locator('.road-feature-road-surface')).toHaveCount(0)
  await expect(page.locator('.road-feature-shoulder-edge')).toHaveCount(2)

  await page.getByRole('checkbox', { name: 'Barriers' }).uncheck()
  await expect(page.locator('.road-feature-shoulder-edge')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Traffic flow' }).uncheck()
  await expect(page.locator('.road-feature-traffic-flow')).toHaveCount(0)
})

test('configures signboards independently for up to five SSP trucks', async ({ page }) => {
  await page.goto('/')

  const firstMessage = page.getByLabel('Signboard message for SSP Truck 1')
  await expect(firstMessage).toHaveValue('double-diamonds')
  await firstMessage.selectOption('incident-ahead')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('data-signboard', 'incident-ahead')

  const addTruck = page.getByRole('button', { name: 'Add truck' })
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
  await expect(page.getByRole('button', { name: 'Tap roadway to place' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.scene-equipment')).toHaveCount(0)

  await page.locator('#preview-express-ramp-surface').click({ force: true, position: { x: 20, y: 5 } })
  await expect(page.locator('.scene-equipment')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Center lane closure' })).toBeVisible()
  await expect(page.locator('.scene-equipment')).toHaveAttribute('transform', /translate\(.+ .+\) rotate\((?!0\))/)
})

test('instantiates lane-specific geometry and signboards when adding a scene', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')

  await page.getByRole('button', { name: 'Remove scene' }).click()
  await page.getByRole('button', { name: /Left lane closure/ }).click()
  await page.getByRole('button', { name: 'Add scene' }).click()
  await page.locator('#mainline-surface').click({ force: true })

  await expect(page.locator('[data-cone-id="anchor"]')).toHaveAttribute('transform', 'translate(30 282)')
  await expect(page.locator('[data-cone-id="buffer-2"]')).toHaveAttribute('transform', 'translate(30 362)')
  await expect(page.locator('[data-cone-id="taper-5"]')).toHaveAttribute('transform', 'translate(18 562)')
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', 'translate(24 260)')
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
  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', 'translate(36 260)')
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

  await expect(page.locator('[data-truck-id="ssp-truck-1"]')).toHaveAttribute('transform', 'translate(60 260)')
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
    'translate(106 200) rotate(0) translate(-36 -260)',
  )
  await expect(page.locator('[data-cone-id="anchor"]')).toHaveAttribute('transform', 'translate(42 282)')
  await expect(page.locator('[data-cone-id="taper-5"]')).toHaveAttribute('transform', 'translate(54 562)')
  await expect(page.locator('#four-lane-right-skip')).toHaveAttribute('d', 'M 112 350 L 112 50')
  await expect(page.locator('#four-lane-right-fog')).toHaveAttribute('d', 'M 124 350 L 124 50')
})

test('deploys assets and hazards with live scene counters and deletion', async ({ page }) => {
  await page.goto('/')

  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })
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
  await toolkit.getByRole('button', { name: /Helicopter landing zone/ }).click()
  await expect(page.locator('[data-definition-id="helicopter-zone"]')).toHaveCount(1)
  await expect(page.getByRole('region', { name: 'Scene resource counts' })).toContainText('1')
  await page.getByRole('button', { name: 'Delete selected item' }).click()
  await expect(page.locator('[data-definition-id="helicopter-zone"]')).toHaveCount(0)

  await toolkit.getByRole('tab', { name: 'Assets' }).click()
  const cruiser = toolkit.getByRole('button', { name: /VSP cruiser/ })
  for (let count = 0; count < 5; count += 1) await cruiser.click()
  await expect(cruiser).toBeDisabled()
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
  await toolkit.getByRole('button', { name: /EMS ambulance/ }).click()
  const ambulance = page.locator('[data-definition-id="ems-ambulance"]')
  const ambulanceBounds = await ambulance.boundingBox()
  expect(ambulanceBounds).not.toBeNull()
  await page.mouse.move(
    ambulanceBounds!.x + ambulanceBounds!.width / 2,
    ambulanceBounds!.y + ambulanceBounds!.height / 2,
  )
  await page.mouse.down()
  const downstream = mapPoint(36, 740)
  await page.mouse.move(downstream.clientX, downstream.clientY, { steps: 4 })
  await page.mouse.up()

  await expect.poll(async () => {
    const transform = await ambulance.getAttribute('transform')
    return Number(/translate\([^ ]+ ([^)]+)\)/.exec(transform ?? '')?.[1])
  }).toBeGreaterThan(760)
})

test('centers and rotates dropped response vehicles and exposes the expanded catalog', async ({ page }) => {
  await page.route('**/api/road-scenes/resolve?**', (route) => route.abort())
  await page.goto('/')
  const stage = page.locator('.road-stage')
  const toolkit = page.getByRole('region', { name: 'Scene equipment toolkit' })

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
  await expect(page.locator('[data-definition-id="vsp-cruiser"] rect[fill="#2d67ae"]')).toHaveCount(1)

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
  await toolkit.getByRole('tab', { name: 'Hazards' }).click()
  await toolkit.getByRole('button', { name: 'Grey debris' }).click()
  await page.getByLabel('10 foot scene design grid').click({ position: { x: 300, y: 350 } })

  await expect(page.getByRole('button', { name: 'Delete object' })).toBeVisible()
  await page.getByLabel('X (ft)').fill('400')
  await expect(page.locator('.designer-equipment.selected')).toHaveAttribute('transform', /translate\(400 /)
  await page.getByRole('button', { name: 'Delete object' }).click()
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