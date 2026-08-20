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

  await expect(canvas).toHaveAttribute('viewBox', '0 0 500 760')
  await page.getByRole('button', { name: 'Zoom in highway graphic' }).click()
  await expect(canvas).toHaveAttribute('data-zoom', '1.25')
  await expect(canvas).not.toHaveAttribute('viewBox', '0 0 500 760')

  await page.getByRole('button', { name: /Reset highway graphic zoom/ }).click()
  await expect(canvas).toHaveAttribute('viewBox', '0 0 500 760')
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