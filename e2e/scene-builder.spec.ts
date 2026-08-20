import { expect, test } from '@playwright/test'

test('loads the scene builder with a visible roadway and passing audit', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Single right lane closure' })).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Setup compliant' })).toBeVisible()
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

  await page.getByLabel('Highway').fill('I 95')
  await page.getByLabel('Direction').selectOption('northbound')
  await page.getByLabel('Reference').selectOption('exit')
  await page.getByLabel('Exit', { exact: true }).fill('166')
  await page.getByRole('button', { name: 'Render location' }).click()

  await expect(page.getByRole('status')).toContainText('scale-accurate development preview')
  await expect(page.getByText('I-95 Northbound Exit 166 scale preview')).toBeVisible()
  await expect(page.getByLabel('Top-down highway scene with SSP vehicle and traffic cones')).toHaveAttribute('data-zoom', '1')
  await expect(page.locator('#preview-exit-ramp-surface')).toHaveCount(1)
  await expect(page.locator('#preview-exit-ramp-surface')).toHaveAttribute('stroke-width', '12')
})

test('selects a Mixing Bowl overpass as the controlled scene sector', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Highway').fill('I-95')
  await page.getByLabel('Direction').selectOption('northbound')
  await page.getByLabel('Reference').selectOption('mile-marker')
  await page.getByLabel('Mile marker', { exact: true }).fill('170')
  await page.getByRole('button', { name: 'Render location' }).click()

  const connector = page.locator('#preview-express-ramp-surface')
  await expect(page.getByLabel('Controlled roadway section')).toBeVisible()
  await page.getByRole('button', { name: 'Select section' }).click()
  await expect(page.getByText('Select a roadway section')).toBeVisible()
  await connector.click()

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
  await expect(page.getByLabel('Signboard')).toHaveValue('left-arrow')
})