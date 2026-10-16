import { describe, expect, it } from 'vitest'
import { advanceDay, initialCampaign } from './simulation'

describe('campaign simulation', () => {
  it('starts with a day and supplies', () => expect(initialCampaign()).toEqual({ day: 1, supplies: 3 }))
  it('advances deterministically without mutating the input', () => {
    const campaign = initialCampaign()
    expect(advanceDay(campaign)).toEqual({ day: 2, supplies: 2 })
    expect(campaign).toEqual({ day: 1, supplies: 3 })
  })
})
