export type ModalStackPlan = {
  retainedIds: string[]
  removedIds: string[]
}

export type ModalTopClosePlan = ModalStackPlan & {
  previousId: string
}

export type ModalTopCloseOptions = {
  replaceState?: boolean
}

export const getModalStackForActiveId = (modalIds: string[], activeId: string) => {
  const activeIndex = modalIds.indexOf(activeId)

  return activeIndex >= 0 ? modalIds.slice(0, activeIndex + 1) : []
}

export const getModalHashSyncPlan = (modalIds: string[], activeId: string): ModalStackPlan => {
  const retainedIds = getModalStackForActiveId(modalIds, activeId)

  if (!activeId || retainedIds.length === 0) {
    return {retainedIds: [], removedIds: [...modalIds]}
  }

  return {retainedIds, removedIds: modalIds.slice(retainedIds.length)}
}

export const getModalTopClosePlan = (modalIds: string[], activeId: string): ModalTopClosePlan => {
  const activeIndex = modalIds.indexOf(activeId)

  if (activeIndex < 0) {
    return {previousId: "", retainedIds: [], removedIds: [...modalIds]}
  }

  const retainedIds = modalIds.slice(0, activeIndex)

  return {
    previousId: retainedIds.at(-1) || "",
    retainedIds,
    removedIds: modalIds.slice(activeIndex),
  }
}

export const shouldUseHistoryForTopClose = (
  plan: ModalTopClosePlan,
  options: ModalTopCloseOptions = {},
  canUseHistory = true,
) => Boolean(canUseHistory && plan.previousId && !options.replaceState)
