import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ status: 'ok', service: 'magnus-spatial' }),
  }))
})

test('loads the scene builder with a visible roadway and passing audit', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Single right lane closure' })).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Setup compliant' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Spatial service' })).toContainText('Connected')
  await expect(page.getByLabel('Magnus version 3.0.0')).toBeVisible()
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

  const canvasBounds = await canvas.boundingBox()
  expect(canvasBounds).not.toBeNull()
  expect(canvasBounds!.width / canvasBounds!.height).toBeGreaterThan(0.5)
  const fittedViewBox = await canvas.getAttribute('viewBox')
  await page.getByRole('button', { name: 'Zoom in highway graphic' }).click()
  await expect(canvas).toHaveAttribute('data-zoom', '1.25')
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
  await expect(canvas).toHaveAttribute('viewBox', fittedViewBox!)
  await expect.poll(() => stage.evaluate((element) => ({
    horizontal: element.scrollWidth > element.clientWidth,
    vertical: element.scrollHeight > element.clientHeight,
  }))).toEqual({ horizontal: false, vertical: false })
})

test('pinches the center scene to zoom on touch devices', async ({ page }) => {
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
  await stage.dispatchEvent('pointermove', {
    pointerId: 2,
    pointerType: 'touch',
    clientX: 225,
    clientY: 200,
  })

  await expect(canvas).toHaveAttribute('data-zoom', '1.25')
  await stage.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch' })
  await stage.dispatchEvent('pointerup', { pointerId: 2, pointerType: 'touch' })
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
})

test('resolves a highway exit request into scaled interchange geometry', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Highway', { exact: true }).fill('I 95')
  await page.getByLabel('Direction').selectOption('northbound')
  await page.getByLabel('Reference').selectOption('exit')
  await page.getByLabel('Exit', { exact: true }).fill('166')
  await page.getByRole('button', { name: 'Render location' }).click()

  await expect(page.locator('.location-result')).toContainText('scale-accurate development preview')
  await expect(page.getByText('I-95 Northbound Exit 166 scale preview')).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toHaveAttribute('data-zoom', '1')
  await expect(page.locator('#preview-exit-ramp-surface')).toHaveCount(1)
  await expect(page.locator('#preview-exit-ramp-surface')).toHaveAttribute('stroke-width', '12')
})

test('selects a Mixing Bowl overpass as the controlled scene sector', async ({ page }) => {
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
  await page.goto('/')

  await page.getByRole('checkbox', { name: 'Road geometry' }).uncheck()
  await expect(page.locator('.road-feature-road-surface')).toHaveCount(0)
  await expect(page.locator('.road-feature-shoulder-edge')).toHaveCount(2)

  await page.getByRole('checkbox', { name: 'Barriers' }).uncheck()
  await expect(page.locator('.road-feature-shoulder-edge')).toHaveCount(0)

  await page.getByRole('checkbox', { name: 'Traffic flow' }).uncheck()
  await expect(page.locator('.road-feature-traffic-flow')).toHaveCount(0)
  await expect(page.getByText('DOWNSTREAM')).toHaveCount(0)
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