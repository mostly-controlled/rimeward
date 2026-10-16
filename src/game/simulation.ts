export type Campaign = { day: number; supplies: number }

export const initialCampaign = (): Campaign => ({ day: 1, supplies: 3 })

export const advanceDay = (campaign: Campaign): Campaign => ({
  day: campaign.day + 1,
  supplies: Math.max(0, campaign.supplies - 1),
})
