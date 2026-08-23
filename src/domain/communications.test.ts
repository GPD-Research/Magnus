import { describe, expect, it } from 'vitest'
import { DEFAULT_TOC_INCIDENT_DETAILS, buildInitialRadioExchange } from './communications'

const details = DEFAULT_TOC_INCIDENT_DETAILS

describe('initial radio exchange', () => {
  it('builds the opening, acknowledgement, and single-lane scene callout', () => {
    expect(buildInitialRadioExchange({
      unit: 'SSP970',
      highway: 'I-95',
      direction: 'northbound',
      referenceType: 'exit',
      reference: '166',
      incidentType: 'crash',
      details,
      scenario: 'right-lane',
      travelLanes: 3,
    })).toEqual([
      { channel: 'SSP', text: 'SSP970 to 95 control' },
      { channel: 'TOC', text: 'SSP970, go ahead' },
      { channel: 'SSP', text: "Show me out northbound 95 at exit 166, with a crash blocking the right lane, 2 vehicles involved, 0 motorists transported by EMS, injuries unknown, I'll advise." },
    ])
  })

  it('names both affected lanes on a three-lane highway', () => {
    const exchange = buildInitialRadioExchange({
      unit: 'SSP970',
      highway: 'I-495',
      direction: 'southbound',
      referenceType: 'mile-marker',
      reference: '42.5',
      incidentType: 'severe-crash',
      details: { ...details, crashVehicleCount: 3, emsTransportCount: 1, injuries: 'reported' },
      scenario: 'two-left-lanes',
      travelLanes: 3,
    })

    expect(exchange[2].text).toBe("Show me out southbound 495 at mile marker 42.5, with a severe crash blocking the left and center lanes, 3 vehicles involved, 1 motorist transported by EMS, injuries reported, roll EMS, I'll advise.")
  })

  it('uses a numeric lane count description on wider highways', () => {
    const exchange = buildInitialRadioExchange({
      unit: 'SSP970',
      highway: 'Route 66',
      direction: 'westbound',
      referenceType: 'exit',
      reference: '53',
      incidentType: 'blocking-disabled',
      details: { ...details, licensePlate: 'ABC123', licensePlateState: 'Virginia', vehicleMake: 'Honda', vehicleModel: 'Accord', vehicleColor: 'blue' },
      scenario: 'two-right-lanes',
      travelLanes: 4,
    })

    expect(exchange[2].text).toBe("Show me out westbound 66 at exit 53, with a disabled vehicle blocking two right lanes, Virginia plate ABC123, blue Honda Accord, I'll advise.")
  })

  it('uses shoulder and debris wording without awkward articles', () => {
    const base = {
      unit: 'SSP970',
      highway: 'I-95',
      direction: 'northbound' as const,
      referenceType: 'exit' as const,
      reference: '166',
      scenario: 'shoulder' as const,
      travelLanes: 3,
      details,
    }

    expect(buildInitialRadioExchange({ ...base, incidentType: 'disabled-vehicle' })[2].text)
      .toContain('with a disabled vehicle on the right shoulder')
    expect(buildInitialRadioExchange({ ...base, incidentType: 'debris' })[2].text)
      .toContain('with debris blocking the right shoulder')
  })

  it('supports major incident types without adding automatic fire or police requests', () => {
    const base = {
      unit: 'SSP970',
      highway: 'I-95',
      direction: 'northbound' as const,
      referenceType: 'exit' as const,
      reference: '166',
      scenario: 'right-lane' as const,
      travelLanes: 3,
      details,
    }
    const expectedPhrases = {
      'tractor-trailer-fire': 'a tractor trailer fire',
      'plane-crash': 'a plane crash',
      'bridge-collapse': 'a bridge collapse',
      'overhead-signage-collapse': 'an overhead signage collapse',
      'downed-tree': 'a downed tree',
    } as const

    for (const [incidentType, phrase] of Object.entries(expectedPhrases)) {
      const callout = buildInitialRadioExchange({ ...base, incidentType: incidentType as keyof typeof expectedPhrases })[2].text
      expect(callout).toContain(`with ${phrase} blocking the right lane`)
      expect(callout).not.toMatch(/roll fire|roll VSP/i)
    }
  })

  it('reports a full roadway closure as blocking all lanes', () => {
    const exchange = buildInitialRadioExchange({
      unit: 'SSP970',
      highway: 'I-95',
      direction: 'northbound',
      referenceType: 'exit',
      reference: '166',
      incidentType: 'plane-crash',
      details: { ...details, planeLanesImpacted: 'all lanes', planeSize: 'small', survivors: 'yes' },
      scenario: 'all-lanes',
      travelLanes: 3,
    })

    expect(exchange[2].text).toBe("Show me out northbound 95 at exit 166, with a plane crash blocking all lanes, all lanes impacted, small plane, survivors reported, I'll advise.")
  })

  it('appends tree and debris response details', () => {
    const base = {
      unit: 'SSP970', highway: 'I-95', direction: 'northbound' as const,
      referenceType: 'exit' as const, reference: '166', scenario: 'all-lanes' as const, travelLanes: 3,
    }
    const tree = buildInitialRadioExchange({
      ...base,
      incidentType: 'downed-tree',
      details: { ...details, treeLanesBlocked: 'all lanes', treeSize: '20 feet', treeResourcesNeeded: 'chainsaw crew' },
    })[2].text
    const debris = buildInitialRadioExchange({
      ...base,
      incidentType: 'debris',
      details: { ...details, debrisHazardous: 'no', debrisManualRemoval: 'no', debrisNeedsSlowRoll: 'yes', debrisHasLaneBlade: 'yes' },
    })[2].text

    expect(tree).toContain('all lanes blocked, 20 feet tree, additional resources needed: chainsaw crew')
    expect(debris).toContain('debris is not hazardous, SSP cannot remove it manually, VSP slow-roll needed, SSP has a lane blade')
  })

  it('appends car and tractor trailer fire details without dispatch requests', () => {
    const base = {
      unit: 'SSP970', highway: 'I-95', direction: 'northbound' as const,
      referenceType: 'exit' as const, reference: '166', scenario: 'right-lane' as const, travelLanes: 3,
    }
    const carFire = buildInitialRadioExchange({
      ...base,
      incidentType: 'car-fire',
      details: { ...details, carFireMotoristOut: 'yes', carFireFullyEngulfed: 'yes', carFireIsEv: 'no', carFireLanesBlocked: 'the right lane' },
    })[2].text
    const tractorFire = buildInitialRadioExchange({
      ...base,
      incidentType: 'tractor-trailer-fire',
      details: { ...details, tractorDriverOut: 'yes', tractorTrailerCargo: 'lumber', tractorHazmat: 'no', tractorFullyEngulfed: 'yes', tractorLanesBlocked: 'two right lanes' },
    })[2].text

    expect(carFire).toContain('motorist is out, vehicle is fully engulfed, vehicle is not an EV, the right lane blocked')
    expect(tractorFire).toContain('driver is out, trailer hauling lumber, no HAZMAT reported, tractor trailer is fully engulfed, two right lanes blocked')
    expect(`${carFire} ${tractorFire}`).not.toMatch(/roll fire|roll VSP/i)
  })
})